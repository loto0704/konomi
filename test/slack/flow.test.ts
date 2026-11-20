import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answers, rounds, topics } from "../../src/db/schema";
import { app } from "../../src/index";
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
    "conversations.info": { ok: true, channel: { is_member: true } },
    "chat.postMessage": { ok: true, ts: "1700000000.000100" },
    "users.info": { ok: true, user: { is_restricted: false, is_ultra_restricted: false } },
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

/** waitUntil に回した処理まで待ってから返す */
async function send(path: string, body: string) {
  const ctx = createExecutionContext();
  const res = await app.request(await signedRequest(path, body), undefined, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const ADMIN = { id: "U0ADMIN", team_id: "T0TEST" };

describe("/konomi", () => {
  it("管理者でなければ本人だけに断りを返し、モーダルを開かない", async () => {
    const res = await send("/slack/commands", commandBody({ user_id: "U0USER" }));
    expect(await res.json()).toMatchObject({ response_type: "ephemeral" });
    expect(api("views.open")).toEqual([]);
  });

  it("管理者なら、実行したチャンネルを投稿先にして配信モーダルを開く", async () => {
    const res = await send("/slack/commands", commandBody({ user_id: "U0ADMIN" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(api("conversations.info")[0]?.body).toEqual({ channel: "C0CHANNEL" });

    const view = api("views.open")[0]?.body.view as Record<string, unknown>;
    expect(view.callback_id).toBe(IDS.deliveryView);
    expect(JSON.parse(String(view.private_metadata))).toMatchObject({ channelId: "C0CHANNEL" });
    const blocks = view.blocks as Array<Record<string, unknown>>;
    const topicSelect = blocks.find((b) => b.block_id === IDS.topicBlock)?.element as {
      options: unknown[];
    };
    // 同梱のお題が並ぶ
    expect(topicSelect.options.length).toBeGreaterThanOrEqual(40);
  });

  it("ボットがチャンネルにいなければ、招待を案内してモーダルを開かない", async () => {
    replies["conversations.info"] = { ok: true, channel: { is_member: false } };
    const res = await send("/slack/commands", commandBody({ user_id: "U0ADMIN" }));
    const json = await res.json<{ text: string }>();
    expect(json.text).toContain("/invite");
    expect(api("views.open")).toEqual([]);
  });

  it("optout・optin はまだ使えないことを返す", async () => {
    const res = await send("/slack/commands", commandBody({ text: "optout" }));
    expect(await res.json()).toMatchObject({ response_type: "ephemeral" });
  });
});

function deliverySubmission(values: Record<string, unknown>, user = ADMIN) {
  return interactionBody({
    type: "view_submission",
    user,
    view: {
      id: "V0",
      callback_id: IDS.deliveryView,
      private_metadata: JSON.stringify({
        channelId: "C0POST",
        responseUrl: "https://hooks.slack.com/commands/T0TEST/1/abc",
      }),
      state: { values },
    },
  });
}

const deliveryValues = (topicId: string, kind: "at" | "none", at?: number) => ({
  [IDS.topicBlock]: {
    [IDS.topicInput]: { type: "static_select", selected_option: { value: topicId } },
  },
  [IDS.deadlineKindBlock]: {
    [IDS.deadlineKindInput]: { type: "radio_buttons", selected_option: { value: kind } },
  },
  [IDS.deadlineAtBlock]: {
    [IDS.deadlineAtInput]: { type: "datetimepicker", selected_date_time: at ?? null },
  },
});

describe("配信モーダルの送信", () => {
  it("配信を作ってモーダルを閉じ、チャンネルに「回答する」「結果を見る」を投稿する", async () => {
    const { topic } = await makeTopic({ question: "夏と冬、どっちが好き？" });
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const res = await send(
      "/slack/interactions",
      deliverySubmission(deliveryValues(topic.id, "at", deadline)),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");

    const [round] = await db().select().from(rounds).where(eq(rounds.topicId, topic.id));
    expect(round).toMatchObject({
      channelId: "C0POST",
      deadlineAt: deadline,
      status: "open",
      messageTs: "1700000000.000100",
    });

    const post = api("chat.postMessage")[0]?.body;
    if (!post) throw new Error("not posted");
    expect(post.channel).toBe("C0POST");
    expect(post.text).toContain("夏と冬、どっちが好き？");
    const actions = (post.blocks as Array<Record<string, unknown>>).find(
      (b) => b.type === "actions",
    )?.elements as Array<Record<string, unknown>>;
    expect(actions[0]).toMatchObject({ action_id: IDS.answerButton, value: String(round?.id) });
    expect(actions[1]?.url).toBe(`http://localhost:8787/rounds/${round?.id}`);
  });

  it("「日時を指定」で日時がなければ、モーダルにエラーを出す", async () => {
    const { topic } = await makeTopic();
    const res = await send(
      "/slack/interactions",
      deliverySubmission(deliveryValues(topic.id, "at")),
    );
    const json = await res.json<{ response_action: string; errors: Record<string, string> }>();
    expect(json.response_action).toBe("errors");
    expect(json.errors[IDS.deadlineAtBlock]).toBeTruthy();
  });

  it("投稿に失敗したら配信を消し、実行した人だけに知らせる", async () => {
    replies["chat.postMessage"] = { ok: false, error: "not_in_channel" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { topic } = await makeTopic();
    await send("/slack/interactions", deliverySubmission(deliveryValues(topic.id, "none")));

    expect(await db().select().from(rounds).where(eq(rounds.topicId, topic.id))).toEqual([]);
    const notice = calls.find((c) => c.url.startsWith("https://hooks.slack.com/"));
    expect(notice?.body).toMatchObject({ response_type: "ephemeral", replace_original: false });
  });

  it("送信した人が管理者でなければ配信しない", async () => {
    const { topic } = await makeTopic();
    await send(
      "/slack/interactions",
      deliverySubmission(deliveryValues(topic.id, "none"), { id: "U0USER", team_id: "T0TEST" }),
    );
    expect(await db().select().from(rounds).where(eq(rounds.topicId, topic.id))).toEqual([]);
    const [after] = await db().select().from(topics).where(eq(topics.id, topic.id));
    expect(after?.lastUsedAt).toBeNull();
  });
});

describe("回答", () => {
  const pressAnswer = (roundId: number | string) =>
    interactionBody({
      response_url: "https://hooks.slack.com/actions/T0TEST/1/xyz",
      actions: [{ action_id: IDS.answerButton, value: String(roundId) }],
    });

  const answerSubmission = (roundId: number, choiceId: number | null) =>
    interactionBody({
      type: "view_submission",
      view: {
        id: "V1",
        callback_id: IDS.answerView,
        private_metadata: JSON.stringify({ roundId }),
        state: {
          values: {
            [IDS.choiceBlock]: {
              [IDS.choiceInput]: {
                type: "radio_buttons",
                selected_option: choiceId === null ? null : { value: String(choiceId) },
              },
            },
          },
        },
      },
    });

  it("「回答する」で回答モーダルを開く。記名のお題では名前が出ることを示す", async () => {
    const { topic } = await makeTopic({ question: "犬派？猫派？" });
    const round = await makeRound(topic.id, { resultVisibility: "named" });
    await send("/slack/interactions", pressAnswer(round.id));

    const view = api("views.open")[0]?.body.view as Record<string, unknown>;
    expect(view.callback_id).toBe(IDS.answerView);
    const text = JSON.stringify(view.blocks);
    expect(text).toContain("犬派？猫派？");
    expect(text).toContain("記名");
    expect(text).toContain("管理者");
  });

  it("受付が終わった配信では、モーダルを開かず本人だけに知らせる", async () => {
    const { topic } = await makeTopic();
    const round = await makeRound(topic.id, { status: "closed" });
    await send("/slack/interactions", pressAnswer(round.id));
    expect(api("views.open")).toEqual([]);
    const notice = calls.find((c) => c.url.startsWith("https://hooks.slack.com/"));
    expect(notice?.body).toMatchObject({ response_type: "ephemeral" });
  });

  it("送信すると保存し、お礼と結果ページへのリンクに差し替える。もう一度送ると上書きする", async () => {
    const { topic, choices } = await makeTopic();
    const round = await makeRound(topic.id);
    const [dog, cat] = choices;
    if (!dog || !cat) throw new Error("no choices");

    const res = await send("/slack/interactions", answerSubmission(round.id, dog.id));
    const json = await res.json<{ response_action: string; view: unknown }>();
    expect(json.response_action).toBe("update");
    expect(JSON.stringify(json.view)).toContain(`/rounds/${round.id}`);

    await send("/slack/interactions", answerSubmission(round.id, cat.id));
    const rows = await db().select().from(answers).where(eq(answers.roundId, round.id));
    expect(rows.map((r) => [r.userId, r.choiceId])).toEqual([["U0USER", cat.id]]);
  });

  it("選択しないで送ったらモーダルにエラーを出す", async () => {
    const { topic } = await makeTopic();
    const round = await makeRound(topic.id);
    const res = await send("/slack/interactions", answerSubmission(round.id, null));
    expect(await res.json()).toMatchObject({ response_action: "errors" });
  });

  it("ゲストは送信時に断り、保存しない", async () => {
    replies["users.info"] = { ok: true, user: { is_restricted: true } };
    const { topic, choices } = await makeTopic();
    const round = await makeRound(topic.id);
    const res = await send("/slack/interactions", answerSubmission(round.id, choices[0]?.id ?? 0));
    expect(JSON.stringify(await res.json())).toContain("ゲスト");
    expect(await db().select().from(answers).where(eq(answers.roundId, round.id))).toEqual([]);
  });

  it("ログに回答内容や user_id を出さない", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const { topic, choices } = await makeTopic({ question: "秘密のお題" });
    const round = await makeRound(topic.id);
    await send("/slack/interactions", answerSubmission(round.id, choices[0]?.id ?? 0));
    const logged = logs.mock.calls.flat().join("\n");
    expect(logged).toContain("answer_saved");
    expect(logged).not.toContain("U0USER");
    expect(logged).not.toContain("秘密のお題");
    expect(logged).not.toContain("犬");
  });
});
