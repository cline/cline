/**
 * HookOutputChannel - Explicit pub-sub routing for hook outputs
 *
 * This class provides a dedicated communication channel for each hook execution,
 * ensuring that outputs are routed to the correct hook message without relying
 * on post-hoc timestamp matching.
 *
 * Architecture:
 * - Each hook gets its own channel instance
 * - Channel handles output routing via timestamp prefix
 * - Timestamps preserved for message identity
 * - Channels handle routing concern separately
 */

export class HookOutputChannel {
	private hookTs: number
	private say: (type: any, text?: string, images?: string[], files?: string[], partial?: boolean) => Promise<number | undefined>

	/**
	 * Creates a new output channel for a specific hook execution
	 * @param hookTs The timestamp of the hook message this channel routes to
	 * @param say The say function for writing messages
	 */
	constructor(
		hookTs: number,
		say: (type: any, text?: string, images?: string[], files?: string[], partial?: boolean) => Promise<number | undefined>,
	) {
		this.hookTs = hookTs
		this.say = say
	}

	/**
	 * Publishes a line of output to this hook's message stream
	 * The line is automatically prefixed with the hook's timestamp for routing
	 * @param line The output line to publish
	 */
	async publish(line: string): Promise<void> {
		// Prefix with timestamp for routing in combineHookSequences
		const prefixedOutput = `${this.hookTs}:${line}`
		console.log(`[Channel ${this.hookTs}] Publishing: ${line.substring(0, 30)}`)
		await this.say("hook_output", prefixedOutput)
	}

	/**
	 * Gets the timestamp this channel routes to
	 * Useful for debugging and verification
	 */
	getHookTimestamp(): number {
		return this.hookTs
	}
}
