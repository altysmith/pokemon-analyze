CREATE TABLE `jp_archetype_aliases` (
	`source_value` text PRIMARY KEY NOT NULL,
	`archetype_id` text NOT NULL,
	FOREIGN KEY (`archetype_id`) REFERENCES `jp_archetypes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `jp_archetypes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_value` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jp_decklists` (
	`event_id` text NOT NULL,
	`source_row` integer NOT NULL,
	`source_url` text NOT NULL,
	`content_status` text DEFAULT 'link_only' NOT NULL,
	`last_checked_at` text,
	PRIMARY KEY(`event_id`, `source_row`)
);
--> statement-breakpoint
CREATE INDEX `jp_decklists_url_idx` ON `jp_decklists` (`source_url`);--> statement-breakpoint
CREATE TABLE `jp_event_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`revision` integer NOT NULL,
	`source_hash` text NOT NULL,
	`observed_at` text NOT NULL,
	`ingestion_run_id` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `jp_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ingestion_run_id`) REFERENCES `jp_ingestion_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jp_event_revisions_event_revision_idx` ON `jp_event_revisions` (`event_id`,`revision`);--> statement-breakpoint
CREATE TABLE `jp_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_url` text NOT NULL,
	`event_date` text NOT NULL,
	`prefecture_raw` text NOT NULL,
	`prefecture_key` text NOT NULL,
	`shop_raw` text NOT NULL,
	`shop_key` text NOT NULL,
	`known_player_count` integer,
	`placement_count` integer DEFAULT 0 NOT NULL,
	`classified_placement_count` integer DEFAULT 0 NOT NULL,
	`classified_top8_count` integer DEFAULT 0 NOT NULL,
	`decklist_count` integer DEFAULT 0 NOT NULL,
	`source_hash` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`ingestion_status` text DEFAULT 'complete' NOT NULL,
	`first_discovered_at` text NOT NULL,
	`last_checked_at` text NOT NULL,
	`last_changed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jp_events_source_url_idx` ON `jp_events` (`source_url`);--> statement-breakpoint
CREATE INDEX `jp_events_date_idx` ON `jp_events` (`event_date`);--> statement-breakpoint
CREATE INDEX `jp_events_shop_idx` ON `jp_events` (`shop_key`);--> statement-breakpoint
CREATE TABLE `jp_expansions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`japanese_release_date` text NOT NULL,
	`international_release_date` text,
	`format_id` text,
	`legality_notes` text,
	`source_url` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jp_expansions_release_idx` ON `jp_expansions` (`japanese_release_date`);--> statement-breakpoint
CREATE TABLE `jp_ingestion_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_kind` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`checked_events` integer DEFAULT 0 NOT NULL,
	`changed_events` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `jp_placements` (
	`event_id` text NOT NULL,
	`source_row` integer NOT NULL,
	`placing` integer NOT NULL,
	`player_name_raw` text NOT NULL,
	`player_url` text,
	`archetype_raw` text,
	`archetype_id` text,
	`decklist_url` text,
	PRIMARY KEY(`event_id`, `source_row`),
	FOREIGN KEY (`event_id`) REFERENCES `jp_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`archetype_id`) REFERENCES `jp_archetypes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jp_placements_archetype_idx` ON `jp_placements` (`archetype_id`);--> statement-breakpoint
CREATE INDEX `jp_placements_placing_idx` ON `jp_placements` (`placing`);