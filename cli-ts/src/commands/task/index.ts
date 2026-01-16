/**
 * Task command group - manage Cline tasks
 */

import { Command } from "commander"
import type { OutputFormatter } from "../../core/output/types.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"
import { createTaskListCommand } from "./list.js"
import { createTaskNewCommand } from "./new.js"
import { createTaskOpenCommand } from "./open.js"

/**
 * Create the task command group
 */
export function createTaskCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	const taskCommand = new Command("task").alias("t").description("Manage Cline tasks")

	// Add subcommands
	taskCommand.addCommand(createTaskNewCommand(config, logger, formatter))
	taskCommand.addCommand(createTaskListCommand(config, logger, formatter))
	taskCommand.addCommand(createTaskOpenCommand(config, logger, formatter))

	return taskCommand
}
