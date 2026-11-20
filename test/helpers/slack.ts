/** テスト用に Slack と同じ方法で署名したリクエストを作る */

export const SIGNING_SECRET = "test-signing-secret";
export const TEAM_ID = "T0TEST";

const encoder = new TextEncoder();

export async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`v0:${timestamp}:${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `v0=${hex}`;
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);

type SignedRequestOptions = {
  secret?: string;
  timestamp?: number;
  /** 署名を書き換えたいときに使う */
  signature?: string;
};

export async function signedRequest(
  path: string,
  body: string,
  options: SignedRequestOptions = {},
): Promise<Request> {
  const timestamp = String(options.timestamp ?? nowSeconds());
  const signature =
    options.signature ?? (await sign(options.secret ?? SIGNING_SECRET, timestamp, body));
  return new Request(`http://example.com${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": signature,
    },
    body,
  });
}

export function commandBody(overrides: Record<string, string> = {}): string {
  return new URLSearchParams({
    token: "deprecated",
    team_id: TEAM_ID,
    team_domain: "example",
    channel_id: "C0CHANNEL",
    channel_name: "general",
    user_id: "U0USER",
    user_name: "someone",
    command: "/konomi",
    text: "",
    api_app_id: "A0APP",
    response_url: "https://hooks.slack.com/commands/T0TEST/1/abc",
    trigger_id: "1.2.3",
    ...overrides,
  }).toString();
}

export function interactionBody(payload: Record<string, unknown> = {}): string {
  return new URLSearchParams({
    payload: JSON.stringify({
      type: "block_actions",
      team: { id: TEAM_ID, domain: "example" },
      user: { id: "U0USER", username: "someone", team_id: TEAM_ID },
      trigger_id: "1.2.3",
      actions: [],
      ...payload,
    }),
  }).toString();
}
