/** Opt-in deterministic profiles: actual SDK persistence builders and Hub event projector.
 * No model/tool executes here. Synthetic tool results and the explicit gate model
 * the assistant-message flush before tool execution in LocalRuntimeHost.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	AgentEvent,
	AgentMessage,
	AgentMessagePart,
	AgentModelToolActivity,
} from "@cline/shared";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const { agentMessageToMessageWithMetadata } = await import(
	resolve(root, "sdk/packages/core/src/runtime/config/agent-message-codec.ts")
);
const { buildInitialUserContent } = await import(
	resolve(
		root,
		"sdk/packages/core/src/runtime/orchestration/user-input-builder.ts",
	)
);

export const SDK_PROFILE_PROVENANCE = {
	persistence:
		"LocalRuntimeHost assistant-message hook persists before tools; actual runtime/config/agent-message-codec.ts serializes AgentMessage to ts/tool_use/tool_result records",
	files:
		"actual runtime/orchestration/user-input-builder.ts buildInitialUserContent with UTF-8 file loader",
	progress:
		"AgentEvent content_update(tool).update matches runtime-event-adapter.ts and bash createCommandProgressEmitter; ordinary real Hub session-event-projector wraps it as tool.updated.payload.update",
	providerTools:
		"AgentModelToolActivity metadata mirrors AgentRuntime model-tool result persistence; projection-only, never fabricated tool_result replay",
	execution:
		"synthetic deterministic tools, no actual provider, command, repository edit, or shell execution",
};
export const SDK_FILE_TEXT = {
	"/native-fixture/README.md": "# SDK UTF-8 fixture\nRésumé 🐈\nこんにちは\n",
	"/native-fixture/literal-base64.txt": "SGVsbG8=",
};
const summary =
	"SDK_CONTRACT_FINAL: Updated Fixture.ts, verified the synthetic build, and preserved UTF-8 attachments.";
const patch =
	"*** Begin Patch\n*** Update File: src/Fixture.ts\n@@\n-export const ready = false;\n+export const ready = true;\n*** End Patch";

export class SdkContractProfiles {
	readonly histories = new Map<string, any[]>();
	readonly phases = new Map<string, string>();
	private gates = new Map<string, () => void>();
	private aborted = new Set<string>();
	constructor(
		private emit: (sessionId: string, event: AgentEvent) => void,
		private record: (kind: string, detail: unknown) => void,
	) {}
	matches(prompt: string) {
		return /\bsdk-(boundary|work)-fixture\b/i.test(prompt);
	}
	release(sessionId: string) {
		const release = this.gates.get(sessionId);
		if (!release) return false;
		this.gates.delete(sessionId);
		release();
		return true;
	}
	abort(sessionId: string) {
		this.aborted.add(sessionId);
		this.release(sessionId);
	}
	private async gate(sessionId: string, phase: string) {
		this.phases.set(sessionId, phase);
		this.record("sdk-contract-gate", {
			sessionId,
			phase,
			provenance: SDK_PROFILE_PROVENANCE,
		});
		await new Promise<void>((resolveGate) =>
			this.gates.set(sessionId, resolveGate),
		);
	}
	async run(input: { sessionId: string; prompt: string }) {
		const { sessionId, prompt } = input;
		this.aborted.delete(sessionId);
		const work = /\bsdk-work-fixture\b/i.test(prompt);
		const started = Date.now();
		const history = this.histories.get(sessionId) ?? [];
		this.histories.set(sessionId, history);
		let sequence = history.length;
		const persist = (
			role: AgentMessage["role"],
			content: AgentMessagePart[],
			metadata?: AgentMessage["metadata"],
		) => {
			const message: AgentMessage = {
				id: `sdk-${sessionId}-${++sequence}`,
				role,
				content,
				createdAt: Date.now(),
				...(metadata ? { metadata } : {}),
			};
			history.push(agentMessageToMessageWithMetadata(message));
		};
		const emit = (event: AgentEvent) =>
			this.emit(sessionId, {
				agentId: "sdk-contract-agent",
				conversationId: `sdk-${sessionId}`,
				...event,
			});
		const text = (value: string) => {
			emit({ type: "content_start", contentType: "text", text: value });
			emit({ type: "content_end", contentType: "text", text: value });
		};
		const toolStart = (id: string, name: string, toolInput: unknown) =>
			emit({
				type: "content_start",
				contentType: "tool",
				toolCallId: id,
				toolName: name,
				input: toolInput,
			});
		const toolEnd = (id: string, name: string, output: unknown) =>
			emit({
				type: "content_end",
				contentType: "tool",
				toolCallId: id,
				toolName: name,
				output,
			});
		const initialContent = await buildInitialUserContent(
			`<user_input mode="act">${prompt}</user_input>`,
			undefined,
			work ? Object.keys(SDK_FILE_TEXT) : undefined,
			async (path: string) => SDK_FILE_TEXT[path as keyof typeof SDK_FILE_TEXT],
		);
		// The actual builder yields FileContent.content as authored UTF-8, including
		// the base64-looking literal; encode nothing in this persisted record.
		history.push({
			id: `sdk-${sessionId}-${++sequence}`,
			role: "user",
			content: initialContent,
			ts: started,
		});
		const first = `sdk-command-${sequence}`;
		const commandInput = {
			command: "fixture-only synthetic build (never executed)",
		};
		const narration =
			"SDK_STEP_ONE: Inspecting the build before changing the file.";
		persist("assistant", [
			{ type: "text", text: narration },
			{
				type: "tool-call",
				toolCallId: first,
				toolName: "run_command",
				input: commandInput,
			},
		]);
		text(narration);
		toolStart(first, "run_command", commandInput);
		for (const [stream, chunk] of [
			["stdout", "SDK_STDOUT: compiling fixture\n"],
			["stderr", "SDK_STDERR: synthetic warning\n"],
		])
			emit({
				type: "content_update",
				contentType: "tool",
				toolCallId: first,
				toolName: "run_command",
				update: { stream, chunk, executionId: first, detachable: false },
			});
		await this.gate(sessionId, "waiting-tool-result");
		if (this.aborted.has(sessionId)) return this.result(started, "aborted");
		const firstOutput = "SDK_BUILD_RESULT: synthetic build succeeded.";
		persist("tool", [
			{
				type: "tool-result",
				toolCallId: first,
				toolName: "run_command",
				output: firstOutput,
				isError: false,
			},
		]);
		toolEnd(first, "run_command", firstOutput);
		if (work) {
			const second = `sdk-edit-${sequence}`;
			const secondText = "SDK_STEP_TWO: Applying the verified fixture change.";
			persist("assistant", [
				{ type: "text", text: secondText },
				{
					type: "tool-call",
					toolCallId: second,
					toolName: "apply_patch",
					input: { patch },
				},
			]);
			text(secondText);
			toolStart(second, "apply_patch", { patch });
			await this.gate(sessionId, "waiting-second-tool-result");
			if (this.aborted.has(sessionId)) return this.result(started, "aborted");
			persist("tool", [
				{
					type: "tool-result",
					toolCallId: second,
					toolName: "apply_patch",
					output: "SDK_EDIT_RESULT: fixture patch applied synthetically.",
					isError: false,
				},
			]);
			toolEnd(
				second,
				"apply_patch",
				"SDK_EDIT_RESULT: fixture patch applied synthetically.",
			);
			const activity: AgentModelToolActivity = {
				toolCallId: `sdk-provider-${sequence}`,
				toolName: "web_search",
				execution: "provider",
				input: { query: "fixture SDK reference" },
				output: "SDK_PROVIDER_SEARCH_RESULT",
				isError: false,
			};
			toolStart(activity.toolCallId, activity.toolName, activity.input);
			toolEnd(activity.toolCallId, activity.toolName, activity.output);
			// Provider-run activities are metadata, not replayable tool_use/tool_result.
			persist("assistant", [], { modelToolActivities: [activity] });
		}
		const submit = `sdk-submit-${sequence}`;
		const finalSummary = work
			? summary
			: "SDK_BOUNDARY_FINAL: The reconnected command completed and its result is visible.";
		persist("assistant", [
			{
				type: "tool-call",
				toolCallId: submit,
				toolName: "submit_and_exit",
				input: { summary: finalSummary },
			},
		]);
		toolStart(submit, "submit_and_exit", { summary: finalSummary });
		persist("tool", [
			{
				type: "tool-result",
				toolCallId: submit,
				toolName: "submit_and_exit",
				output: "Task submitted.",
				isError: false,
			},
		]);
		toolEnd(submit, "submit_and_exit", "Task submitted.");
		this.phases.set(sessionId, "completed");
		this.record("sdk-contract-completed", {
			sessionId,
			work,
			messageCount: history.length,
		});
		return this.result(started, "completed");
	}
	private result(started: number, finishReason: "completed" | "aborted") {
		return {
			text: finishReason === "completed" ? summary : "Fixture stopped.",
			finishReason,
			iterations: 3,
			messages: [],
			toolCalls: [],
			usage: {
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0,
			},
			model: { id: "anthropic/claude-sonnet-4-6", provider: "cline" },
			startedAt: new Date(started),
			endedAt: new Date(),
			durationMs: Date.now() - started,
		};
	}
}
