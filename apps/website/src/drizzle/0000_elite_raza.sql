CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`taskMetricsId` integer,
	`model` text NOT NULL,
	`description` text,
	`pid` integer,
	`socketPath` text NOT NULL,
	`passed` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`taskMetricsId`) REFERENCES `taskMetrics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `taskMetrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tokensIn` integer NOT NULL,
	`tokensOut` integer NOT NULL,
	`tokensContext` integer NOT NULL,
	`cacheWrites` integer NOT NULL,
	`cacheReads` integer NOT NULL,
	`cost` real NOT NULL,
	`duration` integer NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`runId` integer NOT NULL,
	`taskMetricsId` integer,
	`language` text NOT NULL,
	`exercise` text NOT NULL,
	`passed` integer,
	`startedAt` integer,
	`finishedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`runId`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`taskMetricsId`) REFERENCES `taskMetrics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_language_exercise_idx` ON `tasks` (`runId`,`language`,`exercise`);