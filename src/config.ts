/**
 * 設定値（Workers の vars と Secrets）の読み込みと検証。
 *
 * - 値そのものは例外のメッセージにもログにも含めない。分かるのは名前と理由だけ
 * - Hono や Slack に依存させない（src/core からも使えるように）
 */

export type Config = {
  slackBotToken: string;
  slackSigningSecret: string;
  slackClientId: string;
  slackClientSecret: string;
  sessionSecret: string;
  /** 受け付けるワークスペース（T から始まる ID） */
  slackTeamId: string;
  /** 最初の管理者。重複を除いた U／W から始まる ID の一覧（1人以上） */
  adminUserIds: readonly string[];
  /** 結果ページ・管理画面のオリジン（末尾の / なし。例：https://konomi.example.workers.dev） */
  appBaseUrl: string;
};

/** Config の元になる env の項目 */
export type ConfigSource = Pick<
  Env,
  | "SLACK_BOT_TOKEN"
  | "SLACK_SIGNING_SECRET"
  | "SLACK_CLIENT_ID"
  | "SLACK_CLIENT_SECRET"
  | "SESSION_SECRET"
  | "SLACK_TEAM_ID"
  | "ADMIN_USER_IDS"
  | "APP_BASE_URL"
>;

export type ConfigIssue = {
  name: keyof ConfigSource;
  reason: "missing" | "invalid";
};

/** 設定値の不足や形式の誤り。メッセージには名前と理由だけを入れる */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(`Invalid config: ${issues.map((i) => `${i.name} (${i.reason})`).join(", ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

const TEAM_ID = /^T[A-Z0-9]+$/;
const USER_ID = /^[UW][A-Z0-9]+$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** env を検証して Config を返す。問題があればすべてまとめて ConfigError を投げる */
export function loadConfig(env: ConfigSource): Config {
  const issues: ConfigIssue[] = [];

  const required = (name: keyof ConfigSource): string => {
    const value = (env[name] ?? "").trim();
    if (value === "") issues.push({ name, reason: "missing" });
    return value;
  };
  const check = (name: keyof ConfigSource, value: string, ok: boolean) => {
    if (value !== "" && !ok) issues.push({ name, reason: "invalid" });
  };

  const slackBotToken = required("SLACK_BOT_TOKEN");
  check("SLACK_BOT_TOKEN", slackBotToken, slackBotToken.startsWith("xoxb-"));
  const slackSigningSecret = required("SLACK_SIGNING_SECRET");
  const slackClientId = required("SLACK_CLIENT_ID");
  const slackClientSecret = required("SLACK_CLIENT_SECRET");
  const sessionSecret = required("SESSION_SECRET");

  const slackTeamId = required("SLACK_TEAM_ID");
  check("SLACK_TEAM_ID", slackTeamId, TEAM_ID.test(slackTeamId));

  const adminRaw = required("ADMIN_USER_IDS");
  const adminUserIds = [
    ...new Set(
      adminRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== ""),
    ),
  ];
  check(
    "ADMIN_USER_IDS",
    adminRaw,
    adminUserIds.length > 0 && adminUserIds.every((id) => USER_ID.test(id)),
  );

  const baseRaw = required("APP_BASE_URL");
  const appBaseUrl = parseBaseUrl(baseRaw);
  check("APP_BASE_URL", baseRaw, appBaseUrl !== null);

  if (issues.length > 0) throw new ConfigError(issues);

  return {
    slackBotToken,
    slackSigningSecret,
    slackClientId,
    slackClientSecret,
    sessionSecret,
    slackTeamId,
    adminUserIds,
    appBaseUrl: appBaseUrl ?? "",
  };
}

/**
 * APP_BASE_URL はオリジンだけ（パス・クエリ・フラグメントなし）を受け付ける。
 * https 必須。手元の開発用に localhost だけは http を許す。
 */
function parseBaseUrl(raw: string): string | null {
  if (!URL.canParse(raw)) return null;
  const url = new URL(raw);
  const secure =
    url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
  if (!secure || url.username || url.password) return null;
  if (url.pathname !== "/" || url.search || url.hash) return null;
  return url.origin;
}
