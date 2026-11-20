import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/index";
import {
  commandBody,
  interactionBody,
  nowSeconds,
  SIGNING_SECRET,
  signedRequest,
} from "../helpers/slack";

const fetchWorker = (req: Request) => exports.default.fetch(req);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /slack/commands", () => {
  it("正しい署名と team_id なら 200 で本人だけに見える応答を返す", async () => {
    const res = await fetchWorker(await signedRequest("/slack/commands", commandBody()));
    expect(res.status).toBe(200);
    const json = await res.json<{ response_type: string; text: string }>();
    expect(json.response_type).toBe("ephemeral");
    expect(json.text).not.toBe("");
  });

  it("署名が違えば 401", async () => {
    const req = await signedRequest("/slack/commands", commandBody(), { secret: "wrong" });
    expect((await fetchWorker(req)).status).toBe(401);
  });

  it("署名ヘッダーがなければ 401", async () => {
    const req = new Request("http://example.com/slack/commands", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: commandBody(),
    });
    expect((await fetchWorker(req)).status).toBe(401);
  });

  it("5分より古いタイムスタンプは、署名が正しくても 401（リプレイ対策）", async () => {
    const req = await signedRequest("/slack/commands", commandBody(), {
      timestamp: nowSeconds() - 5 * 60 - 1,
    });
    expect((await fetchWorker(req)).status).toBe(401);
  });

  it("別のワークスペースからは 403", async () => {
    const req = await signedRequest("/slack/commands", commandBody({ team_id: "T0OTHER" }));
    expect((await fetchWorker(req)).status).toBe(403);
  });

  it("team_id がなければ 400", async () => {
    const body = commandBody();
    const params = new URLSearchParams(body);
    params.delete("team_id");
    const req = await signedRequest("/slack/commands", params.toString());
    expect((await fetchWorker(req)).status).toBe(400);
  });

  it("ボタン操作の本文が届いたら 400", async () => {
    const req = await signedRequest("/slack/commands", interactionBody());
    expect((await fetchWorker(req)).status).toBe(400);
  });
});

describe("POST /slack/interactions", () => {
  it("正しい署名と team_id なら空の 200", async () => {
    const res = await fetchWorker(await signedRequest("/slack/interactions", interactionBody()));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("モーダルの送信も受け付ける", async () => {
    const body = interactionBody({ type: "view_submission", view: { id: "V0", state: {} } });
    expect((await fetchWorker(await signedRequest("/slack/interactions", body))).status).toBe(200);
  });

  it("署名が違えば 401", async () => {
    const req = await signedRequest("/slack/interactions", interactionBody(), { secret: "wrong" });
    expect((await fetchWorker(req)).status).toBe(401);
  });

  it("別のワークスペースからは 403", async () => {
    const body = interactionBody({ team: { id: "T0OTHER" } });
    expect((await fetchWorker(await signedRequest("/slack/interactions", body))).status).toBe(403);
  });

  it("Slack Connect の外部ユーザー（user.team_id が違う）は 403", async () => {
    const body = interactionBody({ user: { id: "U0EXT", team_id: "T0OTHER" } });
    expect((await fetchWorker(await signedRequest("/slack/interactions", body))).status).toBe(403);
  });

  it("payload が JSON でなければ 400", async () => {
    const body = new URLSearchParams({ payload: "{not json" }).toString();
    expect((await fetchWorker(await signedRequest("/slack/interactions", body))).status).toBe(400);
  });

  it("コマンドの本文が届いたら 400", async () => {
    const req = await signedRequest("/slack/interactions", commandBody());
    expect((await fetchWorker(req)).status).toBe(400);
  });
});

describe("/slack/* の共通の扱い", () => {
  it("知らないパスも、署名がなければ 401（存在を明かさない）", async () => {
    const req = new Request("http://example.com/slack/unknown", { method: "POST", body: "" });
    expect((await fetchWorker(req)).status).toBe(401);
  });

  it("設定値が足りなければ 500 を返し、ログには名前だけを出す", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const badEnv = { ...env, SLACK_TEAM_ID: "", SLACK_BOT_TOKEN: "xoxp-do-not-log" };
    const req = await signedRequest("/slack/commands", commandBody());
    const res = await app.request(req, undefined, badEnv);

    expect(res.status).toBe(500);
    const logged = errors.mock.calls.flat().join("\n");
    expect(logged).toContain("SLACK_TEAM_ID:missing");
    expect(logged).toContain("SLACK_BOT_TOKEN:invalid");
    expect(logged).not.toContain("xoxp-do-not-log");
    expect(logged).not.toContain(SIGNING_SECRET);
  });

  it("拒否したときのログに ID や本文を出さない", async () => {
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    const req = await signedRequest("/slack/commands", commandBody({ team_id: "T0OTHER" }));
    expect((await fetchWorker(req)).status).toBe(403);
    const logged = warns.mock.calls.flat().join("\n");
    expect(logged).toContain("team_mismatch");
    expect(logged).not.toContain("T0OTHER");
    expect(logged).not.toContain("U0USER");
  });

  it("/healthz は設定値がなくても動く", async () => {
    const res = await app.request("/healthz", undefined, { ...env, SLACK_TEAM_ID: "" });
    expect(res.status).toBe(200);
  });
});
