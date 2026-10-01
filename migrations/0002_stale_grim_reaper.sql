CREATE TABLE `automation_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`key` text NOT NULL,
	`browser` text NOT NULL,
	`caseId` text NOT NULL,
	`preserveManualSteps` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`caseId`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_source_project_key` ON `automation_sources` (`projectId`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `automation_source_case` ON `automation_sources` (`caseId`);--> statement-breakpoint
ALTER TABLE `executions` ADD `automationKey` text;--> statement-breakpoint
ALTER TABLE `tokens` ADD `scope` text DEFAULT 'upload' NOT NULL;
--> statement-breakpoint
UPDATE `tokens` SET `scope`='runner' WHERE `planId` IS NOT NULL;
