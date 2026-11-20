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
| `SLACK_TEAM_ID` | 変数 | 受け付けるワークスペース |
| `ADMIN_USER_IDS` | 変数 | 最初の管理者（カンマ区切り） |
| `APP_BASE_URL` | 変数 | 結果ページ・管理画面の URL |

- 変数は `wrangler.jsonc` の各環境の `vars` に書きます
- Secrets は `pnpm exec wrangler secret put <名前> --env production` で設定します。DB やリポジトリには置きません
- D1 は名前（`database_name`）だけを書き、`database_id` は書きません。初回のデプロイで同じ名前の D1 が自動で作られます

## デプロイ

```sh
pnpm exec wrangler login
pnpm deploy:production   # 本番 D1 へのマイグレーション適用 → デプロイ
```

開発用の環境は `pnpm deploy:dev` です。

**初回だけ**、D1 がまだないためマイグレーションの適用が失敗します。先に `pnpm exec wrangler deploy --env production` でデプロイして D1 を作ってから、`pnpm deploy:production` を実行してください（この手間は、今後の初期化スクリプトでなくす予定です）。

## ライセンス

[Apache License 2.0](LICENSE)
