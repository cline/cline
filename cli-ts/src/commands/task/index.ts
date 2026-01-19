/**
 * Task command group - manage Cline tasks
 */

import { Command } from "commander"
import type { OutputFormatter } from "../../core/output/types.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"
import { createTaskChatCommand } from "./chat.js"
import { createTaskListCommand } from "./list.js"
import { createTaskSendCommand } from "./send.js"
import { createTaskViewCommand } from "./view.js"

/**
 * Create the task command group
 */
export function createTaskCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	const taskCommand = new Command("task").alias("t").description("Manage Cline tasks")

	// Add subcommands
	taskCommand.addCommand(createTaskListCommand(config, logger, formatter))
	taskCommand.addCommand(createTaskChatCommand(config, logger, formatter))
	taskCommand.addCommand(createTaskSendCommand(config, logger, formatter))
	taskCommand.addCommand(createTaskViewCommand(config, logger, formatter))

	return taskCommand
}
