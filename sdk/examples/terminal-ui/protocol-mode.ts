/**
 * Protocol-driven terminal UI example.
 *
 * The host below owns everything runtime-shaped: it implements a
 * `UiConnection` (the canonical contract from `@cline/shared`, re-exported
 * by `@cline/ui/protocol`) and streams `UiOutboundMessage`s to whoever
 * subscribes. `runProtocolTerminalUi` is a thin terminal client over that
 * connection: it renders the transcript and sends user actions back as
 * `UiInboundMessage`s, without ever creating sessions or touching
 * persistence.
 *
 * This example wires the connection to a scripted local "agent" so it runs
 * without provider credentials. A real host would instead subscribe to
 * `ClineCore` session events (or a hub client) and translate them into the
 * same outbound messages — see `apps/cline-hub/src/server/agent-events.ts`
 * for a production projection.
 *
 * Run: bun sdk/examples/terminal-ui/protocol-mode.ts
 */

import type { UiConnection, UiInboundMessage, UiOutboundMessage } from "@cline/ui/protocol";
import { runProtocolTerminalUi } from "@cline/ui/tui";

function createScriptedHostConnection(): UiConnection {
	const listeners = new Set<(message: UiOutboundMessage) => void>();
	const emit = (message: UiOutboundMessage) => {
		for (const listener of listeners) listener(message);
	};
	let aborted = false;

	async function runScriptedTurn(prompt: string): Promise<void> {
		aborted = false;
		emit({ type: "status", text: "thinking" });

		const reasoning = "The user said: ".concat(prompt.slice(0, 40));
		for (const chunk of reasoning.match(/.{1,8}/g) ?? []) {
			if (aborted) return;
			emit({ type: "reasoning_delta", text: chunk });
			await Bun.sleep(40);
		}

		emit({
			type: "tool_event",
			text: "inspect_prompt",
			event: {
				toolCallId: "tool-1",
				toolName: "inspect_prompt",
				status: "running",
				input: { prompt },
			},
		});
		await Bun.sleep(250);
		if (aborted) return;
		emit({
			type: "tool_event",
			text: "inspect_prompt",
			event: {
				toolCallId: "tool-1",
				toolName: "inspect_prompt",
				status: "completed",
				output: { characters: prompt.length },
			},
		});

		const reply = `You said: "${prompt}". This transcript is rendered by the protocol-driven terminal client; the host only sent UiOutboundMessages.`;
		for (const chunk of reply.match(/.{1,6}/g) ?? []) {
			if (aborted) return;
			emit({ type: "assistant_delta", text: chunk });
			await Bun.sleep(25);
		}
		emit({
			type: "turn_done",
			finishReason: "completed",
			iterations: 1,
			usage: { inputTokens: 12, outputTokens: 48, totalCost: 0 },
		});
	}

	return {
		send(message: UiInboundMessage) {
			switch (message.type) {
				case "ready":
					emit({ type: "session_started", sessionId: "example-session" });
					emit({
						type: "defaults",
						defaults: {
							provider: "scripted",
							model: "echo-1",
							workspaceRoot: process.cwd(),
							cwd: process.cwd(),
						},
					});
					break;
				case "send":
					void runScriptedTurn(message.prompt).catch((error) => {
						emit({ type: "error", text: String(error) });
					});
					break;
				case "abort":
					aborted = true;
					emit({ type: "status", text: "aborted" });
					emit({ type: "turn_done", finishReason: "aborted", iterations: 0 });
					break;
				case "reset":
					aborted = true;
					emit({ type: "reset_done" });
					break;
				default:
					break;
			}
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

const ui = await runProtocolTerminalUi({
	connection: createScriptedHostConnection(),
	title: "Protocol TUI example",
});
await ui.waitUntilExit();
