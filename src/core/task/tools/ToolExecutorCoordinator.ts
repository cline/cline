import type Anthropic from "@anthropic-ai/sdk"
import type { ToolUse, ToolUseName } from "@core/assistant-message"
import type { TaskConfig } from "../TaskConfig"

/**
 * Keep ToolResponse aligned with existing usage in Task.
 * This coordinator does NOT push results or call saveCheckpoint —
 * it only delegates. The Task (or legacy ToolExecutor) remains responsible
 * for UI side-effects until full migration.
 */
export type ToolResponse = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>

/**
 * Minimal handler contract for one tool. Handlers will be added incrementally.
 * During Step 1, we only define the contract and registration plumbing.
 */
export interface IToolHandler {
	readonly name: ToolUseName
	execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse>
}

/**
 * ToolExecutorCoordinator (scaffold)
 * - Holds a registry of handlers by ToolUseName
 * - Not wired into the legacy switch yet (no behavior change)
 * - Next phases will:
 *    - Register read-only handlers (list_files, read_file, etc.)
 *    - Attempt handler-first dispatch with legacy switch as fallback
 */
export class ToolExecutorCoordinator {
	private readonly handlers = new Map<ToolUseName, IToolHandler>()

	constructor() {}

	register(handler: IToolHandler): void {
		this.handlers.set(handler.name, handler)
	}

	has(name: ToolUseName): boolean {
		return this.handlers.has(name)
	}

	/**
	 * Executes a registered handler. The caller is responsible for:
	 * - plan-mode restrictions and approval UI
	 * - pushing results to messages
	 * - saveCheckpoint and telemetry
	 * - browser-session lifecycle rules
	 */
	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const handler = this.handlers.get(block.name)
		if (!handler) {
			throw new Error(`No handler registered for tool '${block.name}'`)
		}
		return handler.execute(config, block)
	}

	/**
	 * For inspection / tests.
	 */
	listHandlers(): ToolUseName[] {
		return Array.from(this.handlers.keys())
	}
}
