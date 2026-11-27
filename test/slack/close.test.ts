import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answers, rounds } from "../../src/db/schema";
import worker, { app } from "../../src/index";
import { IDS } from "../../src/slack/blocks";
import { db, makeRound, makeTopic } from "../helpers/db";
import { commandBody, interactionBody, signedRequest } from "../helpers/slack";

/** Slack Web API と response_url への呼び出しを記録し、決めた応答を返す */
type Call = { url: string; body: Record<string, unknown> };
let calls: Call[];
let replies: Record<string, Record<string, unknown>>;

beforeEach(() => {
  calls = [];
  replies = {
    "views.open": { ok: true },
    "chat.postMessage": { ok: true, ts: "1700000000.000200" },
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    const method = url.replace("https://slack.com/api/", "");
    return Response.json(replies[method] ?? { ok: true });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const api = (method: string) => calls.filter((c) => c.url === `https://slack.com/api/${method}`);

async function send(path: string, body: string) {
  const ctx = createExecutionContext();
  const res = await app.request(await signedRequest(path, body), undefined, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const ADMIN = { id: "U0ADMIN", team_id: "T0TEST" };
const nowSeconds = () => Math.floor(Date.now() / 1000);

const statusOf = async (id: number) =>
  (await db().select().from(rounds).where(eq(rounds.id, id)))[0]?.status;

function closeSubmission(roundId: number | null, user = ADMIN) {
  return interactionBody({
    type: "view_submission",
    user,
    view: {
      id: "V2",
      callback_id: IDS.closeView,
      private_metadata: JSON.stringify({
        responseUrl: "https://hooks.slack.com/commands/T0TEST/1/abc",
      }),
      state: {
        values: {
          [IDS.closeRoundBlock]: {
            [IDS.closeRoundInput]: {
              type: "static_select",
              selected_option: roundId === null ? null : { value: String(roundId) },
            },
          },
        },
      },
    },
  });
}

/* このファイルの最初のテストは、受付中の配信がまだない状態で動く */
describe("/konomi close", () => {
  it("受付中の配信がなければ、本人だけにそう返す", async () => {
    const res = await send("/slack/commands", commandBody({ user_id: "U0ADMIN", text: "close" }));
    const json = await res.json<{ response_type: string; text: string }>();
    expect(json.response_type).toBe("ephemeral");
    expect(json.text).toContain("受付中の配信はありません");
    expect(api("views.open")).toEqual([]);
  });

  it("管理者でなければ断り、モーダルを開かない", async () => {
    const res = await send("/slack/commands", commandBody({ user_id: "U0USER", text: "close" }));
    expect(await res.json()).toMatchObject({ response_type: "ephemeral" });
    expect(api("views.open")).toEqual([]);
  });

  it("管理者なら、受付中の配信を選ぶモーダルを開く", async () => {
    const { topic } = await makeTopic({ question: "海と山、どっちが好き？" });
    const round = await makeRound(topic.id, { deadlineAt: null });
    const res = await send("/slack/commands", commandBody({ user_id: "U0ADMIN", text: " Close " }));
    expect(res.status).toBe(200);

    const view = api("views.open")[0]?.body.view as Record<string, unknown>;
    expect(view.callback_id).toBe(IDS.closeView);
    const select = (view.blocks as Array<Record<string, unknown>>).find(
      (b) => b.block_id === IDS.closeRoundBlock,
    )?.element as { options: Array<{ value: string; text: { text: string } }> };
    const option = select.options.find((o) => o.value === String(round.id));
    expect(option?.text.text).toBe("海と山、どっちが好き？");
    expect(JSON.stringify(option)).toContain("無期限");
  });
});

describe("手動終了のモーダルの送信", () => {
  it("配信を終了し、元の投稿のスレッドに結果を1件投稿する", async () => {
    const { topic, choices } = await makeTopic({}, ["犬", "猫"]);
    const round = await makeRound(topic.id, { channelId: "C0POST", messageTs: "123.456" });
    const cat = choices[1];
    if (!cat) throw new Error("no choice");
    await db().insert(answers).values({
      roundId: round.id,
      userId: "U1",
      choiceId: cat.id,
      answeredAt: nowSeconds(),
      updatedAt: nowSeconds(),
    });

    const res = await send("/slack/interactions", closeSubmission(round.id));
    const json = await res.json<{ response_action: string }>();
    expect(json.response_action).toBe("update");
    expect(await statusOf(round.id)).toBe("closed");

    const posts = api("chat.postMessage");
    expect(posts).toHaveLength(1);
    const post = posts[0]?.body ?? {};
    expect(post).toMatchObject({ channel: "C0POST", thread_ts: "123.456", reply_broadcast: false });
    const text = JSON.stringify(post.blocks);
    expect(text).toContain("受付を終了しました");
    expect(text).toContain("猫　100%（1票）");
    expect(text).toContain("犬　0%（0票）");
    expect(text).toContain(`http://localhost:8787/rounds/${round.id}`);
  });

  it("もう終了している配信なら、モーダルにエラーを出して投稿しない", async () => {
    const { topic } = await makeTopic();
    const round = await makeRound(topic.id, { status: "closed" });
    const res = await send("/slack/interactions", closeSubmission(round.id));
    const json = await res.json<{ response_action: string; errors: Record<string, string> }>();
    expect(json.response_action).toBe("errors");
    expect(json.errors[IDS.closeRoundBlock]).toBeTruthy();
    expect(api("chat.postMessage")).toEqual([]);
  });

  it("送信した人が管理者でなければ終了しない", async () => {
    const { topic } = await makeTopic();
    const round = await makeRound(topic.id);
    await send(
      "/slack/interactions",
      closeSubmission(round.id, { id: "U0USER", team_id: "T0TEST" }),
    );
    expect(await statusOf(round.id)).toBe("open");
    expect(api("chat.postMessage")).toEqual([]);
  });

  it("投稿に失敗しても終了のままにし、実行した人だけに知らせる", async () => {
    replies["chat.postMessage"] = { ok: false, error: "not_in_channel" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { topic } = await makeTopic();
    const round = await makeRound(topic.id);
    await send("/slack/interactions", closeSubmission(round.id));
    expect(await statusOf(round.id)).toBe("closed");
    const notice = calls.find((c) => c.url.startsWith("https://hooks.slack.com/"));
    expect(notice?.body).toMatchObject({ response_type: "ephemeral", replace_original: false });
  });

  it("終了した配信には回答できない", async () => {
    const { topic } = await makeTopic();
    const round = await makeRound(topic.id);
    await send("/slack/interactions", closeSubmission(round.id));
    calls = [];
    await send(
      "/slack/interactions",
      interactionBody({
        response_url: "https://hooks.slack.com/actions/T0TEST/1/xyz",
        actions: [{ action_id: IDS.answerButton, value: String(round.id) }],
      }),
    );
    expect(api("views.open")).toEqual([]);
  });
});

describe("Cron（締切）", () => {
  it("締切を過ぎた配信を終了し、スレッドに「締切です」と結果を投稿する", async () => {
    const { topic } = await makeTopic();
    const now = nowSeconds();
    const due = await makeRound(topic.id, { deadlineAt: now - 60, messageTs: "9.9" });
    const later = await makeRound(topic.id, { deadlineAt: now + 3600 });

    const ctx = createExecutionContext();
    const controller = createScheduledController({
      scheduledTime: now * 1000,
      cron: "*/5 * * * *",
    });
    await worker.scheduled(controller, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(await statusOf(due.id)).toBe("closed");
    expect(await statusOf(later.id)).toBe("open");
    const posts = api("chat.postMessage");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body.thread_ts).toBe("9.9");
    expect(JSON.stringify(posts[0]?.body.blocks)).toContain("締切です");
    expect(JSON.stringify(posts[0]?.body.blocks)).toContain("回答はありませんでした");
  });

  it("429 なら Retry-After だけ待って1回だけ送り直す", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    let first = true;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      if (first) {
        first = false;
        return new Response("", { status: 429, headers: { "Retry-After": "2" } });
      }
      return Response.json({ ok: true, ts: "1.1" });
    });
    const { topic } = await makeTopic();
    const now = nowSeconds();
    const due = await makeRound(topic.id, { deadlineAt: now - 1 });

    const ctx = createExecutionContext();
    const controller = createScheduledController({
      scheduledTime: now * 1000,
      cron: "*/5 * * * *",
    });
    await worker.scheduled(controller, env, ctx);
    await vi.advanceTimersByTimeAsync(2000);
    await waitOnExecutionContext(ctx);
    vi.useRealTimers();

    expect(await statusOf(due.id)).toBe("closed");
    expect(api("chat.postMessage")).toHaveLength(2);
  });
});
