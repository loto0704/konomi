import { describe, expect, it } from "vitest";
import { ConfigError, type ConfigSource, loadConfig } from "../src/config";

const valid: ConfigSource = {
  SLACK_BOT_TOKEN: "xoxb-secret-token",
  SLACK_SIGNING_SECRET: "signing-secret-value",
  SLACK_CLIENT_ID: "123.456",
  SLACK_CLIENT_SECRET: "client-secret-value",
  SESSION_SECRET: "session-secret-value",
  SLACK_TEAM_ID: "T0123ABC",
  ADMIN_USER_IDS: "U01, U02 ,,W03,U01",
  APP_BASE_URL: "https://konomi.example.workers.dev/",
};

function issuesOf(source: ConfigSource) {
  try {
    loadConfig(source);
  } catch (err) {
    if (err instanceof ConfigError) return err.issues;
    throw err;
  }
  throw new Error("ConfigError was not thrown");
}

describe("loadConfig", () => {
  it("正しい値を読み込み、管理者を分割・重複除去し、URL をオリジンにする", () => {
    const config = loadConfig(valid);
    expect(config.slackTeamId).toBe("T0123ABC");
    expect(config.adminUserIds).toEqual(["U01", "U02", "W03"]);
    expect(config.appBaseUrl).toBe("https://konomi.example.workers.dev");
    expect(config.slackBotToken).toBe("xoxb-secret-token");
  });

  it("手元の開発用に localhost だけは http を許す", () => {
    expect(loadConfig({ ...valid, APP_BASE_URL: "http://localhost:8787" }).appBaseUrl).toBe(
      "http://localhost:8787",
    );
    expect(issuesOf({ ...valid, APP_BASE_URL: "http://konomi.example.com" })).toEqual([
      { name: "APP_BASE_URL", reason: "invalid" },
    ]);
  });

  it("空や空白だけの値は missing として、すべてまとめて報告する", () => {
    const issues = issuesOf({
      ...valid,
      SLACK_SIGNING_SECRET: "",
      SESSION_SECRET: "  ",
      ADMIN_USER_IDS: "",
    });
    expect(issues).toEqual([
      { name: "SLACK_SIGNING_SECRET", reason: "missing" },
      { name: "SESSION_SECRET", reason: "missing" },
      { name: "ADMIN_USER_IDS", reason: "missing" },
    ]);
  });

  it.each([
    ["SLACK_BOT_TOKEN", "xoxp-user-token"],
    ["SLACK_TEAM_ID", "E0123ABC"],
    ["SLACK_TEAM_ID", "t0123abc"],
    ["ADMIN_USER_IDS", "U01,someone"],
    ["ADMIN_USER_IDS", " , "],
    ["APP_BASE_URL", "konomi.example.com"],
    ["APP_BASE_URL", "https://konomi.example.com/app"],
    ["APP_BASE_URL", "https://konomi.example.com/?a=1"],
    ["APP_BASE_URL", "https://user:pass@konomi.example.com"],
  ] as const)("%s = %j は invalid", (name, value) => {
    expect(issuesOf({ ...valid, [name]: value })).toEqual([{ name, reason: "invalid" }]);
  });

  it("エラーのメッセージに値を含めない", () => {
    try {
      loadConfig({ ...valid, SLACK_BOT_TOKEN: "xoxp-leak-me", APP_BASE_URL: "ftp://leak.example" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const message = (err as Error).message;
      expect(message).toContain("SLACK_BOT_TOKEN");
      expect(message).not.toContain("leak");
    }
  });
});
