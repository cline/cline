/**
 * Worker process entry (Gateway RFC, Phase 4).
 *
 * Runs inside a supervised (sandboxed) child process and speaks the
 * supervision contract over stdin/stdout NDJSON. The default workload
 * executes engine runs with:
 *
 * - model credentials taken from the worker environment, which inside a
 *   sandboxed worker holds *masked sentinels* — the real secrets are
 *   substituted by the sandbox proxy on egress to allowed hosts only;
 * - tool approvals routed back to the Gateway as `approval.request`
 *   capability calls (the worker holds no client connections).
 *
 * The entry never writes anything except protocol frames to stdout;
 * diagnostics go to stderr.
 */

import type { EnginePort } from "@cline/bot";
import { createEngineExecutionPort } from "@cline/bot";
import { resolveProviderModel } from "../engine-binding";
import type { WorkerEndpoint, WorkerWorkloadFactory } from "./host";
import { WorkerHost } from "./host";
import { SupervisorToWorkerMessageSchema } from "./protocol";

/** NDJSON endpoint over a pair of streams (stdin/stdout by default). */
export function createStreamWorkerEndpoint(
	input: NodeJS.ReadableStream,
	output: NodeJS.WritableStream,
): WorkerEndpoint {
	const listeners = new Set<Parameters<WorkerEndpoint["onMessage"]>[0]>();
	let buffer = "";
	input.setEncoding?.("utf8");
	input.on("data", (chunk: string | Buffer) => {
		buffer += String(chunk);
		for (;;) {
			const newline = buffer.indexOf("\n");
			if (newline === -1) {
				return;
			}
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (!line) {
				continue;
			}
			let value: unknown;
			try {
				value = JSON.parse(line);
			} catch {
				continue;
			}
			const parsed = SupervisorToWorkerMessageSchema.safeParse(value);
			if (!parsed.success) {
				continue;
			}
			for (const listener of listeners) {
				listener(parsed.data);
			}
		}
	});
	return {
		send: (message) => {
			output.write(`${JSON.stringify(message)}\n`);
		},
		onMessage: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

/**
 * Default workload: real engine execution with capability-routed
 * approvals and environment-resolved (sentinel) model credentials.
 * Deliberately no `paths`: workers never read the Gateway's 0600 secret
 * files — inside a sandboxed worker the credential env vars hold masked
 * sentinels that the sandbox proxy substitutes on egress.
 */
export const defaultWorkerWorkload: WorkerWorkloadFactory = (context) =>
	createEngineExecutionPort({
		model: (invocation) => resolveProviderModel(invocation),
		requestApproval: async (request) => {
			const answer = (await context.capabilityCall("approval.request", {
				toolCallId: request.toolCallId,
				toolName: request.toolName,
				input: request.input as Record<string, unknown> | undefined,
			})) as { approved?: unknown; reason?: unknown } | null;
			return {
				approved: answer?.approved === true,
				reason: typeof answer?.reason === "string" ? answer.reason : undefined,
			};
		},
	});

export interface WorkerEntryOptions {
	workload?: EnginePort | WorkerWorkloadFactory;
	input?: NodeJS.ReadableStream;
	output?: NodeJS.WritableStream;
}

/** Start the worker host over stdio. Returns the host (for tests). */
export function runWorkerEntry(options: WorkerEntryOptions = {}): WorkerHost {
	const endpoint = createStreamWorkerEndpoint(
		options.input ?? process.stdin,
		options.output ?? process.stdout,
	);
	return new WorkerHost({
		endpoint,
		workload: options.workload ?? defaultWorkerWorkload,
		pid: process.pid,
	});
}
