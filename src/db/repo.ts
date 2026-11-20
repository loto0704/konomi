/**
 * テーブルの読み書き。src/core からはここの関数だけを使い、SQL や Drizzle を直接書かない。
 * 複数の書き込みは D1 のトランザクションではなく batch() でまとめる。
 */
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./client";
import {
  admins,
  answers,
  type ResultVisibility,
  type RoundType,
  rounds,
  settings,
  topicChoices,
  topics,
  userPreferences,
} from "./schema";

export type Settings = typeof settings.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type TopicChoice = typeof topicChoices.$inferSelect;
export type Round = typeof rounds.$inferSelect;
export type Answer = typeof answers.$inferSelect;
export type UserPreference = typeof userPreferences.$inferSelect;

/** settings の1行。マイグレーションで必ず入っているが、なければ初期値で返す */
export async function getSettings(db: Db): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  return row ?? DEFAULT_SETTINGS;
}

const DEFAULT_SETTINGS: Settings = {
  id: 1,
  channelId: null,
  timezone: "Asia/Tokyo",
  excludeRecentDays: 7,
  includeGuests: false,
  maxOpenUnlimited: 10,
  retentionDays: 365,
};

/** 管理画面で追加された管理者か */
export async function isAdminInDb(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: admins.userId })
    .from(admins)
    .where(eq(admins.userId, userId));
  return row !== undefined;
}

/**
 * 有効な選択肢型のお題。未使用のもの、使ってから時間がたったものの順に limit 件。
 * 手動配信のモーダルの一覧に使う
 */
export async function listActiveChoiceTopics(db: Db, limit: number): Promise<Topic[]> {
  return db
    .select()
    .from(topics)
    .where(and(eq(topics.isActive, true), eq(topics.answerFormat, "choice")))
    .orderBy(sql`${topics.lastUsedAt} IS NOT NULL`, asc(topics.lastUsedAt), asc(topics.question))
    .limit(limit);
}

/** お題と選択肢（位置の順） */
export async function getTopicWithChoices(
  db: Db,
  topicId: string,
): Promise<{ topic: Topic; choices: TopicChoice[] } | null> {
  const [topicRows, choices] = await db.batch([
    db.select().from(topics).where(eq(topics.id, topicId)),
    db
      .select()
      .from(topicChoices)
      .where(eq(topicChoices.topicId, topicId))
      .orderBy(asc(topicChoices.position)),
  ]);
  const topic = topicRows[0];
  return topic ? { topic, choices } : null;
}

/** 受付中の無期限の配信の数 */
export async function countOpenUnlimitedRounds(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(rounds)
    .where(and(eq(rounds.status, "open"), isNull(rounds.deadlineAt)));
  return row?.n ?? 0;
}

export type NewRound = {
  topicId: string;
  type: RoundType;
  resultVisibility: ResultVisibility;
  channelId: string;
  deadlineAt: number | null;
  createdAt: number;
};

/** 配信を受付中で作り、お題の last_used_at を更新する（batch で1回） */
export async function createRound(db: Db, input: NewRound): Promise<Round> {
  const [inserted] = await db.batch([
    db
      .insert(rounds)
      .values({ ...input, scheduleId: null, status: "open" })
      .returning(),
    db.update(topics).set({ lastUsedAt: input.createdAt }).where(eq(topics.id, input.topicId)),
  ]);
  const round = inserted[0];
  if (!round) throw new Error("round not inserted");
  return round;
}

export async function getRound(db: Db, roundId: number): Promise<Round | null> {
  const [row] = await db.select().from(rounds).where(eq(rounds.id, roundId));
  return row ?? null;
}

/** 投稿した ts を記録する。まだ空のときだけ更新し、更新できたかを返す */
export async function setRoundMessageTs(
  db: Db,
  roundId: number,
  messageTs: string,
): Promise<boolean> {
  const rows = await db
    .update(rounds)
    .set({ messageTs })
    .where(and(eq(rounds.id, roundId), isNull(rounds.messageTs)))
    .returning({ id: rounds.id });
  return rows.length > 0;
}

/** 投稿できなかった配信を消す。投稿済み（message_ts あり）なら消さない */
export async function deleteUnpostedRound(db: Db, roundId: number): Promise<void> {
  await db.delete(rounds).where(and(eq(rounds.id, roundId), isNull(rounds.messageTs)));
}

/** 回答の可否の判定に必要なものを batch で1回で読む */
export async function loadAnswerContext(
  db: Db,
  roundId: number,
  userId: string,
): Promise<{
  round: Round;
  topic: Topic;
  choices: TopicChoice[];
  answer: Answer | null;
  preference: UserPreference | null;
  settings: Settings;
} | null> {
  const [roundRows, topicRows, choices, answerRows, prefRows, settingsRows] = await db.batch([
    db.select().from(rounds).where(eq(rounds.id, roundId)),
    db
      .select({ topic: topics })
      .from(rounds)
      .innerJoin(topics, eq(topics.id, rounds.topicId))
      .where(eq(rounds.id, roundId)),
    db
      .select({ choice: topicChoices })
      .from(rounds)
      .innerJoin(topicChoices, eq(topicChoices.topicId, rounds.topicId))
      .where(eq(rounds.id, roundId))
      .orderBy(asc(topicChoices.position)),
    db
      .select()
      .from(answers)
      .where(and(eq(answers.roundId, roundId), eq(answers.userId, userId))),
    db.select().from(userPreferences).where(eq(userPreferences.userId, userId)),
    db.select().from(settings).where(eq(settings.id, 1)),
  ]);
  const round = roundRows[0];
  const topic = topicRows[0]?.topic;
  if (!round || !topic) return null;
  return {
    round,
    topic,
    choices: choices.map((r) => r.choice),
    answer: answerRows[0] ?? null,
    preference: prefRows[0] ?? null,
    settings: settingsRows[0] ?? DEFAULT_SETTINGS,
  };
}

/** 回答を保存する。同じ人の2回目以降は選択肢と updated_at を上書きする */
export async function upsertAnswer(
  db: Db,
  input: { roundId: number; userId: string; choiceId: number; now: number },
): Promise<void> {
  await db
    .insert(answers)
    .values({
      roundId: input.roundId,
      userId: input.userId,
      choiceId: input.choiceId,
      answeredAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [answers.roundId, answers.userId],
      set: { choiceId: input.choiceId, updatedAt: input.now },
    });
}
