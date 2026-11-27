/**
 * Block Kit の組み立て（チャンネルへの投稿、手動配信のモーダル、回答のモーダル）。
 * 文言はすべて i18n から引く。
 */
import type { AnswerContext } from "../core/answering";
import type { ManualDeliveryForm } from "../core/delivery";
import type { RoundPost, RoundResultPost } from "../core/ports";
import { formatShort } from "../core/time";
import type { OpenRoundSummary } from "../db/repo";
import type { MessageKey } from "../i18n";
import { t } from "../i18n";

/** モーダルの callback_id とボタンの action_id */
export const IDS = {
  deliveryView: "konomi_delivery",
  answerView: "konomi_answer",
  answerButton: "konomi_answer_open",
  resultButton: "konomi_result_link",
  topicBlock: "topic",
  topicInput: "topic_select",
  deadlineKindBlock: "deadline_kind",
  deadlineKindInput: "deadline_kind_radio",
  deadlineAtBlock: "deadline_at",
  deadlineAtInput: "deadline_at_picker",
  choiceBlock: "choice",
  choiceInput: "choice_radio",
  closeView: "konomi_close",
  closeRoundBlock: "close_round",
  closeRoundInput: "close_round_select",
} as const;

type Block = Record<string, unknown>;
type View = Record<string, unknown>;

const plain = (text: string) => ({ type: "plain_text", text, emoji: true });
const mrkdwn = (text: string) => ({ type: "mrkdwn", text });

/** Slack の plain_text の上限に合わせて切る */
function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/** mrkdwn に入れるユーザー入力の & < > を逃がす */
export function escapeMrkdwn(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** 締切の表示。見る人のタイムゾーンで出す Slack の日付書式を使い、代わりの文字列は設定のタイムゾーン */
function deadlineText(deadlineAt: number | null, timezone: string): string {
  if (deadlineAt === null) return t("round.noDeadline");
  const fallback = formatShort(deadlineAt, timezone);
  return t("round.deadline", {
    deadline: `<!date^${deadlineAt}^{date_short_pretty} {time}|${fallback}>`,
  });
}

export function resultUrl(appBaseUrl: string, roundId: number): string {
  return `${appBaseUrl}/rounds/${roundId}`;
}

/** チャンネルに投稿するお題 */
export function roundMessage(
  post: RoundPost,
  appBaseUrl: string,
): { text: string; blocks: Block[] } {
  const question = escapeMrkdwn(post.question);
  const deadline = deadlineText(post.deadlineAt, post.timezone);
  return {
    text: `${t("round.header")}：${post.question}`,
    blocks: [
      {
        type: "section",
        text: mrkdwn(`*${t("round.header")}*\n${question}`),
      },
      { type: "context", elements: [mrkdwn(deadline)] },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: IDS.answerButton,
            text: plain(t("round.answerButton")),
            style: "primary",
            value: String(post.roundId),
          },
          {
            type: "button",
            action_id: IDS.resultButton,
            text: plain(t("round.resultButton")),
            url: resultUrl(appBaseUrl, post.roundId),
          },
        ],
      },
    ],
  };
}

/** 終了した配信の結果の概要（元の投稿のスレッドに投稿する） */
export function roundResultMessage(
  post: RoundResultPost,
  appBaseUrl: string,
): { text: string; blocks: Block[] } {
  const heading = t(post.reason === "manual" ? "result.closedManually" : "result.closedByDeadline");
  const summary =
    post.total === 0
      ? t("result.noAnswers")
      : post.items
          .map((item) =>
            t("result.item", {
              label: escapeMrkdwn(item.label),
              count: item.count,
              percent: item.percent,
            }),
          )
          .join("\n");
  const plainSummary =
    post.total === 0
      ? t("result.noAnswers")
      : post.items.map((item) => `${item.label} ${item.percent}%`).join(" / ");
  return {
    text: `${heading} ${plainSummary}`,
    blocks: [
      { type: "section", text: mrkdwn(`*${heading}*\n${summary}`) },
      { type: "context", elements: [mrkdwn(t("result.total", { total: post.total }))] },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: IDS.resultButton,
            text: plain(t("round.resultButton")),
            url: resultUrl(appBaseUrl, post.roundId),
          },
        ],
      },
    ],
  };
}

/** 手動終了のモーダルの private_metadata */
export type CloseMetadata = { responseUrl: string };

/** 受付中の配信を選んで終了するモーダル */
export function closeModal(
  rounds: readonly OpenRoundSummary[],
  timezone: string,
  metadata: CloseMetadata,
): View {
  return {
    type: "modal",
    callback_id: IDS.closeView,
    private_metadata: JSON.stringify(metadata),
    title: plain(t("close.modalTitle")),
    submit: plain(t("close.submit")),
    close: plain(t("delivery.cancel")),
    blocks: [
      {
        type: "input",
        block_id: IDS.closeRoundBlock,
        label: plain(t("close.roundLabel")),
        element: {
          type: "static_select",
          action_id: IDS.closeRoundInput,
          placeholder: plain(t("close.roundPlaceholder")),
          options: rounds.map(({ round, question }) => ({
            text: plain(truncate(question, 75)),
            description: plain(
              truncate(
                round.deadlineAt === null
                  ? t("close.optionNoDeadline")
                  : t("close.optionDeadline", {
                      deadline: formatShort(round.deadlineAt, timezone),
                    }),
                75,
              ),
            ),
            value: String(round.id),
          })),
        },
      },
      { type: "context", elements: [mrkdwn(t("close.note"))] },
    ],
  };
}

/** 手動配信のモーダルの private_metadata */
export type DeliveryMetadata = { channelId: string; responseUrl: string };

export function deliveryModal(form: ManualDeliveryForm, metadata: DeliveryMetadata): View {
  return {
    type: "modal",
    callback_id: IDS.deliveryView,
    private_metadata: JSON.stringify(metadata),
    title: plain(t("delivery.modalTitle")),
    submit: plain(t("delivery.submit")),
    close: plain(t("delivery.cancel")),
    blocks: [
      {
        type: "input",
        block_id: IDS.topicBlock,
        label: plain(t("delivery.topicLabel")),
        hint: plain(t("delivery.topicHint")),
        element: {
          type: "static_select",
          action_id: IDS.topicInput,
          placeholder: plain(t("delivery.topicPlaceholder")),
          options: form.topics.map((topic) => ({
            text: plain(truncate(topic.question, 75)),
            value: topic.id,
          })),
        },
      },
      {
        type: "input",
        block_id: IDS.deadlineKindBlock,
        label: plain(t("delivery.deadlineKindLabel")),
        element: {
          type: "radio_buttons",
          action_id: IDS.deadlineKindInput,
          initial_option: deadlineOption("at"),
          options: [deadlineOption("at"), deadlineOption("none")],
        },
      },
      {
        type: "input",
        block_id: IDS.deadlineAtBlock,
        optional: true,
        label: plain(t("delivery.deadlineAtLabel")),
        hint: plain(t("delivery.deadlineAtHint")),
        element: {
          type: "datetimepicker",
          action_id: IDS.deadlineAtInput,
          initial_date_time: form.defaultDeadlineAt,
        },
      },
      {
        type: "context",
        elements: [
          mrkdwn(t("delivery.typeNote")),
          mrkdwn(t("delivery.channelNote", { channel: metadata.channelId })),
        ],
      },
    ],
  };
}

function deadlineOption(kind: "at" | "none") {
  return {
    text: plain(t(kind === "at" ? "delivery.deadlineAt" : "delivery.deadlineNone")),
    value: kind,
  };
}

/** 回答のモーダルの private_metadata */
export type AnswerMetadata = { roundId: number };

export function answerModal(ctx: AnswerContext): View {
  const options = ctx.choices.map((c) => ({
    text: plain(truncate(c.label, 75)),
    value: String(c.id),
  }));
  const initial = options.find((o) => o.value === String(ctx.current?.choiceId));
  const notices: string[] = [deadlineText(ctx.round.deadlineAt, ctx.timezone)];
  if (ctx.current) notices.push(t("answer.alreadyAnswered"));

  const blocks: Block[] = [
    { type: "section", text: mrkdwn(`*${escapeMrkdwn(ctx.topic.question)}*`) },
    { type: "context", elements: notices.map((n) => mrkdwn(n)) },
    {
      type: "input",
      block_id: IDS.choiceBlock,
      label: plain(t("answer.choiceLabel")),
      element: {
        type: "radio_buttons",
        action_id: IDS.choiceInput,
        options,
        ...(initial ? { initial_option: initial } : {}),
      },
    },
  ];
  const privacy: string[] = [];
  if (ctx.round.resultVisibility === "named") privacy.push(t("answer.namedNotice"));
  privacy.push(t("answer.adminNotice"));
  blocks.push({ type: "context", elements: privacy.map((n) => mrkdwn(n)) });

  return {
    type: "modal",
    callback_id: IDS.answerView,
    private_metadata: JSON.stringify({ roundId: ctx.round.id } satisfies AnswerMetadata),
    title: plain(t("answer.modalTitle")),
    submit: plain(t("answer.submit")),
    close: plain(t("answer.close")),
    blocks,
  };
}

/** 回答後や、回答できないときに差し替える、送信ボタンのないモーダル */
export function messageModal(lines: string[], title: MessageKey = "answer.modalTitle"): View {
  return {
    type: "modal",
    title: plain(t(title)),
    close: plain(t("answer.close")),
    blocks: lines.map((line) => ({ type: "section", text: mrkdwn(line) })),
  };
}

export function thanksModal(appBaseUrl: string, roundId: number): View {
  return messageModal([
    t("answer.thanks"),
    t("answer.resultLink", { url: resultUrl(appBaseUrl, roundId) }),
  ]);
}

export const REJECTION_KEYS = {
  not_found: "answer.rejected.notFound",
  closed: "answer.rejected.closed",
  opted_out: "answer.rejected.optedOut",
  excluded: "answer.rejected.excluded",
  guest: "answer.rejected.guest",
} as const satisfies Record<string, MessageKey>;
