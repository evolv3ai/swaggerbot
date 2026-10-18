CREATE TABLE `chat_turns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`spec_id` text NOT NULL,
	`api_id` text NOT NULL,
	`user_id` text NOT NULL,
	`model` text NOT NULL,
	`effort` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer NOT NULL,
	`operations_sent` integer DEFAULT 0 NOT NULL,
	`schemas_sent` integer DEFAULT 0 NOT NULL,
	`bytes_sent` integer DEFAULT 0 NOT NULL,
	`citations` integer DEFAULT 0 NOT NULL,
	`stop_reason` text,
	`refusal_category` text,
	`error` text,
	`question` text,
	`answer` text
);
--> statement-breakpoint
CREATE INDEX `chat_turns_at_idx` ON `chat_turns` (`at`);--> statement-breakpoint
CREATE TABLE `chat_usage` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`user_id`, `day`)
);
