# konomi

Daily "this or that" prompts for your team in Slack — spark casual conversation by asking what people like.

konomi（好み）は、Slackのメンバーに「好きなもの・こと」のお題を配信し、モーダルで回答してもらい、集計結果をWebページで共有するSlackアプリです。各組織が自分のCloudflareとSlack Appでセルフホストします（1つの環境で1つのワークスペース）。

> 開発中です。仕様は [docs/requirements.md](docs/requirements.md)、基本設計は [docs/design.md](docs/design.md) を参照してください。セットアップ手順は実装に合わせて追記していきます。

## 必要なもの

- Node.js 22 以上、pnpm 10
- Cloudflare アカウント（Workers、D1。無料プランで動く想定）
- Slack ワークスペースと、自分で作る Slack App

## 手元での開発

```sh
pnpm install
cp .dev.vars.example .dev.vars   # 値を入れる。.dev.vars はコミットしない
pnpm db:migrate:local            # ローカルの D1 にマイグレーションを当てる
pnpm dev                         # http://localhost:8787
```

| コマンド | 内容 |
| --- | --- |
| `pnpm lint` | Biome で Lint と整形の確認 |
| `pnpm format` | Biome で自動整形 |
| `pnpm typecheck` | `wrangler.jsonc` と型定義（`worker-configuration.d.ts`）のずれの確認と、TypeScript の型チェック |
| `pnpm test` | Vitest（Workers のランタイム上で、ローカルの D1 を使って実行） |
| `pnpm db:generate` | `src/db/schema.ts` の変更からマイグレーションの SQL を作る |
| `pnpm cf-typegen` | `wrangler.jsonc` を変えたあとに型定義を作り直す |

## 環境と設定値

`wrangler.jsonc` に3つの環境があります。

| 環境 | 用途 | Worker | D1 |
| --- | --- | --- | --- |
| 最上位 | 手元の開発とテスト | `konomi-local` | ローカルのみ |
| `env.dev` | 開発用 | `konomi-dev` | `konomi-dev-db` |
| `env.production` | 本番用 | `konomi` | `konomi-db` |

| 名前 | 種類 | 内容 |
| --- | --- | --- |
| `SLACK_BOT_TOKEN` | Secret | Bot トークン |
| `SLACK_SIGNING_SECRET` | Secret | Slack からのリクエストの署名検証 |
| `SLACK_CLIENT_ID`／`SLACK_CLIENT_SECRET` | Secret | Sign in with Slack |
| `SESSION_SECRET` | Secret | セッションの署名 |
| `SLACK_TEAM_ID` | 変数 | 受け付けるワークスペースの ID（`T` で始まる） |
| `ADMIN_USER_IDS` | 変数 | 最初の管理者のメンバー ID（`U` か `W` で始まる）。カンマ区切りで1人以上 |
| `APP_BASE_URL` | 変数 | 結果ページ・管理画面の URL。オリジンだけ（例：`https://konomi.example.workers.dev`）。`https` 必須で、`localhost` だけは `http` でよい |

- 値が空や形式違いのとき、Slack からのリクエストなどには 500 を返し、Workers のログに `config_invalid` と項目の名前だけを出します（値は出しません）。`/healthz` は設定値に関係なく応答します
- 変数は `wrangler.jsonc` の各環境の `vars` に書きます
- Secrets は `pnpm exec wrangler secret put <名前> --env production` で設定します。DB やリポジトリには置きません
- D1 は名前（`database_name`）だけを書き、`database_id` は書きません。初回のデプロイで同じ名前の D1 が自動で作られます

## Slack App を作る

konomi は配布用の Slack App を持ちません。導入する組織ごとに、リポジトリの `manifest.yml` から自分の Slack App を作ります。

1. `manifest.yml` の `YOUR-WORKER.example.workers.dev`（3か所）を、自分の Worker の URL（`APP_BASE_URL` と同じオリジン）に置き換える
2. [Slack API の Your Apps](https://api.slack.com/apps) で「Create New App」→「From a manifest」を選び、ワークスペースを選んで中身を貼り付ける
3. 「Install App」から自分のワークスペースにインストールする
4. 次の値を Secrets と変数に設定する

| Slack App の画面 | 値 | 設定先 |
| --- | --- | --- |
| Basic Information → App Credentials | Client ID／Client Secret／Signing Secret | `SLACK_CLIENT_ID`／`SLACK_CLIENT_SECRET`／`SLACK_SIGNING_SECRET` |
| OAuth & Permissions | Bot User OAuth Token（`xoxb-`） | `SLACK_BOT_TOKEN` |
| ブラウザで Slack を開いたときの URL（`https://app.slack.com/client/T…/…`） | `T` で始まる部分 | `SLACK_TEAM_ID` |
| Slack のプロフィール →「メンバー ID をコピー」 | 管理者のメンバー ID（`U`…） | `ADMIN_USER_IDS` |

Bot のスコープは `chat:write`、`commands`、`channels:read`、`groups:read`、`users:read` の5つです。Sign in with Slack の `openid` と `profile` はログインのときに要求するため、マニフェストには書いていません。

### Slack から届くリクエスト

| パス | 用途 |
| --- | --- |
| `POST /slack/commands` | `/konomi` コマンド（コマンド名は仮） |
| `POST /slack/interactions` | ボタンとモーダルの送信 |

どちらも、Slack の署名とタイムスタンプ（5分以内）を確認し、`team_id` が `SLACK_TEAM_ID` と一致するものだけを受け付けます。ボタンやモーダルは操作した人の所属ワークスペースも確認するため、Slack Connect の外部ユーザーは使えません。拒否したときは 401（署名）／400（本文の形）／403（ワークスペース）を返します。

## 使い方

### お題を配信する（`/konomi`）

管理者（`ADMIN_USER_IDS` の人と、管理画面で追加した人）が `/konomi` を実行すると、配信のモーダルが開きます。

1. お題を選ぶ（未使用のお題、使ってから時間がたったお題の順に並びます）
2. 締切を選ぶ（日時を指定するか、無期限。初期値は次の 18:00）
3. 「配信する」を押すと、チャンネルにお題と「回答する」「結果を見る」が投稿されます

- 投稿先は、管理画面で設定した対象チャンネルです。まだ設定していなければ `/konomi` を実行したチャンネルに投稿します
- konomi が参加していないチャンネルには投稿できません。先にそのチャンネルで `/invite @konomi` を実行してください
- 受付中の無期限の配信は、同時に10件まで（設定で変更可）です
- 今は配信タイプはチャンネル型だけです

### 締切と終了（`/konomi close`）

- 締切を過ぎると回答を受け付けなくなり、元の投稿のスレッドに結果の概要（選択肢ごとの割合と票数、回答人数、「結果を見る」）が1件投稿されます。元の投稿は書き換えません
- 締切の確認は5分おきの Cron Triggers（`wrangler.jsonc` の `triggers`）で行うため、スレッドへの投稿は締切から最大5分ほど遅れます。Cron Triggers はアカウントあたり5個までで、konomi は1個使います
- 無期限の配信や、締切前に止めたい配信は、管理者が `/konomi close` を実行し、受付中の配信を選んで終了します。終了するとスレッドに結果が投稿されます。終了した配信は元に戻せません
- スレッドに投稿できなかったとき（konomi がチャンネルから外された、など）は、配信は終了のままで、投稿はやり直しません。`/konomi close` で終了した場合は実行した人にだけ知らせ、Cron の場合は Workers のログに `result_post_failed` が出ます

### 回答する

「回答する」を押すとモーダルが開き、選択肢から1つ選んで送信します。締切までは何度でも回答を変えられます。

- 回答は記名で記録され、**管理者は誰がどれを選んだかを確認できます**。モーダルにもそのことを表示しています。導入するときはメンバーに周知してください
- 記名のお題では、回答が名前付きで結果ページに表示されることをモーダルで示します
- ゲストは、初期設定では回答できません。オプトアウトした人と、管理者が除外した人も回答できません

### 同梱のお題

`seed/topics.ja.json` の40個のお題が、マイグレーション（`migrations/0002_seed_topics.sql`）で入ります。お題の ID は固定の UUID で、同じマイグレーションを何度当てても重複しません。

同梱のお題を変えるときは、`seed/topics.ja.json` を直してから、新しいマイグレーションを作って SQL を書き出します（適用済みのマイグレーションは書き換えません）。

```sh
pnpm exec drizzle-kit generate --custom --name seed_topics_v2
pnpm db:seed-sql > migrations/<作られたファイル名>.sql
```

## デプロイ

```sh
pnpm exec wrangler login
pnpm deploy:production   # 本番 D1 へのマイグレーション適用 → デプロイ
```

開発用の環境は `pnpm deploy:dev` です。

**初回だけ**、D1 がまだないためマイグレーションの適用が失敗します。先に `pnpm exec wrangler deploy --env production` でデプロイして D1 を作ってから、`pnpm deploy:production` を実行してください（この手間は、今後の初期化スクリプトでなくす予定です）。

## ライセンス

[Apache License 2.0](LICENSE)
