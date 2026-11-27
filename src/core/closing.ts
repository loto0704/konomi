/**
 * 配信の終了（締切・手動）と、スレッドへの結果の投稿。Slack には依存させず、投稿は Messenger を通して行う。
 *
 * 終了は「受付中なら終了にする」という条件付きの更新で行い、更新できたときだけ結果を投稿する。
 * 締切の Cron と手動終了が重なっても、Cron が二重に動いても、結果の投稿は1回だけになる。
 */
import type { Db } from "../db/client";
import {
  closeOpenRound,
  getRound,
  listDueRoundIds,
  listOpenRounds,
  loadRoundTally,
  type OpenRoundSummary,
  type Round,
  type TopicChoice,
} from "../db/repo";
import type { Messenger, RoundResultPost, TallyItem } from "./ports";

/**
 * Cron の1回で終了させる配信の数。1件につき D1 が2回（更新、集計の batch）と Slack への投稿が1回。
 * 1回の処理での外部リクエストと D1 クエリを50件未満に収めるための上限。残りは次の回（5分後）に回す
 */
export const DUE_ROUNDS_PER_RUN = 10;

/** 手動終了のモーダルに出す配信の数（Block Kit の選択肢の上限） */
export const MAX_OPEN_ROUND_OPTIONS = 100;

export type CloseReason = RoundResultPost["reason"];

/** 選択肢ごとの票数と割合。選択肢の並び順のまま、0票の選択肢も含める */
export function tally(
  choices: readonly TopicChoice[],
  counts: readonly { choiceId: number; n: number }[],
): { items: TallyItem[]; total: number } {
  const byChoice = new Map(counts.map((c) => [c.choiceId, c.n]));
  const total = choices.reduce((sum, c) => sum + (byChoice.get(c.id) ?? 0), 0);
  const items = choices.map((c) => {
    const n = byChoice.get(c.id) ?? 0;
    return { label: c.label, count: n, percent: total === 0 ? 0 : Math.round((n / total) * 100) };
  });
  return { items, total };
}

export type CloseResult =
  | { result: "closed"; round: Round }
  | { result: "already_closed" }
  | { result: "not_found" };

/** 受付中の配信を終了にする。結果の投稿はしない（announceResult で行う） */
export async function closeRound(db: Db, roundId: number): Promise<CloseResult> {
  const round = await closeOpenRound(db, roundId);
  if (round) return { result: "closed", round };
  return (await getRound(db, roundId)) ? { result: "already_closed" } : { result: "not_found" };
}

export type AnnounceResult = "posted" | "not_posted" | "not_found" | "failed";

/**
 * 終了した配信の結果の概要を、元の投稿のスレッドに1件投稿する。
 * 投稿されていない配信（message_ts がない）はスレッドがないため投稿しない。
 * DM型（依頼した各人のスレッドへの投稿）はステップ5で足す。
 */
export async function announceResult(
  db: Db,
  messenger: Messenger,
  roundId: number,
  reason: CloseReason,
): Promise<{ result: AnnounceResult; error?: unknown }> {
  const data = await loadRoundTally(db, roundId);
  if (!data) return { result: "not_found" };
  const { round } = data;
  if (round.type !== "channel" || round.messageTs === null) return { result: "not_posted" };

  const { items, total } = tally(data.choices, data.counts);
  try {
    await messenger.postRoundResult({
      roundId: round.id,
      channelId: round.channelId,
      threadTs: round.messageTs,
      reason,
      items,
      total,
    });
    return { result: "posted" };
  } catch (error) {
    return { result: "failed", error };
  }
}

export type DueRunReport = {
  closed: number;
  posted: number;
  failed: { roundId: number; error: unknown }[];
};

/**
 * 締切を過ぎた配信を終了にし、結果を投稿する（Cron から呼ぶ）。
 * 1回に DUE_ROUNDS_PER_RUN 件まで。ほかの処理が先に終了させた配信は飛ばす。
 */
export async function closeDueRounds(
  db: Db,
  messenger: Messenger,
  now: number,
): Promise<DueRunReport> {
  const ids = await listDueRoundIds(db, now, DUE_ROUNDS_PER_RUN);
  const report: DueRunReport = { closed: 0, posted: 0, failed: [] };
  for (const id of ids) {
    const closed = await closeRound(db, id);
    if (closed.result !== "closed") continue;
    report.closed++;
    const { result, error } = await announceResult(db, messenger, id, "deadline");
    if (result === "posted") report.posted++;
    if (result === "failed") report.failed.push({ roundId: id, error });
  }
  return report;
}

/** 手動終了のモーダルに出す、投稿済みで受付中の配信 */
export function listClosableRounds(db: Db): Promise<OpenRoundSummary[]> {
  return listOpenRounds(db, MAX_OPEN_ROUND_OPTIONS);
}
