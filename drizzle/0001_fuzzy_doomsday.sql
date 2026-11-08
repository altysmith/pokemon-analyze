CREATE TABLE `jp_decklist_cards` (
	`source_url` text NOT NULL,
	`position` integer NOT NULL,
	`section` text NOT NULL,
	`quantity` integer NOT NULL,
	`name` text NOT NULL,
	`set_code` text NOT NULL,
	`card_number` text NOT NULL,
	PRIMARY KEY(`source_url`, `position`),
	FOREIGN KEY (`source_url`) REFERENCES `jp_decklist_content`(`source_url`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jp_decklist_cards_name_idx` ON `jp_decklist_cards` (`name`);--> statement-breakpoint
CREATE TABLE `jp_decklist_content` (
	`source_url` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`last_checked_at` text NOT NULL
);
