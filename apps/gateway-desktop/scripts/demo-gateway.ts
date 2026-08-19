/**
 * Local demo/validation Gateway.
 *
 * Starts a REAL Phase 3 `GatewayServer` (SQLite authority, lock,
 * discovery record, loopback protocol) with a scripted engine so
 * Gateway Desktop can be exercised end to end without LLM credentials:
 *
 * - any prompt streams a word-by-word response and completes;
 * - a prompt containing "fail" fails its FIRST attempt (retry works);
 * - a prompt containing "approve" first asks for tool approval.
 *
 * Usage:
 *   CLINE_GATEWAY_DATA_ROOT=/tmp/gwd-demo bun run scripts/demo-gateway.ts
 * Then point the broker at the same data root.
 */

import type {
	EngineInvocation,
	EngineOutcome,
	EnginePort,
	EngineRunHandle,
} from "@cline/bot";
import { GatewayServer } from "@cline/gateway";
import type { GatewayEventScope } from "@cline/shared/gateway";

const attemptsByRun = new Map<string, number>();
let approvals:
	| ((
			scope: GatewayEventScope,
			params: Record<string, unknown>,
	  ) => Promise<unknown>)
	| undefined;

class DemoHandle implements EngineRunHandle {
	readonly result: Promise<EngineOutcome>;
	private interrupted = false;
	private aborted = false;
	private steered: string[] = [];
	private listeners = new Set<(event: unknown) => void>();

	constructor(invocation: EngineInvocation) {
		this.result = this.execute(invocation);
	}

	private emit(event: unknown): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	private async execute(invocation: EngineInvocation): Promise<EngineOutcome> {
		const attempt = (attemptsByRun.get(invocation.runId) ?? 0) + 1;
		attemptsByRun.set(invocation.runId, attempt);
		const prompt = invocation.input;

		await sleep(300);
		this.emit({
			type: "message-appended",
			message: {
				id: `msg_${invocation.runId}_user_${attempt}`,
				role: "user",
				content: [{ type: "text", text: prompt }],
				createdAt: Date.now(),
			},
		});

		if (/approve/i.test(prompt) && approvals) {
			this.emit({
				type: "tool-started",
				toolCallId: `call_${invocation.runId}`,
				toolName: "write_file",
				input: { path: "demo.txt" },
			});
			const answer = (await approvals(
				{
					botId: invocation.botId,
					sessionId: invocation.sessionId,
					runId: invocation.runId,
				},
				{
					toolCallId: `call_${invocation.runId}`,
					toolName: "write_file",
					input: { path: "demo.txt" },
				},
			)) as { approved?: boolean };
			this.emit({
				type: "tool-finished",
				toolCallId: `call_${invocation.runId}`,
				toolName: "write_file",
				output: { approved: answer.approved === true },
				isError: answer.approved !== true,
			});
			if (answer.approved !== true) {
				const text = "The tool call was denied, so I stopped there.";
				this.emit(assistantMessage(invocation, attempt, text));
				return { status: "completed", outputText: text };
			}
		}

		if (/fail/i.test(prompt) && attempt === 1) {
			await sleep(600);
			return {
				status: "failed",
				outputText: "",
				error: {
					name: "DemoEngineError",
					message: "Simulated first-attempt failure (retry this run)",
				},
			};
		}

		const words = (
			`Attempt ${attempt}: streaming a scripted response to "${prompt.slice(0, 80)}". ` +
			"The Gateway owns this run; close the window and it keeps going. " +
			"Every event you see arrived through the durable event log."
		).split(" ");
		let streamed = "";
		for (const word of words) {
			if (this.aborted) {
				return { status: "aborted", outputText: streamed };
			}
			if (this.interrupted) {
				return { status: "interrupted", outputText: streamed };
			}
			streamed += `${word} `;
			this.emit({ type: "text-delta", text: `${word} ` });
			if (this.steered.length > 0) {
				const note = ` (steered: ${this.steered.splice(0).join("; ")}) `;
				streamed += note;
				this.emit({ type: "text-delta", text: note });
			}
			await sleep(140);
		}
		this.emit(assistantMessage(invocation, attempt, streamed.trim()));
		this.emit({
			type: "usage-updated",
			usage: {
				inputTokens: 120,
				outputTokens: words.length,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0.0009,
			},
		});
		return { status: "completed", outputText: streamed.trim() };
	}

	steer(text: string): boolean {
		this.steered.push(text);
		return true;
	}

	interrupt(): void {
		this.interrupted = true;
	}

	abort(): void {
		this.aborted = true;
	}

	subscribe(listener: (event: unknown) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}

function assistantMessage(
	invocation: EngineInvocation,
	attempt: number,
	text: string,
) {
	return {
		type: "message-appended",
		message: {
			id: `msg_${invocation.runId}_assistant_${attempt}`,
			role: "assistant",
			content: [{ type: "text", text }],
			createdAt: Date.now(),
		},
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const demoEngine: EnginePort = {
	start: (invocation) => new DemoHandle(invocation),
};

const server = await GatewayServer.start({
	engine: demoEngine,
	// Phase 4-6 demo surface: report the honest development isolation and
	// keep connector adapter workers off (no Telegram/Slack credentials).
	executionHealth: () => ({
		isolation: "unsandboxed-development",
		development: true,
	}),
	autoStartConnectors: false,
	schedulerTickMs: 500,
});
approvals = (scope, params) =>
	server.runtime.approvals.request("client.requestToolApproval", scope, params);

// Seed read-only Phase 6 diagnostics: one bot-scoped connector (metadata
// only; its worker never starts without credentials) and one recurring
// schedule that admits automation runs into the bot's canonical session.
const demoBotId = server.runtime.defaultBotId;
if (demoBotId) {
	if (server.runtime.listConnectors().length === 0) {
		server.runtime.registerConnector("demo", {
			botId: demoBotId,
			kind: "telegram",
			name: "demo-telegram",
			config: { botUsername: "demo_bot" },
		});
	}
	if (server.runtime.listSchedules().length === 0) {
		server.runtime.createSchedule("demo", {
			botId: demoBotId,
			name: "demo-automation",
			prompt: "Scheduled check-in: report one line of status.",
			intervalMs: 120_000,
		});
	}
}
const address = server.address();
console.log(
	`demo gateway serving on ${address.host}:${address.port} (data: ${server.paths.dataDir})`,
);
console.log("stop with ctrl-c");

const stop = () => {
	void server.stop("graceful").finally(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await server.whenStopped;
