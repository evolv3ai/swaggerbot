ALTER TABLE `specs` ADD `is_preview` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `specs` ADD `superseded_at` text;