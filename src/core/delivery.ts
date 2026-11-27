/**
 * 配信の作成と投稿。Slack には依存させず、投稿は Messenger を通して行う。
 */
import type { Db } from "../db/client";
import {
  countOpenUnlimitedRounds,
  createRound,
  deleteUnpostedRound,
  getRound,
  getSettings,
  getTopicWithChoices,
  listActiveChoiceTopics,
  type Round,
  setRoundMessageTs,
  type Topic,
} from "../db/repo";
import type { Messenger } from "./ports";
import { nextLocalTime } from "./time";

/** Block Kit の選択肢の上限に合わせた、手動配信で選べるお題の数 */
export const MAX_TOPIC_OPTIONS = 100;

/** 手動配信の締切の初期値（設定のタイムゾーンの時刻）。要件定義書では仮 */
export const DEFAULT_DEADLINE_TIME = "18:00";

/** 締切は今から少なくともこれだけ先にする（秒） */
export const MIN_DEADLINE_LEAD_SECONDS = 5 * 60;

export const MIN_CHOICES = 2;
export const MAX_CHOICES = 4;

/**
 * 投稿先のチャンネル。設定の対象チャンネルがあればそこ、なければコマンドを実行したチャンネル。
 * （2026-11-20 決定。対象チャンネルは管理画面［ステップ7］で設定する）
 */
export function resolveTargetChannel(
  settingsChannelId: string | null,
  invokedChannelId: string,
): string {
  return settingsChannelId ?? invokedChannelId;
}

export type ManualDeliveryForm = {
  topics: Topic[];
  /** 締切の初期値（UNIX秒） */
  defaultDeadlineAt: number;
  timezone: string;
  /** 設定で決まっている対象チャンネル（未設定なら null） */
  settingsChannelId: string | null;
};

/** 手動配信のモーダルに出すもの */
export async function prepareManualDelivery(db: Db, now: number): Promise<ManualDeliveryForm> {
  const [settings, topics] = await Promise.all([
    getSettings(db),
    listActiveChoiceTopics(db, MAX_TOPIC_OPTIONS),
  ]);
  return {
    topics,
    defaultDeadlineAt: nextLocalTime(
      now,
      settings.timezone,
      DEFAULT_DEADLINE_TIME,
      MIN_DEADLINE_LEAD_SECONDS,
    ),
    timezone: settings.timezone,
    settingsChannelId: settings.channelId,
  };
}

export type ManualDeliveryInput = {
  topicId: string;
  channelId: string;
  /** 無期限は null */
  deadlineAt: number | null;
  now: number;
};

export type ManualDeliveryError = "topic_unavailable" | "deadline_past" | "unlimited_limit";

export type ManualDeliveryResult =
  | { ok: true; round: Round }
  | { ok: false; error: ManualDeliveryError };

/**
 * 手動配信（チャンネル型）を受付中で作る。投稿はしない（publishRound で行う）。
 * 入力の誤りはモーダルに出せるようにエラーの種類で返す。
 */
export async function startManualChannelRound(
  db: Db,
  input: ManualDeliveryInput,
): Promise<ManualDeliveryResult> {
  const found = await getTopicWithChoices(db, input.topicId);
  if (!found || !isDeliverable(found.topic, found.choices.length)) {
    return { ok: false, error: "topic_unavailable" };
  }

  if (input.deadlineAt !== null && input.deadlineAt < input.now + MIN_DEADLINE_LEAD_SECONDS) {
    return { ok: false, error: "deadline_past" };
  }

  if (input.deadlineAt === null) {
    const [settings, open] = await Promise.all([getSettings(db), countOpenUnlimitedRounds(db)]);
    if (open >= settings.maxOpenUnlimited) return { ok: false, error: "unlimited_limit" };
  }

  const round = await createRound(db, {
    topicId: found.topic.id,
    type: "channel",
    resultVisibility: found.topic.resultVisibility,
    channelId: input.channelId,
    deadlineAt: input.deadlineAt,
    createdAt: input.now,
  });
  return { ok: true, round };
}

function isDeliverable(topic: Topic, choiceCount: number): boolean {
  return (
    topic.isActive &&
    topic.answerFormat === "choice" &&
    choiceCount >= MIN_CHOICES &&
    choiceCount <= MAX_CHOICES
  );
}

export type PublishResult = "posted" | "already_posted" | "not_found" | "failed";

/**
 * 配信をチャンネルに投稿し、ts を記録する。投稿済みなら何もしない（二重投稿を防ぐ）。
 * 投稿に失敗したら、誰も回答できない配信を残さないよう配信を消す。
 */
export async function publishRound(
  db: Db,
  messenger: Messenger,
  roundId: number,
): Promise<{ result: PublishResult; error?: unknown }> {
  const round = await getRound(db, roundId);
  if (!round) return { result: "not_found" };
  if (round.messageTs !== null) return { result: "already_posted" };

  const [found, settings] = await Promise.all([
    getTopicWithChoices(db, round.topicId),
    getSettings(db),
  ]);
  if (!found) return { result: "not_found" };

  try {
    const { messageTs } = await messenger.postRound({
      roundId: round.id,
      channelId: round.channelId,
      question: found.topic.question,
      deadlineAt: round.deadlineAt,
      timezone: settings.timezone,
    });
    await setRoundMessageTs(db, round.id, messageTs);
    return { result: "posted" };
  } catch (error) {
    await deleteUnpostedRound(db, round.id);
    return { result: "failed", error };
  }
}
