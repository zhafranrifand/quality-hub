ALTER TABLE `runs` ADD `expectedAutomationKeys` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `browser` text;--> statement-breakpoint
ALTER TABLE `automation_sources` DROP COLUMN `browser`;