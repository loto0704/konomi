import type { Messenger, RoundPost, RoundResultPost } from "../../src/core/ports";

/** 投稿を記録するだけの Messenger。fail を立てると投稿が失敗する */
export class FakeMessenger implements Messenger {
  posts: RoundPost[] = [];
  results: RoundResultPost[] = [];
  fail = false;

  async postRound(post: RoundPost) {
    if (this.fail) throw new Error("boom");
    this.posts.push(post);
    return { messageTs: `ts-${post.roundId}` };
  }

  async postRoundResult(post: RoundResultPost) {
    if (this.fail) throw new Error("boom");
    this.results.push(post);
  }
}
