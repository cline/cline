// Runs the shipped example, sdk/examples/plugins/btw.ts, the way a host does:
// loaded into the plugin sandbox, with its command run through
// executePluginCommand and its aside answered by AsideService from a real
// SessionRuntime. Only the model is scripted.
import { fileURLToPath } from "node:url";
import type { AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { SessionRuntime } from "../../runtime/orchestration/session-runtime-orchestrator";
import { AsideService } from "../../services/asides";
import { executePluginCommand } from "../../services/plugin-command-api";
import { loadSandboxedPlugins } from "./plugin-sandbox";

const BTW_PLUGIN = fileURLToPath(
	new URL("../../../../../examples/plugins/btw.ts", import.meta.url),
);

interface ScriptedReply {
	text: string;
	/** The reply is held back until this settles. */
	after?: Promise<void>;
}

const model = vi.hoisted(() => ({
	requests: [] as AgentModelRequest[],
	replies: [] as ScriptedReply[],
}));

vi.mock("../../services/llms/handler-factory", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("../../services/llms/handler-factory")
		>();
	return {
		...actual,
		createAgentModelFromConfig: () => ({
			stream: async (request: AgentModelRequest) => {
				model.requests.push(request);
				const reply = model.replies.shift() ?? { text: "" };
				return (async function* (): AsyncIterable<AgentModelEvent> {
					await reply.after;
					yield { type: "text-delta", text: reply.text };
					yield { type: "finish", reason: "stop" };
				})();
			},
		}),
	};
});

function script(...replies: ScriptedReply[]): void {
	model.requests.length = 0;
	model.replies.splice(0, model.replies.length, ...replies);
}

async function loadBtw(transport: "subprocess" | "worker") {
	const service = new AsideService();
	let session: SessionRuntime | undefined;
	const sandbox = await loadSandboxedPlugins({
		transport,
		pluginPaths: [BTW_PLUGIN],
		importTimeoutMs: 30_000,
		onAside: (ask) => service.ask("session-1", session, ask),
	});
	session = new SessionRuntime({
		providerId: "anthropic",
		modelId: "test-model",
		apiKey: "test-key",
		systemPrompt: "You are a helpful assistant.",
		tools: [],
		knownModels: {
			"test-model": { id: "test-model", capabilities: ["prompt-cache"] },
		},
		extensions: sandbox.extensions,
	});
	await session.initializeExtensions();
	const runtime = session;
	return {
		session: runtime,
		shutdown: () => sandbox.shutdown(),
		btw: async (question: string) =>
			(
				await executePluginCommand(
					runtime.getExtensionRegistry().commands,
					`/btw ${question}`,
				)
			)?.reply,
	};
}

function textOf(message: AgentModelRequest["messages"][number] | undefined) {
	return JSON.stringify(message?.content);
}

describe.each([
	"subprocess",
	"worker",
] as const)("the /btw example plugin (%s)", (transport) => {
	it("answers from a replay of the turn and leaves the chat as it was", async () => {
		script({ text: "Done." }, { text: "parser.ts, to fix the off-by-one." });
		const { session, btw, shutdown } = await loadBtw(transport);
		try {
			expect(await btw("")).toBe("Usage: /btw <a question about this chat>");
			expect(await btw("anything yet?")).toBe(
				"There is nothing to ask about yet. Send a message first.",
			);
			expect(model.requests).toHaveLength(0);

			await session.run("Fix the bug");
			const chat = structuredClone(session.getMessages());

			expect(await btw("which file changed first?")).toBe(
				"parser.ts, to fix the off-by-one.",
			);

			expect(session.getMessages()).toEqual(chat);
			const [turn, aside] = model.requests as [
				AgentModelRequest,
				AgentModelRequest,
			];
			expect(aside.systemPrompt).toBe(turn.systemPrompt);
			expect(aside.tools).toEqual(turn.tools);
			expect(aside.messages.slice(0, turn.messages.length)).toEqual(
				turn.messages,
			);
			const appended = aside.messages.slice(turn.messages.length);
			expect(appended.map((message) => message.role)).toEqual([
				"assistant",
				"user",
			]);
			expect(textOf(appended[0])).toContain("Done.");
			expect(textOf(appended[1])).toContain("which file changed first?");
		} finally {
			await shutdown();
		}
	}, 60_000);

	it("answers while the agent is still working, without touching its turn", async () => {
		let finishTurn = () => {};
		const turnHeld = new Promise<void>((resolve) => {
			finishTurn = resolve;
		});
		script(
			{ text: "Done.", after: turnHeld },
			{ text: "It is reading the parser." },
		);
		const { session, btw, shutdown } = await loadBtw(transport);
		try {
			const run = session.run("Fix the bug");
			await vi.waitFor(() => expect(model.requests).toHaveLength(1));

			expect(await btw("what is it doing?")).toBe("It is reading the parser.");

			finishTurn();
			const result = await run;

			expect(result.text).toBe("Done.");
			expect(result.iterations).toBe(1);
			expect(JSON.stringify(session.getMessages())).not.toContain(
				"what is it doing?",
			);
			const [turn, aside] = model.requests as [
				AgentModelRequest,
				AgentModelRequest,
			];
			expect(aside.messages.slice(0, turn.messages.length)).toEqual(
				turn.messages,
			);
			const appended = aside.messages.slice(turn.messages.length);
			expect(appended.map((message) => message.role)).toEqual(["user"]);
			expect(textOf(appended[0])).toContain("what is it doing?");
		} finally {
			await shutdown();
		}
	}, 60_000);
});
