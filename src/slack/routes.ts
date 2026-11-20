import { Hono } from "hono";
import { withConfig } from "../app-env";
import { handleCommand, handleInteraction } from "./handlers";
import { type SlackEnv, verifySlackRequest } from "./middleware";

/**
 * Slack からのリクエストの受け口（/slack/*）。
 * 署名・ワークスペースの確認はすべてのパスに掛かる。
 */
export const slackRoutes = new Hono<SlackEnv>();

slackRoutes.use("*", withConfig, verifySlackRequest);

/** スラッシュコマンド（/konomi、/konomi optout、/konomi optin） */
slackRoutes.post("/commands", (c) => {
  const slack = c.var.slack;
  if (slack.kind !== "command") return c.text("Bad Request", 400);
  return handleCommand(c, slack.command);
});

/** ボタン、モーダルの送信 */
slackRoutes.post("/interactions", (c) => {
  const slack = c.var.slack;
  if (slack.kind !== "interaction") return c.text("Bad Request", 400);
  return handleInteraction(c, slack.payload);
});
