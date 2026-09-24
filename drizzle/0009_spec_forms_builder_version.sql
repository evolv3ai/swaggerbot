ALTER TABLE `spec_forms` ADD `builder_version` integer;--> statement-breakpoint
-- Attempts left from before a Spec was ready would shorten its rebuild's retries.
UPDATE `spec_forms` SET `attempts` = 0 WHERE `status` = 'ready';
