CREATE TABLE `__new_verifications` (
	`name_normalized` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`requested_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`started_at` text,
	`finished_at` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
INSERT INTO `__new_verifications`("name_normalized", "name", "requested_at", "started_at", "finished_at", "attempts", "last_error") SELECT "name_normalized", "name_normalized", "requested_at", "started_at", "finished_at", "attempts", "last_error" FROM `verifications`;
--> statement-breakpoint
DROP TABLE `verifications`;
--> statement-breakpoint
ALTER TABLE `__new_verifications` RENAME TO `verifications`;
