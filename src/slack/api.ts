/**
 * Slack Web API の小さなクライアント。使うメソッドだけを持つ。
 * トークンや本文はエラーにもログにも含めない（エラーには Slack のエラーコードだけを入れる）。
 */
import type { Directory, Messenger, RoundPost } from "../core/ports";
import { roundMessage } from "./blocks";

const API_BASE = "https://slack.com/api";

/** conversations.info で「ボットからは見えない」ことを表すエラー（DM、未参加の非公開チャンネルなど） */
const NOT_VISIBLE = new Set([
  "channel_not_found",
  "missing_scope",
  "method_not_supported_for_channel_type",
]);

export class SlackApiError extends Error {
  readonly code: string;
  /** 429 のときの Retry-After（秒） */
  readonly retryAfter: number | undefined;

  constructor(method: string, code: string, retryAfter?: number) {
    super(`Slack API ${method} failed: ${code}`);
    this.name = "SlackApiError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

type SlackResponse = { ok: boolean; error?: string; [key: string]: unknown };

export class SlackClient implements Messenger, Directory {
  constructor(
    private readonly token: string,
    private readonly appBaseUrl: string,
  ) {}

  async call<T extends SlackResponse>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${API_BASE}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? "1");
      throw new SlackApiError(method, "ratelimited", Number.isFinite(retryAfter) ? retryAfter : 1);
    }
    if (!res.ok) throw new SlackApiError(method, `http_${res.status}`);
    const json = (await res.json()) as T;
    if (!json.ok) throw new SlackApiError(method, json.error ?? "unknown_error");
    return json;
  }

  async openView(triggerId: string, view: Record<string, unknown>): Promise<void> {
    await this.call("views.open", { trigger_id: triggerId, view });
  }

  /** ボットがそのチャンネルに参加しているか。見えないチャンネル（DM、未参加の非公開）は false */
  async isBotInChannel(channelId: string): Promise<boolean> {
    try {
      const res = await this.call<SlackResponse & { channel?: { is_member?: boolean } }>(
        "conversations.info",
        { channel: channelId },
      );
      return res.channel?.is_member === true;
    } catch (err) {
      if (err instanceof SlackApiError && NOT_VISIBLE.has(err.code)) return false;
      throw err;
    }
  }

  async postRound(post: RoundPost): Promise<{ messageTs: string }> {
    const message = roundMessage(post, this.appBaseUrl);
    const res = await this.call<SlackResponse & { ts?: string }>("chat.postMessage", {
      channel: post.channelId,
      ...message,
    });
    if (typeof res.ts !== "string") throw new SlackApiError("chat.postMessage", "missing_ts");
    return { messageTs: res.ts };
  }

  async isGuest(userId: string): Promise<boolean> {
    const res = await this.call<
      SlackResponse & { user?: { is_restricted?: boolean; is_ultra_restricted?: boolean } }
    >("users.info", { user: userId });
    return res.user?.is_restricted === true || res.user?.is_ultra_restricted === true;
  }
}

/**
 * response_url に本人だけに見えるメッセージを送る（元のメッセージは書き換えない）。
 * response_url は Slack のドメインのものだけを受け付ける。
 */
export async function respondEphemeral(responseUrl: string, text: string): Promise<void> {
  if (!isSlackResponseUrl(responseUrl)) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }),
  });
}

export function isSlackResponseUrl(raw: string): boolean {
  if (!URL.canParse(raw)) return false;
  const url = new URL(raw);
  return url.protocol === "https:" && url.hostname === "hooks.slack.com";
}
