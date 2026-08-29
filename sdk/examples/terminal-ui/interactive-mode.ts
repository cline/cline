/**
 * Host-driven interactive terminal UI example.
 *
 * `runInteractiveTerminalUi` renders the full Cline terminal experience
 * (transcript, prompt input with history, slash commands, settings panel,
 * queued prompts) while the host supplies runtime behavior as plain data
 * and callbacks. Nothing in `@cline/ui/tui` creates sessions or persists
 * state — this host scripts an in-process "agent" so the example runs
 * without provider credentials.
 *
 * The production host adapter lives in
 * `apps/cli/src/runtime/run-interactive.ts` (runtime wiring) and
 * `apps/cli/src/tui/host-surfaces.tsx` (runtime-owned dialogs such as the
 * provider picker and session history).
 *
 * Run: bun sdk/examples/terminal-ui/interactive-mode.ts
 */

import type { AgentEvent } from "@cline/shared";
import type { InteractiveTerminalUiProps } from "@cline/ui/tui";
import { runInteractiveTerminalUi } from "@cline/ui/tui";

type EventHandlers = Parameters<
	InteractiveTerminalUiProps["subscribeToEvents"]
>[0];

let handlers: EventHandlers | null = null;
const emitAgentEvent = (event: AgentEvent) => handlers?.onAgentEvent(event);

async function runScriptedTurn(prompt: string) {
	emitAgentEvent({ type: "iteration_start", iteration: 1 });
	const reply = `You said: "${prompt}". The host streamed this response through the same AgentEvent contract the CLI runtime uses.`;
	for (const chunk of reply.match(/.{1,6}/g) ?? []) {
		emitAgentEvent({ type: "content_start", contentType: "text", text: chunk });
		await Bun.sleep(25);
	}
	emitAgentEvent({ type: "content_end", contentType: "text", text: reply });
	emitAgentEvent({
		type: "usage",
		inputTokens: 12,
		outputTokens: 40,
		totalInputTokens: 12,
		totalOutputTokens: 40,
		cost: 0,
	});
	emitAgentEvent({ type: "done", reason: "completed", text: reply, iterations: 1 });
	return {
		usage: { inputTokens: 12, outputTokens: 40, totalCost: 0 },
		iterations: 1,
		finishReason: "completed",
	};
}

const emptyConfigData = {
	workflows: [],
	rules: [],
	skills: [],
	hooks: [],
	agents: [],
	plugins: [],
	mcp: [],
	tools: [],
	workflowSlashCommands: [],
};

const ui = await runInteractiveTerminalUi({
	config: {
		providerId: "scripted",
		modelId: "echo-1",
		apiKey: "example",
		cwd: process.cwd(),
		workspaceRoot: process.cwd(),
		mode: "act",
	},
	subscribeToEvents: (next) => {
		handlers = next;
		return () => {
			handlers = null;
		};
	},
	onSubmit: (input) => runScriptedTurn(input),
	onUpdatePendingPrompt: async () => ({
		sessionId: "example-session",
		prompts: [],
	}),
	onAbort: () => false,
	onExit: () => ui.destroy(),
	onRunningChange: () => {},
	onTurnErrorReported: () => {},
	onAutoApproveChange: () => {},
	onCompactionModeChange: async () => {},
	onModelChange: async () => {},
	onModeChange: async () => {},
	onNewSession: async () => {},
	onSessionRestart: async () => {},
	onCompact: async () => ({
		messagesBefore: 0,
		messagesAfter: 0,
		compacted: false,
	}),
	onFork: async () => undefined,
	loadConfigData: async () => emptyConfigData,
	setToolApprover: () => {},
	setAskQuestion: () => {},
	setModeChangeNotifier: () => {},
});
await ui.waitUntilExit();
