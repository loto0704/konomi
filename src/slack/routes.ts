import { Hono } from "hono";
import { withConfig } from "../app-env";
import { t } from "../i18n";
import { type SlackEnv, verifySlackRequest } from "./middleware";

/**
 * Slack からのリクエストの受け口（/slack/*）。
 * 署名・ワークスペースの確認はすべてのパスに掛かる。中身の処理はステップ3で作る。
 */
export const slackRoutes = new Hono<SlackEnv>();

slackRoutes.use("*", withConfig, verifySlackRequest);

/** スラッシュコマンド（/konomi、/konomi optout、/konomi optin） */
slackRoutes.post("/commands", (c) => {
  if (c.var.slack.kind !== "command") return c.text("Bad Request", 400);
  return c.json({ response_type: "ephemeral", text: t("command.notReady") });
});

/** ボタン、モーダルの送信。空の 200 で受け取ったことだけを返す */
slackRoutes.post("/interactions", (c) => {
  if (c.var.slack.kind !== "interaction") return c.text("Bad Request", 400);
  return c.body(null, 200);
});
