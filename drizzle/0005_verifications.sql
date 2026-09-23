CREATE TABLE `verifications` (
	`name_normalized` text PRIMARY KEY NOT NULL,
	`requested_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`started_at` text,
	`finished_at` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
