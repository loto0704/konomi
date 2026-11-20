import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app-env";
import { log } from "../log";
import { isFromTeam, parseSlackBody, type SlackRequest } from "./payload";
import { verifySlackSignature } from "./signature";

export type SlackEnv = AppEnv & { Variables: { slack: SlackRequest } };

/**
 * /slack/* の共通の入口。次の順で確かめ、通ったものだけ c.var.slack に入れて先へ進める。
 *
 * 1. 署名とタイムスタンプ（5分以内）。違えば 401
 * 2. 本文の形（form か、payload の JSON）。違えば 400
 * 3. team_id が SLACK_TEAM_ID と一致するか。違えば 403
 *
 * withConfig の後に置くこと。ログには理由だけを出し、ID や本文は出さない。
 */
export const verifySlackRequest = createMiddleware<SlackEnv>(async (c, next) => {
  // form の本文に .text() を使うと workerd が警告を出すため、バイト列から読む
  const body = new TextDecoder().decode(await c.req.arrayBuffer());
  const result = await verifySlackSignature({
    signingSecret: c.var.config.slackSigningSecret,
    timestamp: c.req.header("X-Slack-Request-Timestamp"),
    signature: c.req.header("X-Slack-Signature"),
    body,
    now: Math.floor(Date.now() / 1000),
  });
  if (!result.ok) {
    log.warn("slack_rejected", { reason: `signature_${result.reason}` });
    return c.text("Unauthorized", 401);
  }

  const slack = parseSlackBody(body);
  if (!slack) {
    log.warn("slack_rejected", { reason: "bad_payload" });
    return c.text("Bad Request", 400);
  }

  if (!isFromTeam(slack, c.var.config.slackTeamId)) {
    log.warn("slack_rejected", { reason: "team_mismatch", kind: slack.kind });
    return c.text("Forbidden", 403);
  }

  c.set("slack", slack);
  await next();
});
