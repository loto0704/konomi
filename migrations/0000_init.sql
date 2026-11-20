CREATE TABLE `admins` (
	`user_id` text PRIMARY KEY NOT NULL,
	`added_by` text NOT NULL,
	`added_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `answers` (
	`round_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`choice_id` integer NOT NULL,
	`answered_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`choice_id`) REFERENCES `topic_choices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `answers_round_user_unique` ON `answers` (`round_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `login_states` (
	`state` text PRIMARY KEY NOT NULL,
	`nonce` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `round_targets` (
	`round_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`dm_channel_id` text,
	`message_ts` text,
	PRIMARY KEY(`round_id`, `user_id`),
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` text NOT NULL,
	`schedule_id` integer,
	`type` text NOT NULL,
	`result_visibility` text NOT NULL,
	`channel_id` text NOT NULL,
	`message_ts` text,
	`deadline_at` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `rounds_status_idx` ON `rounds` (`status`);--> statement-breakpoint
CREATE INDEX `rounds_status_deadline_idx` ON `rounds` (`status`,`deadline_at`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text DEFAULT 'channel' NOT NULL,
	`days_of_week` integer DEFAULT 62 NOT NULL,
	`time` text DEFAULT '10:00' NOT NULL,
	`skip_holidays` integer DEFAULT true NOT NULL,
	`deadline_rule` text NOT NULL,
	`dm_count` integer DEFAULT 3 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`next_run_at` integer
);
--> statement-breakpoint
CREATE INDEX `schedules_active_next_run_idx` ON `schedules` (`is_active`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`channel_id` text,
	`timezone` text DEFAULT 'Asia/Tokyo' NOT NULL,
	`exclude_recent_days` integer DEFAULT 7 NOT NULL,
	`include_guests` integer DEFAULT false NOT NULL,
	`max_open_unlimited` integer DEFAULT 10 NOT NULL,
	`retention_days` integer DEFAULT 365 NOT NULL,
	CONSTRAINT "settings_singleton" CHECK("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `topic_choices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` text NOT NULL,
	`label` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `topic_choices_topic_id_idx` ON `topic_choices` (`topic_id`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`question` text NOT NULL,
	`recommended_type` text DEFAULT 'any' NOT NULL,
	`answer_format` text DEFAULT 'choice' NOT NULL,
	`result_visibility` text DEFAULT 'anonymous' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE INDEX `topics_is_active_idx` ON `topics` (`is_active`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`opted_out` integer DEFAULT false NOT NULL,
	`excluded_by_admin` integer DEFAULT false NOT NULL
);
