/**
 * コマンドとボタン・モーダル送信の処理。Slack には3秒以内に応答し、
 * 投稿など待たなくてよい処理は waitUntil に回す。
 */
import type { Context } from "hono";
import { isAdmin } from "../core/admin";
import { checkCanOpenAnswer, submitAnswer } from "../core/answering";
import { announceResult, closeRound, listClosableRounds } from "../core/closing";
import {
  type ManualDeliveryError,
  prepareManualDelivery,
  publishRound,
  resolveTargetChannel,
  startManualChannelRound,
} from "../core/delivery";
import { createDb, type Db } from "../db/client";
import { getSettings } from "../db/repo";
import type { MessageKey } from "../i18n";
import { t } from "../i18n";
import { log } from "../log";
import { respondEphemeral, SlackApiError, SlackClient } from "./api";
import {
  type AnswerMetadata,
  answerModal,
  type CloseMetadata,
  closeModal,
  type DeliveryMetadata,
  deliveryModal,
  IDS,
  messageModal,
  REJECTION_KEYS,
  thanksModal,
} from "./blocks";
import type { SlackEnv } from "./middleware";
import type { InteractionPayload, SlashCommand } from "./payload";

type Ctx = Context<SlackEnv>;

const nowSeconds = () => Math.floor(Date.now() / 1000);

function deps(c: Ctx): { db: Db; slack: SlackClient } {
  return {
    db: createDb(c.env.DB),
    slack: new SlackClient(c.var.config.slackBotToken, c.var.config.appBaseUrl),
  };
}

const ephemeral = (c: Ctx, text: string) => c.json({ response_type: "ephemeral", text });

function errorCode(err: unknown): string {
  return err instanceof SlackApiError ? err.code : "exception";
}

/* ---------- スラッシュコマンド ---------- */

export async function handleCommand(c: Ctx, cmd: SlashCommand): Promise<Response> {
  const sub = cmd.text.trim().toLowerCase();
  if (sub === "optout" || sub === "optin") return ephemeral(c, t("command.notReady"));
  if (sub === "close") return handleCloseCommand(c, cmd);
  if (sub !== "") return ephemeral(c, t("command.usage", { command: cmd.command }));

  const { db, slack } = deps(c);
  if (!(await isAdmin(db, c.var.config.adminUserIds, cmd.userId))) {
    return ephemeral(c, t("command.adminOnly"));
  }

  try {
    const form = await prepareManualDelivery(db, nowSeconds());
    if (form.topics.length === 0) return ephemeral(c, t("command.noTopics"));

    const channelId = resolveTargetChannel(form.settingsChannelId, cmd.channelId);
    if (!(await slack.isBotInChannel(channelId))) {
      return ephemeral(
        c,
        form.settingsChannelId
          ? t("command.botNotInTargetChannel", { channel: channelId })
          : t("command.botNotInChannel"),
      );
    }

    const metadata: DeliveryMetadata = { channelId, responseUrl: cmd.responseUrl };
    await slack.openView(cmd.triggerId, deliveryModal(form, metadata));
  } catch (err) {
    log.error("delivery_modal_failed", { code: errorCode(err) });
    return ephemeral(c, t("command.failed"));
  }
  return c.body(null, 200);
}

/** `/konomi close`：受付中の配信を選んで終了するモーダルを開く（管理者のみ） */
async function handleCloseCommand(c: Ctx, cmd: SlashCommand): Promise<Response> {
  const { db, slack } = deps(c);
  if (!(await isAdmin(db, c.var.config.adminUserIds, cmd.userId))) {
    return ephemeral(c, t("command.closeAdminOnly"));
  }
  try {
    const [rounds, settings] = await Promise.all([listClosableRounds(db), getSettings(db)]);
    if (rounds.length === 0) return ephemeral(c, t("command.noOpenRounds"));
    const metadata: CloseMetadata = { responseUrl: cmd.responseUrl };
    await slack.openView(cmd.triggerId, closeModal(rounds, settings.timezone, metadata));
  } catch (err) {
    log.error("close_modal_failed", { code: errorCode(err) });
    return ephemeral(c, t("command.failed"));
  }
  return c.body(null, 200);
}

/* ---------- ボタン・モーダル送信 ---------- */

export async function handleInteraction(c: Ctx, payload: InteractionPayload): Promise<Response> {
  if (payload.type === "block_actions") return handleBlockActions(c, payload);
  if (payload.type === "view_submission") {
    const view = asRecord(payload.view);
    if (view?.callback_id === IDS.deliveryView) return handleDeliverySubmit(c, payload, view);
    if (view?.callback_id === IDS.answerView) return handleAnswerSubmit(c, payload, view);
    if (view?.callback_id === IDS.closeView) return handleCloseSubmit(c, payload, view);
  }
  // 結果ページへのリンクボタンなど、何もしない操作も 200 で受け取る
  return c.body(null, 200);
}

async function handleBlockActions(c: Ctx, payload: InteractionPayload): Promise<Response> {
  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  const action = actions.map(asRecord).find((a) => a?.action_id === IDS.answerButton);
  if (!action) return c.body(null, 200);

  const roundId = parseId(action.value);
  const triggerId = typeof payload.trigger_id === "string" ? payload.trigger_id : "";
  const responseUrl = typeof payload.response_url === "string" ? payload.response_url : "";
  const { db, slack } = deps(c);

  const check =
    roundId === null
      ? ({ ok: false, reason: "not_found" } as const)
      : await checkCanOpenAnswer(db, { roundId, userId: payload.user.id, now: nowSeconds() });

  if (!check.ok) {
    c.executionCtx.waitUntil(
      respondEphemeral(responseUrl, t(REJECTION_KEYS[check.reason])).catch(() =>
        log.warn("ephemeral_failed", { kind: "answer_rejected" }),
      ),
    );
    return c.body(null, 200);
  }

  try {
    await slack.openView(triggerId, answerModal(check.context));
  } catch (err) {
    log.error("answer_modal_failed", { round: check.context.round.id, code: errorCode(err) });
  }
  return c.body(null, 200);
}

async function handleDeliverySubmit(
  c: Ctx,
  payload: InteractionPayload,
  view: Record<string, unknown>,
): Promise<Response> {
  const { db, slack } = deps(c);
  // 送信時にも管理者かを確かめる（モーダルを開いたあとに外された場合など）
  if (!(await isAdmin(db, c.var.config.adminUserIds, payload.user.id))) {
    return c.json({ response_action: "update", view: messageModal([t("command.adminOnly")]) });
  }

  const metadata = parseMetadata<DeliveryMetadata>(view.private_metadata);
  const values = stateValues(view);
  const topicId = selectedValue(values, IDS.topicBlock, IDS.topicInput);
  const kind = selectedValue(values, IDS.deadlineKindBlock, IDS.deadlineKindInput);
  const at = values?.[IDS.deadlineAtBlock]?.[IDS.deadlineAtInput]?.selected_date_time;

  if (!metadata || typeof metadata.channelId !== "string" || !topicId) {
    return errors(c, IDS.topicBlock, "delivery.error.topicUnavailable");
  }
  if (kind === "at" && typeof at !== "number") {
    return errors(c, IDS.deadlineAtBlock, "delivery.error.deadlineMissing");
  }

  const now = nowSeconds();
  const result = await startManualChannelRound(db, {
    topicId,
    channelId: metadata.channelId,
    deadlineAt: kind === "none" ? null : (at as number),
    now,
  });
  if (!result.ok) return deliveryError(c, db, result.error);

  const roundId = result.round.id;
  c.executionCtx.waitUntil(
    (async () => {
      const { result: published, error } = await publishRound(db, slack, roundId);
      if (published === "failed") {
        log.error("round_post_failed", { round: roundId, code: errorCode(error) });
        await respondEphemeral(metadata.responseUrl ?? "", t("delivery.error.postFailed"));
      } else {
        log.info("round_posted", { round: roundId, result: published });
      }
    })().catch((err) => log.error("round_post_failed", { round: roundId, code: errorCode(err) })),
  );
  // 空の応答でモーダルを閉じる
  return c.body(null, 200);
}

async function deliveryError(c: Ctx, db: Db, error: ManualDeliveryError): Promise<Response> {
  switch (error) {
    case "topic_unavailable":
      return errors(c, IDS.topicBlock, "delivery.error.topicUnavailable");
    case "deadline_past":
      return errors(c, IDS.deadlineAtBlock, "delivery.error.deadlinePast");
    case "unlimited_limit": {
      const settings = await getSettings(db);
      return c.json({
        response_action: "errors",
        errors: {
          [IDS.deadlineKindBlock]: t("delivery.error.unlimitedLimit", {
            max: settings.maxOpenUnlimited,
          }),
        },
      });
    }
  }
}

async function handleAnswerSubmit(
  c: Ctx,
  payload: InteractionPayload,
  view: Record<string, unknown>,
): Promise<Response> {
  const metadata = parseMetadata<AnswerMetadata>(view.private_metadata);
  const roundId = parseId(metadata?.roundId);
  const choiceId = parseId(selectedValue(stateValues(view), IDS.choiceBlock, IDS.choiceInput));
  if (roundId === null) {
    return c.json({
      response_action: "update",
      view: messageModal([t(REJECTION_KEYS.not_found)]),
    });
  }
  if (choiceId === null) return errors(c, IDS.choiceBlock, "answer.error.choice");

  const { db, slack } = deps(c);
  let result: Awaited<ReturnType<typeof submitAnswer>>;
  try {
    result = await submitAnswer(db, slack, {
      roundId,
      userId: payload.user.id,
      choiceId,
      now: nowSeconds(),
    });
  } catch (err) {
    log.error("answer_failed", { round: roundId, code: errorCode(err) });
    return c.json({ response_action: "update", view: messageModal([t("command.failed")]) });
  }

  if (result.ok) {
    log.info("answer_saved", { round: roundId });
    return c.json({
      response_action: "update",
      view: thanksModal(c.var.config.appBaseUrl, roundId),
    });
  }
  if (result.reason === "invalid_choice") return errors(c, IDS.choiceBlock, "answer.error.choice");
  return c.json({
    response_action: "update",
    view: messageModal([t(REJECTION_KEYS[result.reason])]),
  });
}

/**
 * 手動終了のモーダルの送信。終了（D1 の更新1回）までをその場で行い、
 * スレッドへの結果の投稿は waitUntil に回す
 */
async function handleCloseSubmit(
  c: Ctx,
  payload: InteractionPayload,
  view: Record<string, unknown>,
): Promise<Response> {
  const { db, slack } = deps(c);
  if (!(await isAdmin(db, c.var.config.adminUserIds, payload.user.id))) {
    return c.json({
      response_action: "update",
      view: messageModal([t("command.closeAdminOnly")], "close.modalTitle"),
    });
  }

  const metadata = parseMetadata<CloseMetadata>(view.private_metadata);
  const roundId = parseId(
    selectedValue(stateValues(view), IDS.closeRoundBlock, IDS.closeRoundInput),
  );
  if (roundId === null) return errors(c, IDS.closeRoundBlock, "close.error.unavailable");

  const closed = await closeRound(db, roundId);
  if (closed.result !== "closed") return errors(c, IDS.closeRoundBlock, "close.error.unavailable");
  log.info("round_closed", { round: roundId, reason: "manual" });

  c.executionCtx.waitUntil(
    (async () => {
      const { result, error } = await announceResult(db, slack, roundId, "manual");
      if (result === "failed") {
        log.error("result_post_failed", { round: roundId, code: errorCode(error) });
        await respondEphemeral(metadata?.responseUrl ?? "", t("close.error.postFailed"));
      } else {
        log.info("result_posted", { round: roundId, result });
      }
    })().catch((err) => log.error("result_post_failed", { round: roundId, code: errorCode(err) })),
  );
  return c.json({
    response_action: "update",
    view: messageModal([t("close.done")], "close.modalTitle"),
  });
}

/* ---------- 小さな道具 ---------- */

function errors(c: Ctx, blockId: string, key: MessageKey): Response {
  return c.json({ response_action: "errors", errors: { [blockId]: t(key) } });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 正の整数の ID（文字列でも数でも） */
function parseId(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function parseMetadata<T>(raw: unknown): Partial<T> | null {
  if (typeof raw !== "string") return null;
  try {
    return asRecord(JSON.parse(raw)) as Partial<T> | null;
  } catch {
    return null;
  }
}

type StateValues = Record<string, Record<string, Record<string, unknown>>>;

function stateValues(view: Record<string, unknown>): StateValues | null {
  const values = asRecord(asRecord(view.state)?.values);
  return values as StateValues | null;
}

function selectedValue(values: StateValues | null, block: string, action: string): string | null {
  const option = asRecord(values?.[block]?.[action]?.selected_option);
  return typeof option?.value === "string" ? option.value : null;
}
