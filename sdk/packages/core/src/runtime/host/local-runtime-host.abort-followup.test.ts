import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuntime } from "@cline/agents";
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
} from "@cline/shared";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSessionService } from "../../session/services/file-session-service";
import type { CoreSessionConfig } from "../../types/config";
import { SessionRuntime } from "../orchestration/session-runtime-orchestrator";
import { LocalRuntimeHost } from "./local-runtime-host";
import { splitCoreSessionConfig } from "./runtime-host";

class ScriptedModel implements AgentModel {
	public readonly requests: AgentModelRequest[] = [];

	constructor(
		private readonly steps: Array<
			(
				request: AgentModelRequest,
			) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>
		>,
	) {}

	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request);
		const step = this.steps.shift();
		if (!step) {
			throw new Error("No scripted model step available");
		}
		return (async function* () {
			yield* step(request) as AsyncIterable<AgentModelEvent>;
		})();
	}
}

// Regression coverage for cline/cline#14702: stopping a streaming response
// must end that model turn for good — the next submitted prompt starts a
// fresh turn that sees the partial response in the transcript instead of
// regenerating the cancelled one. Exercises the real LocalRuntimeHost →
// SessionRuntime → AgentRuntime stack with a scripted model so the
// transcript state machine is covered end to end.
describe("LocalRuntimeHost abort then follow-up", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
	};
	let isolatedHomeDir = "";

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "cline-abort-repro-"));
		process.env.HOME = isolatedHomeDir;
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline");
		setHomeDir(isolatedHomeDir);
		setClineDir(process.env.CLINE_DIR);
	});

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME;
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR;
		rmSync(isolatedHomeDir, { recursive: true, force: true });
	});

	it("answers the follow-up instead of resuming the aborted response", async () => {
		const model = new ScriptedModel([
			// Turn 1: stream part of the essay, then honor the abort signal
			// like a real provider stream does.
			async function* (request) {
				yield {
					type: "text-delta",
					text: "The history of the terminal begins",
				};
				await new Promise<void>((resolve) => {
					if (request.signal?.aborted) return resolve();
					request.signal?.addEventListener("abort", () => resolve(), {
						once: true,
					});
				});
				throw new DOMException("Cancelled", "AbortError");
			},
			// Turn 2 (the follow-up): answer it in one line.
			() => [
				{ type: "text-delta", text: "One-line summary." },
				{ type: "finish", reason: "stop" },
			],
		]);

		const manager = new LocalRuntimeHost({
			sessionService: new FileSessionService(join(isolatedHomeDir, "sessions")),
			createAgent: (config) =>
				new SessionRuntime(config, {
					createAgentRuntimeImpl: (runtimeConfig) =>
						new AgentRuntime({
							...runtimeConfig,
							model,
						}),
				}) as never,
		});

		try {
			const config: CoreSessionConfig = {
				providerId: "mock-provider",
				modelId: "mock-model",
				cwd: join(isolatedHomeDir, "workspace"),
				systemPrompt: "You are a test agent",
				mode: "act",
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			};
			const { sessionId } = await manager.startSession({
				...splitCoreSessionConfig(config),
				config,
				interactive: true,
			});

			// Turn 1: essay prompt; abort mid-stream.
			const firstTurn = manager.runTurn({
				sessionId,
				prompt: "Write a 2000 word essay about the history of the terminal.",
			});
			// Wait until the model has produced its first delta before stopping.
			await expect.poll(() => model.requests.length, { timeout: 5000 }).toBe(1);
			await manager.abort(sessionId, "user_abort");
			const firstResult = await firstTurn;
			expect(firstResult?.finishReason).toBe("aborted");

			// Turn 2: the follow-up. With the bug this either resumes the essay
			// turn (a second request seeded without the new prompt) or runs a
			// fresh turn whose transcript lost the partial essay text.
			const secondResult = await manager.runTurn({
				sessionId,
				prompt: "Summarise what you wrote in one line.",
			});
			expect(secondResult?.finishReason).toBe("completed");
			expect(secondResult?.text).toBe("One-line summary.");
			expect(model.requests).toHaveLength(2);

			const secondRequestMessages = model.requests[1]?.messages ?? [];
			const lastMessage = secondRequestMessages.at(-1);
			expect(lastMessage?.role).toBe("user");
			expect(
				lastMessage?.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join(""),
			).toContain("Summarise what you wrote in one line.");
			// The aborted essay's partial assistant text must be part of the
			// follow-up turn's transcript, otherwise the model sees the essay
			// instruction as still unanswered and regenerates it.
			const assistantTexts = secondRequestMessages
				.filter((message) => message.role === "assistant")
				.flatMap((message) => message.content)
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("");
			expect(assistantTexts).toContain("The history of the terminal begins");
		} finally {
			await manager.dispose();
		}
	});
});
