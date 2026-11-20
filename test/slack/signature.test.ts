import { describe, expect, it } from "vitest";
import { MAX_CLOCK_SKEW_SECONDS, verifySlackSignature } from "../../src/slack/signature";
import { sign } from "../helpers/slack";

const secret = "8f742231b10e8888abcd99yyyzzz85a5";
const body = "token=xyz&team_id=T0TEST&command=%2Fkonomi&text=";
const now = 1_700_000_000;

async function input(overrides: Partial<Parameters<typeof verifySlackSignature>[0]> = {}) {
  const timestamp = String(now);
  return {
    signingSecret: secret,
    timestamp,
    signature: await sign(secret, timestamp, body),
    body,
    now,
    ...overrides,
  };
}

describe("verifySlackSignature", () => {
  it("正しい署名を受け付ける", async () => {
    expect(await verifySlackSignature(await input())).toEqual({ ok: true });
  });

  it("Slack のドキュメントの例と同じ結果になる", async () => {
    // https://docs.slack.dev/authentication/verifying-requests-from-slack の例
    const docBody =
      "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c";
    const result = await verifySlackSignature({
      signingSecret: "8f742231b10e8888abcd99yyyzzz85a5",
      timestamp: "1531420618",
      signature: "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503",
      body: docBody,
      now: 1531420618,
    });
    expect(result).toEqual({ ok: true });
  });

  it("本文が1文字でも違えば拒否する", async () => {
    const result = await verifySlackSignature({ ...(await input()), body: `${body}x` });
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });

  it("別の Signing Secret で署名されたものは拒否する", async () => {
    const result = await verifySlackSignature({ ...(await input()), signingSecret: "other" });
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });

  it("ヘッダーがなければ拒否する", async () => {
    expect(await verifySlackSignature(await input({ timestamp: undefined }))).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(await verifySlackSignature(await input({ signature: undefined }))).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("形のおかしい署名・タイムスタンプは拒否する", async () => {
    for (const signature of ["v1=abc", "v0=zz", `v0=${"A".repeat(64)}`, "garbage"]) {
      expect(await verifySlackSignature(await input({ signature }))).toEqual({
        ok: false,
        reason: "mismatch",
      });
    }
    expect(await verifySlackSignature(await input({ timestamp: "12ab" }))).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("ちょうど5分のずれは受け付け、5分を超えたら拒否する", async () => {
    const base = await input();
    expect(await verifySlackSignature({ ...base, now: now + MAX_CLOCK_SKEW_SECONDS })).toEqual({
      ok: true,
    });
    expect(await verifySlackSignature({ ...base, now: now + MAX_CLOCK_SKEW_SECONDS + 1 })).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(await verifySlackSignature({ ...base, now: now - MAX_CLOCK_SKEW_SECONDS - 1 })).toEqual({
      ok: false,
      reason: "stale",
    });
  });
});
