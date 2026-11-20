/**
 * D1（SQLite）のスキーマ。要件定義書「5. データ設計」に対応する。
 *
 * - シングルテナントのため team_id は持たない
 * - 日時はすべて UNIX 時間の秒（INTEGER）
 * - 真偽値は INTEGER の 0/1
 * - お題の ID は UUID（同梱のお題を環境をまたいで識別するため）。回答は独自の ID を持たず (round_id, user_id) で1件
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** 配信タイプ */
export const ROUND_TYPES = ["channel", "dm"] as const;
export type RoundType = (typeof ROUND_TYPES)[number];

/** お題のおすすめ配信タイプ */
export const RECOMMENDED_TYPES = ["channel", "dm", "any"] as const;
export type RecommendedType = (typeof RECOMMENDED_TYPES)[number];

/** 回答の形式。MVP は choice だけを使う */
export const ANSWER_FORMATS = ["choice", "text", "choice_other"] as const;
export type AnswerFormat = (typeof ANSWER_FORMATS)[number];

/** 結果の表示方法 */
export const RESULT_VISIBILITIES = ["anonymous", "named"] as const;
export type ResultVisibility = (typeof RESULT_VISIBILITIES)[number];

/** 配信の状態 */
export const ROUND_STATUSES = ["open", "closed"] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

/** 設定。常に1行（id = 1）だけ持つ */
export const settings = sqliteTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    channelId: text("channel_id"),
    timezone: text("timezone").notNull().default("Asia/Tokyo"),
    excludeRecentDays: integer("exclude_recent_days").notNull().default(7),
    includeGuests: integer("include_guests", { mode: "boolean" }).notNull().default(false),
    maxOpenUnlimited: integer("max_open_unlimited").notNull().default(10),
    retentionDays: integer("retention_days").notNull().default(365),
  },
  (t) => [check("settings_singleton", sql`${t.id} = 1`)],
);

/** 管理画面で追加した管理者。ADMIN_USER_IDS の人はここに入れない */
export const admins = sqliteTable("admins", {
  userId: text("user_id").primaryKey(),
  addedBy: text("added_by").notNull(),
  addedAt: integer("added_at").notNull(),
});

/** 本人のオプトアウトと、管理者による除外 */
export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id").primaryKey(),
  optedOut: integer("opted_out", { mode: "boolean" }).notNull().default(false),
  excludedByAdmin: integer("excluded_by_admin", { mode: "boolean" }).notNull().default(false),
});

/** お題 */
export const topics = sqliteTable(
  "topics",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    question: text("question").notNull(),
    recommendedType: text("recommended_type", { enum: RECOMMENDED_TYPES }).notNull().default("any"),
    answerFormat: text("answer_format", { enum: ANSWER_FORMATS }).notNull().default("choice"),
    resultVisibility: text("result_visibility", { enum: RESULT_VISIBILITIES })
      .notNull()
      .default("anonymous"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [index("topics_is_active_idx").on(t.isActive)],
);

/** お題の選択肢（2〜4個） */
export const topicChoices = sqliteTable(
  "topic_choices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [index("topic_choices_topic_id_idx").on(t.topicId)],
);

/** 配信スケジュール */
export const schedules = sqliteTable(
  "schedules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type", { enum: ROUND_TYPES }).notNull().default("channel"),
    /** 曜日のビット（日=1, 月=2, … 土=64）。初期値は平日（62） */
    daysOfWeek: integer("days_of_week").notNull().default(62),
    /** 'HH:MM'（settings.timezone の現地時刻） */
    time: text("time").notNull().default("10:00"),
    skipHolidays: integer("skip_holidays", { mode: "boolean" }).notNull().default(true),
    /** JSON。{"kind":"at","time":"18:00"} | {"kind":"after","hours":8} | {"kind":"none"} */
    deadlineRule: text("deadline_rule").notNull(),
    dmCount: integer("dm_count").notNull().default(3),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    nextRunAt: integer("next_run_at"),
  },
  (t) => [index("schedules_active_next_run_idx").on(t.isActive, t.nextRunAt)],
);

/** 配信（ラウンド） */
export const rounds = sqliteTable(
  "rounds",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id),
    scheduleId: integer("schedule_id").references(() => schedules.id, { onDelete: "set null" }),
    type: text("type", { enum: ROUND_TYPES }).notNull(),
    /** 配信時のお題の設定を記録する。あとでお題を変えても過去の配信の表示は変わらない */
    resultVisibility: text("result_visibility", { enum: RESULT_VISIBILITIES }).notNull(),
    channelId: text("channel_id").notNull(),
    messageTs: text("message_ts"),
    /** 無期限は NULL */
    deadlineAt: integer("deadline_at"),
    status: text("status", { enum: ROUND_STATUSES }).notNull().default("open"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("rounds_status_idx").on(t.status),
    index("rounds_status_deadline_idx").on(t.status, t.deadlineAt),
  ],
);

/** DM 型の配信で選ばれた人 */
export const roundTargets = sqliteTable(
  "round_targets",
  {
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    dmChannelId: text("dm_channel_id"),
    messageTs: text("message_ts"),
  },
  (t) => [primaryKey({ columns: [t.roundId, t.userId] })],
);

/** 回答。1人1回答で、再回答は ON CONFLICT で上書きする */
export const answers = sqliteTable(
  "answers",
  {
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    choiceId: integer("choice_id")
      .notNull()
      .references(() => topicChoices.id),
    answeredAt: integer("answered_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("answers_round_user_unique").on(t.roundId, t.userId)],
);

/** ログインセッション。id は Cookie の値の SHA-256 */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("sessions_expires_at_idx").on(t.expiresAt)],
);

/** Sign in with Slack の state と nonce */
export const loginStates = sqliteTable("login_states", {
  state: text("state").primaryKey(),
  nonce: text("nonce").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
