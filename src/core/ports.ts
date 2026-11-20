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

export interface Messenger {
  /** 配信をチャンネルに投稿し、投稿の ts を返す */
  postRound(post: RoundPost): Promise<{ messageTs: string }>;
}

export interface Directory {
  /** ゲスト（マルチチャンネル・シングルチャンネル）か */
  isGuest(userId: string): Promise<boolean>;
}
