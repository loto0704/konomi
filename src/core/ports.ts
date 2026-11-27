/**
 * core が外（Slack など）を呼ぶための型。実装は src/slack などに置き、core は型だけを知る。
 * 将来 Discord に対応するときは、同じ型を実装するだけで core を変えない。
 */

/** チャンネルに投稿する配信の中身 */
export type RoundPost = {
  roundId: number;
  channelId: string;
  question: string;
  /** 締切（UNIX秒）。無期限は null */
  deadlineAt: number | null;
  timezone: string;
};

/** 選択肢ごとの集計 */
export type TallyItem = {
  label: string;
  count: number;
  /** 割合（0〜100 の整数。四捨五入） */
  percent: number;
};

/** 終了した配信の結果の概要。元の投稿のスレッドに投稿する */
export type RoundResultPost = {
  roundId: number;
  channelId: string;
  /** 元の投稿の ts（スレッドの親） */
  threadTs: string;
  /** deadline：締切で終了、manual：手動で終了 */
  reason: "deadline" | "manual";
  items: TallyItem[];
  /** 回答した人数 */
  total: number;
};

export interface Messenger {
  /** 配信をチャンネルに投稿し、投稿の ts を返す */
  postRound(post: RoundPost): Promise<{ messageTs: string }>;
  /** 結果の概要を元の投稿のスレッドに投稿する（元の投稿は書き換えない） */
  postRoundResult(post: RoundResultPost): Promise<void>;
}

export interface Directory {
  /** ゲスト（マルチチャンネル・シングルチャンネル）か */
  isGuest(userId: string): Promise<boolean>;
}
