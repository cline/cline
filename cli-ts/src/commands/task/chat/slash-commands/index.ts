/**
 * Command dispatcher for chat REPL
 *
 * Maps command names to their handlers and dispatches incoming commands.
 */

import { handleConfig } from "./config.js"
import { handleHelp } from "./help.js"
import { handleAct, handleMode, handlePlan } from "./mode.js"
import { handleModel } from "./model.js"
import { handleQuit } from "./quit.js"
import { handleStatus } from "./status.js"
import { handleApprove, handleCancel, handleDeny } from "./task.js"
import type { CommandContext, CommandHandler } from "./types.js"

/**
 * Map of command names to their handlers
 */
const handlers: Record<string, CommandHandler> = {
	// Help
	help: handleHelp,
	h: handleHelp,
	"?": handleHelp,

	// Mode
	plan: handlePlan,
	act: handleAct,
	mode: handleMode,
	m: handleMode,

	// Model
	model: handleModel,

	// Status
	status: handleStatus,
	s: handleStatus,

	// Task control
	cancel: handleCancel,
	approve: handleApprove,
	a: handleApprove,
	y: handleApprove,
	deny: handleDeny,
	d: handleDeny,
	n: handleDeny,

	// Config
	config: handleConfig,
	cfg: handleConfig,

	// Quit
	quit: handleQuit,
	q: handleQuit,
	exit: handleQuit,
}

/**
 * Process a chat command (input starting with /)
 *
 * @param input - Full command input including the leading /
 * @param ctx - Command context
 * @returns true if the command was handled
 */
export async function processSlashCommand(input: string, ctx: CommandContext): Promise<boolean> {
	const parts = input.slice(1).split(/\s+/)
	const cmd = parts[0].toLowerCase()
	const args = parts.slice(1)

	const handler = handlers[cmd]
	if (!handler) {
		ctx.fmt.warn(`Unknown command: /${cmd}. Type /help for available commands.`)
		return true
	}

	return handler(args, ctx)
}

// Re-export types for convenience
export type { CommandContext, CommandHandler } from "./types.js"
