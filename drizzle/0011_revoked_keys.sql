CREATE TABLE `revoked_keys` (
	`key_id` text PRIMARY KEY NOT NULL,
	`revoked_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
