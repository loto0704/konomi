/**
 * 回答できるかの判定と、回答の保存。
 *
 * 回答できる人（チャンネル型）：締切前で受付中の配信に対し、オプトアウトしておらず、
 * 管理者に除外されておらず、ゲストを除外する設定ならゲストでない人。
 * チャンネルのメンバーかどうかは API で確かめない（ボタンが見えるのはメンバーのため）。
 * DM型（round_targets にいる人だけ）はステップ5で足す。
 */
import type { Db } from "../db/client";
import {
  type Answer,
  loadAnswerContext,
  type Round,
  type Topic,
  type TopicChoice,
  upsertAnswer,
} from "../db/repo";
import type { Directory } from "./ports";

export type AnswerRejection = "not_found" | "closed" | "opted_out" | "excluded" | "guest";

export type AnswerContext = {
  round: Round;
  topic: Topic;
  choices: TopicChoice[];
  current: Answer | null;
  timezone: string;
};

export type CheckResult =
  | { ok: true; context: AnswerContext }
  | { ok: false; reason: AnswerRejection };

export function isAcceptingAnswers(round: Round, now: number): boolean {
  return round.status === "open" && (round.deadlineAt === null || now < round.deadlineAt);
}

/**
 * 回答モーダルを開く前の判定。D1 の読み取りだけで行い（batch 1回）、外部 API は呼ばない。
 * ゲストかどうかは送信時（submitAnswer）に確かめる。
 */
export async function checkCanOpenAnswer(
  db: Db,
  input: { roundId: number; userId: string; now: number },
): Promise<CheckResult> {
  const ctx = await loadAnswerContext(db, input.roundId, input.userId);
  if (!ctx) return { ok: false, reason: "not_found" };
  if (!isAcceptingAnswers(ctx.round, input.now)) return { ok: false, reason: "closed" };
  if (ctx.preference?.optedOut) return { ok: false, reason: "opted_out" };
  if (ctx.preference?.excludedByAdmin) return { ok: false, reason: "excluded" };
  return {
    ok: true,
    context: {
      round: ctx.round,
      topic: ctx.topic,
      choices: ctx.choices,
      current: ctx.answer,
      timezone: ctx.settings.timezone,
    },
  };
}

export type SubmitResult =
  | { ok: true; roundId: number }
  | { ok: false; reason: AnswerRejection | "invalid_choice" };

/** 回答の送信。もう一度すべてを確かめてから保存する（締切まで何度でも上書きできる） */
export async function submitAnswer(
  db: Db,
  directory: Directory,
  input: { roundId: number; userId: string; choiceId: number; now: number },
): Promise<SubmitResult> {
  const ctx = await loadAnswerContext(db, input.roundId, input.userId);
  if (!ctx) return { ok: false, reason: "not_found" };
  if (!isAcceptingAnswers(ctx.round, input.now)) return { ok: false, reason: "closed" };
  if (ctx.preference?.optedOut) return { ok: false, reason: "opted_out" };
  if (ctx.preference?.excludedByAdmin) return { ok: false, reason: "excluded" };
  if (!ctx.choices.some((c) => c.id === input.choiceId)) {
    return { ok: false, reason: "invalid_choice" };
  }
  if (!ctx.settings.includeGuests && (await directory.isGuest(input.userId))) {
    return { ok: false, reason: "guest" };
  }

  await upsertAnswer(db, input);
  return { ok: true, roundId: ctx.round.id };
}
