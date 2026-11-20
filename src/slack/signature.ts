/**
 * Slack のリクエスト署名の検証。
 * https://docs.slack.dev/authentication/verifying-requests-from-slack
 *
 * `v0:{timestamp}:{生の本文}` を Signing Secret で HMAC-SHA256 し、`X-Slack-Signature` と比べる。
 * 比較は crypto.subtle.verify で行う（定数時間）。
 */

/** タイムスタンプのずれの許容（秒）。これを超えたらリプレイとみなして拒否する */
export const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export type SignatureInput = {
  signingSecret: string;
  /** X-Slack-Request-Timestamp */
  timestamp: string | undefined;
  /** X-Slack-Signature（`v0=` ＋ 16進64桁） */
  signature: string | undefined;
  /** 受け取ったままの本文 */
  body: string;
  /** 現在時刻（UNIX秒） */
  now: number;
};

export type SignatureResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "stale" | "mismatch" };

const encoder = new TextEncoder();

export async function verifySlackSignature(input: SignatureInput): Promise<SignatureResult> {
  const { timestamp, signature } = input;
  if (!timestamp || !signature) return { ok: false, reason: "missing" };

  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "mismatch" };
  if (Math.abs(input.now - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "stale" };
  }

  const match = /^v0=([0-9a-f]{64})$/.exec(signature);
  if (!match?.[1]) return { ok: false, reason: "mismatch" };

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(match[1]),
    encoder.encode(`v0:${timestamp}:${input.body}`),
  );
  return valid ? { ok: true } : { ok: false, reason: "mismatch" };
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
