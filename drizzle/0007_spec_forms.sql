CREATE TABLE `spec_forms` (
	`spec_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`normalized_bytes` blob,
	`normalized_spec_version` text,
	`validity_issues` text,
	`validity_finding_count` integer,
	`normalized_finding_count` integer,
	`outline` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`started_at` text,
	`built_at` text,
	FOREIGN KEY (`spec_id`) REFERENCES `specs`(`id`) ON UPDATE no action ON DELETE no action
);
