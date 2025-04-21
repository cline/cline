CREATE TABLE `toolErrors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`runId` integer,
	`taskId` integer,
	`toolName` text NOT NULL,
	`error` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`runId`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
