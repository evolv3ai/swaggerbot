ALTER TABLE `specs` ADD `path_count` integer;--> statement-breakpoint
ALTER TABLE `specs` ADD `deprecated` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `specs` ADD `origin_rank` integer;