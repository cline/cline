#!/usr/bin/env bun
/**
 * A runnable local hub for the phone to talk to.
 *
 *   bun run scripts/dev-hub.ts
 *
 * Boots the REAL hub WebSocket server (`startHubWebSocketServer` from
 * `@cline/core/hub`) backed by a scripted runtime host, so command dispatch,
 * subprotocol auth, event projection and approval bookkeeping are all the
 * production code paths — only the "model" is scripted. The iOS simulator shares
 * the Mac loopback, so it can reach this over `ws://127.0.0.1:<port>`.
 *
 * Prompt-selected fixture turns cover local responses, an interactive question,
 * an approval-gated synthetic diff, queued input, and generated image media.
 * Point the app at the printed URL and the token in its private config file.
 *
 * ## Why the imports look unusual
 *
 * `@cline/core/hub`'s published `dist/` bundle throws under Bun (`K20 is not
 * defined`), which is why the vitest config aliases that specifier to source.
 * There is no such alias for `bun run`, so this loads the hub server and the
 * scripted host from their TypeScript sources directly, by absolute path, via
 * `import()` with a computed specifier. The computed specifier also keeps `tsc`
 * from dragging the entire core/testkit type graph into the mobile typecheck.
 * Importing the `@cline/hub-testkit` *barrel* is deliberately avoided: it
 * statically re-exports `test-hub`, which imports the broken `@cline/core/hub`
 * dist.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HubClient } from "@cline/hub-client";
import type {
	HubEventEnvelope,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/shared";
import type {
	ScriptStep,
	TurnScript,
} from "../../../sdk/packages/hub-testkit/src/script";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const CORE_HUB_SRC = resolve(REPO_ROOT, "sdk/packages/core/src/hub/index.ts");
const SCRIPTED_HOST_SRC = resolve(
	REPO_ROOT,
	"sdk/packages/hub-testkit/src/scripted-runtime-host.ts",
);
const DEV_HUB_JSON = resolve(
	process.env.DEV_HUB_CONFIG_PATH ?? resolve(HERE, "..", ".dev-hub.json"),
);
const DISCOVERY_PATH = resolve(
	process.env.DEV_HUB_DISCOVERY_PATH ??
		resolve(HERE, "..", ".dev-hub-discovery.json"),
);

const PREFERRED_PORT = Number(process.env.DEV_HUB_PORT ?? 4599);
const HOST = "127.0.0.1";
const PATHNAME = "/hub";
const WORKSPACE_ROOT =
	process.env.DEV_HUB_WORKSPACE_ROOT ?? "/cline/dev-workspace";

/** A tiny valid PNG used only by the isolated fixture's media scenario. */
const SAMPLE_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

/** Half-second PCM tone, generated locally so playback needs no external host. */
function sampleWav(): string {
	const sampleCount = 4000;
	const bytes = Buffer.alloc(44 + sampleCount * 2);
	bytes.write("RIFF", 0);
	bytes.writeUInt32LE(bytes.length - 8, 4);
	bytes.write("WAVEfmt ", 8);
	bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(1, 20);
	bytes.writeUInt16LE(1, 22);
	bytes.writeUInt32LE(8000, 24);
	bytes.writeUInt32LE(16000, 28);
	bytes.writeUInt16LE(2, 32);
	bytes.writeUInt16LE(16, 34);
	bytes.write("data", 36);
	bytes.writeUInt32LE(sampleCount * 2, 40);
	for (let sample = 0; sample < sampleCount; sample++) {
		bytes.writeInt16LE(
			Math.round(Math.sin((sample * 2 * Math.PI * 440) / 8000) * 4000),
			44 + sample * 2,
		);
	}
	return bytes.toString("base64");
}

/**
 * `ScriptedRuntimeHost` supplies real event projection and tool approvals. This
 * adapter adds a few prompt-selected scenarios that need client capabilities
 * or a media event, while leaving ordinary turns on the shared testkit path.
 */
type FixtureEventListener = (
	event:
		| { type: "agent_event"; payload: { sessionId: string; event: unknown } }
		| { type: "status"; payload: { sessionId: string; status: string } },
) => void;

interface FixtureHostOptions {
	workspaceRoot: string;
	approvals: "wait-for-respond";
	defaultScript?: ScriptStep[] | TurnScript;
}

interface FixtureHostStartInput {
	config: { sessionId?: string; mode?: string; [key: string]: unknown };
	capabilities?: {
		requestToolApproval?: (
			request: ToolApprovalRequest,
		) => Promise<ToolApprovalResult> | ToolApprovalResult;
		toolExecutors?: {
			askQuestion?: (
				question: string,
				options: string[],
				context: unknown,
			) => Promise<string>;
		};
	};
}

interface FixtureConnectionUpdates {
	providerId?: string;
	modelId?: string;
	reasoningEffort?: string | null;
}

interface ScriptedRuntimeHostInstance {
	subscribe(listener: FixtureEventListener): () => void;
	startSession(input: FixtureHostStartInput): Promise<unknown>;
	runTurn(input: { sessionId: string; prompt: string }): Promise<unknown>;
	enqueue(script: ScriptStep[] | TurnScript): void;
	releaseGate(id: string): void;
	updateSessionConnection(
		sessionId: string,
		updates: FixtureConnectionUpdates,
	): Promise<void>;
	getSession(sessionId: string): Promise<unknown>;
}

interface ScriptedRuntimeHostConstructor {
	new (options: FixtureHostOptions): ScriptedRuntimeHostInstance;
}

export function createMobileFixtureHost(
	ScriptedRuntimeHost: ScriptedRuntimeHostConstructor,
) {
	return class MobileFixtureHost extends ScriptedRuntimeHost {
		private readonly fixtureListeners = new Set<FixtureEventListener>();
		private readonly questionExecutors = new Map<
			string,
			NonNullable<
				NonNullable<FixtureHostStartInput["capabilities"]>["toolExecutors"]
			>["askQuestion"]
		>();
		private readonly approvalExecutors = new Map<
			string,
			NonNullable<FixtureHostStartInput["capabilities"]>["requestToolApproval"]
		>();
		private nextQueueGate = 0;
		private readonly sessionModes = new Map<string, string>();
		private readonly reasoningChoices = new Map<string, string | null>();

		subscribe(listener: FixtureEventListener): () => void {
			this.fixtureListeners.add(listener);
			const unsubscribe = super.subscribe(listener);
			return () => {
				this.fixtureListeners.delete(listener);
				unsubscribe();
			};
		}

		async startSession(input: FixtureHostStartInput): Promise<unknown> {
			const sessionId = input.config.sessionId?.trim() || "testkit-session";
			this.questionExecutors.set(
				sessionId,
				input.capabilities?.toolExecutors?.askQuestion,
			);
			this.approvalExecutors.set(
				sessionId,
				input.capabilities?.requestToolApproval,
			);
			if (typeof input.config.mode === "string") {
				this.sessionModes.set(sessionId, input.config.mode);
			}
			return await super.startSession({
				...input,
				capabilities: {
					...input.capabilities,
					// The shared host stores one callback; route it by the request's session.
					requestToolApproval: (request) => {
						const executor = this.approvalExecutors.get(request.sessionId);
						if (!executor)
							throw new Error(
								"The mobile client did not register tool approval.",
							);
						return executor(request);
					},
				},
			});
		}

		async runTurn(input: {
			sessionId: string;
			prompt: string;
		}): Promise<unknown> {
			const prompt = input.prompt.toLowerCase();
			if (
				prompt.includes("ask-question") ||
				prompt.includes("ask me a question")
			) {
				const askQuestion = this.questionExecutors.get(input.sessionId);
				if (!askQuestion) {
					throw new Error("The mobile client did not register askQuestion.");
				}
				const answer = await askQuestion(
					"Which fixture response should Cline use?",
					["Use the existing design", "Try a simpler design"],
					{
						sessionId: input.sessionId,
						agentId: "agent-1",
						conversationId: "conversation-1",
						iteration: 1,
					},
				);
				this.enqueue({
					steps: [
						{ kind: "reasoning", chunks: ["Using the selected answer. "] },
						{
							kind: "text",
							chunks: [
								`Selected “${answer}”. The fixture kept this change local.`,
							],
						},
						{ kind: "usage", inputTokens: 42, outputTokens: 18, cost: 0.0001 },
					],
				});
				return await super.runTurn(input);
			}

			if (prompt.includes("sample-audio")) {
				this.emitFixtureEvent(input.sessionId, {
					type: "content_end",
					contentType: "media",
					media: {
						id: "mobile-fixture-sample-audio",
						modality: "audio",
						mediaType: "audio/wav",
						source: { type: "base64", data: sampleWav() },
						name: "fixture-tone.wav",
					},
				});
				this.enqueue({
					steps: [
						{ kind: "text", chunks: ["Here is the local fixture tone."] },
					],
				});
				return await super.runTurn(input);
			}

			if (
				prompt.includes("sample-image") ||
				prompt.includes("show sample image")
			) {
				this.emitFixtureEvent(input.sessionId, {
					type: "content_end",
					contentType: "media",
					media: {
						id: "mobile-fixture-sample-image",
						modality: "image",
						mediaType: "image/png",
						source: { type: "base64", data: SAMPLE_PNG },
						name: "fixture.png",
						sizeBytes: 68,
					},
				});
				this.enqueue({
					steps: [
						{ kind: "reasoning", chunks: ["Preparing a local sample image. "] },
						{ kind: "text", chunks: ["Here is the fixture image."] },
						{ kind: "usage", inputTokens: 35, outputTokens: 12, cost: 0.0001 },
					],
				});
				return await super.runTurn(input);
			}

			if (prompt.includes("queue-fixture")) {
				const gateId = `mobile-fixture-queue-${++this.nextQueueGate}`;
				this.enqueue({
					steps: [
						{
							kind: "reasoning",
							chunks: ["Holding briefly for queue interaction. "],
						},
						{ kind: "gate", id: gateId },
						{
							kind: "text",
							chunks: ["Processed the first queued fixture prompt."],
						},
					],
				});
				setTimeout(() => this.releaseGate(gateId), 8_000);
				return await super.runTurn(input);
			}

			if (
				prompt.includes("approval-fixture") ||
				prompt.includes("show a diff")
			) {
				this.enqueue({
					steps: [
						{
							kind: "reasoning",
							chunks: ["Preparing a synthetic workspace diff. "],
						},
						{
							kind: "tool",
							name: "bash",
							input: { command: "git diff -- src/Example.tsx" },
							output:
								"diff --git a/src/Example.tsx b/src/Example.tsx\n" +
								"--- a/src/Example.tsx\n+++ b/src/Example.tsx\n" +
								"@@ -1 +1 @@\n-export const title = 'Example';\n+export const title = 'Fixture';",
							requiresApproval: true,
						},
						{
							kind: "text",
							chunks: [
								"Displayed the synthetic diff; no workspace command ran.",
							],
						},
						{ kind: "usage", inputTokens: 51, outputTokens: 24, cost: 0.0001 },
					],
				});
				return await super.runTurn(input);
			}

			this.enqueue({
				steps: [
					{ kind: "reasoning", chunks: ["I received this fixture request. "] },
					{
						kind: "text",
						chunks: [`Fixture response to: “${input.prompt.trim()}”`],
					},
					{ kind: "usage", inputTokens: 30, outputTokens: 16, cost: 0.0001 },
				],
			});
			return await super.runTurn(input);
		}

		async updateSessionConnection(
			sessionId: string,
			updates: FixtureConnectionUpdates,
		): Promise<void> {
			if (
				typeof updates.reasoningEffort === "string" ||
				updates.reasoningEffort === null
			) {
				this.reasoningChoices.set(sessionId, updates.reasoningEffort);
			}
			await super.updateSessionConnection(sessionId, updates);
		}

		async getSession(sessionId: string): Promise<unknown> {
			const session = await super.getSession(sessionId);
			if (!session || typeof session !== "object") return session;
			return {
				...session,
				...(this.sessionModes.has(sessionId)
					? { mode: this.sessionModes.get(sessionId) }
					: {}),
				...(this.reasoningChoices.has(sessionId)
					? { reasoningEffort: this.reasoningChoices.get(sessionId) }
					: {}),
			};
		}

		private emitFixtureEvent(sessionId: string, event: unknown): void {
			for (const listener of this.fixtureListeners) {
				listener({ type: "agent_event", payload: { sessionId, event } });
			}
		}
	};
}

function log(...parts: unknown[]): void {
	console.log(`[dev-hub ${new Date().toISOString()}]`, ...parts);
}

/** Compact one-line summary of an event for the console. */
function summarizeEvent(envelope: HubEventEnvelope): string {
	const payload = (envelope.payload ?? {}) as Record<string, unknown>;
	switch (envelope.event) {
		case "approval.requested": {
			const tool = payload.toolName ?? payload.tool ?? "?";
			const input = payload.input ?? payload.inputJson;
			return `approval.requested tool=${String(tool)} input=${JSON.stringify(input)}`;
		}
		case "approval.resolved": {
			return `approval.resolved approved=${String(payload.approved)}${
				payload.reason ? ` reason=${String(payload.reason)}` : ""
			}`;
		}
		case "run.started":
			return "run.started (the phone sent input)";
		case "run.completed":
			return "run.completed";
		case "run.failed":
			return `run.failed ${JSON.stringify(payload)}`;
		case "run.aborted":
			return "run.aborted";
		case "usage.updated":
			return `usage.updated ${JSON.stringify(payload)}`;
		default:
			return envelope.event;
	}
}

async function startServer(
	coreHub: {
		startHubWebSocketServer: (options: unknown) => Promise<{
			url: string;
			authToken: string;
			close: () => Promise<void>;
		}>;
		createLocalHubScheduleRuntimeHandlers: () => unknown;
	},
	runtimeHost: unknown,
	port: number,
) {
	log(`starting isolated hub on port ${port}`);
	const server = await coreHub.startHubWebSocketServer({
		owner: {
			ownerId: "cline-mobile-dev-hub",
			// A throwaway discovery record so this can never be mistaken for the
			// developer's real local cline hub.
			discoveryPath: DISCOVERY_PATH,
		},
		host: HOST,
		port,
		pathname: PATHNAME,
		pairingDir: resolve(dirname(DISCOVERY_PATH), "pairing"),
		sessionSearchOptions: { dbPath: ":memory:" },
		taskOptions: {
			dbPath: ":memory:",
			globalSpecsDir: resolve(dirname(DISCOVERY_PATH), "task-specs"),
			watchFiles: false,
		},
		runtimeHandlers: coreHub.createLocalHubScheduleRuntimeHandlers(),
		scheduleOptions: { dbPath: ":memory:" },
		eventLog: { dbPath: ":memory:" },
		runQueue: { dbPath: ":memory:" },
		sessionHost: runtimeHost,
	});
	log(`isolated hub listening on ${server.url}`);
	return server;
}

async function main(): Promise<void> {
	// Computed specifiers: resolved by Bun at runtime, opaque to tsc. See header.
	const coreHubPath = CORE_HUB_SRC;
	const scriptedHostPath = SCRIPTED_HOST_SRC;
	log("loading core hub source");
	// biome-ignore lint/suspicious/noExplicitAny: cross-package source modules, typed loosely on purpose.
	const coreHub: any = await import(coreHubPath);
	log("core hub source loaded");
	// biome-ignore lint/suspicious/noExplicitAny: cross-package source modules, typed loosely on purpose.
	const { ScriptedRuntimeHost }: any = await import(scriptedHostPath);
	log("scripted runtime host loaded");
	const MobileFixtureHost = createMobileFixtureHost(ScriptedRuntimeHost);

	const runtimeHost = new MobileFixtureHost({
		workspaceRoot: WORKSPACE_ROOT,
		approvals: "wait-for-respond",
	});

	mkdirSync(dirname(DEV_HUB_JSON), { recursive: true });
	mkdirSync(dirname(DISCOVERY_PATH), { recursive: true });
	let server: Awaited<ReturnType<typeof startServer>>;
	try {
		server = await startServer(coreHub, runtimeHost, PREFERRED_PORT);
	} catch (error) {
		log(
			`could not bind port ${PREFERRED_PORT} (${
				error instanceof Error ? error.message : String(error)
			}); falling back to an ephemeral port`,
		);
		server = await startServer(coreHub, runtimeHost, 0);
	}

	const token = server.authToken;
	const url = server.url;

	// Machine-readable, single line, easy to grep/parse.
	console.log(`DEV_HUB_URL=${url}`);
	console.log(`DEV_HUB_CONFIG_PATH=${DEV_HUB_JSON}`);

	const record = {
		mode: "local" as const,
		url,
		authToken: token,
		port: Number(new URL(url).port),
		workspaceRoot: WORKSPACE_ROOT,
		createdAt: Date.now(),
	};
	writeFileSync(DEV_HUB_JSON, `${JSON.stringify(record, null, 2)}\n`, {
		mode: 0o600,
	});
	log(`wrote ${DEV_HUB_JSON}`);
	log("iOS simulator shares the Mac loopback, so ws://127.0.0.1 is reachable.");
	log(
		"Set EXPO_PUBLIC_DEV_HUB_URL / EXPO_PUBLIC_DEV_HUB_TOKEN to auto-connect.",
	);
	log("Waiting for the phone to connect. Ctrl-C to stop.");

	// An observer client logs the phone driving the hub (runs, approvals).
	const observer = new HubClient({
		url,
		authMode: "hub-subprotocol",
		credential: token,
		clientType: "cline-mobile-dev-hub-observer",
		displayName: "dev-hub observer",
		workspaceRoot: WORKSPACE_ROOT,
		cwd: WORKSPACE_ROOT,
	});
	await observer.connect();
	observer.subscribe((envelope) => {
		log(summarizeEvent(envelope));
	});

	let closing = false;
	const shutdown = async (): Promise<void> => {
		if (closing) {
			return;
		}
		closing = true;
		log("shutting down...");
		try {
			observer.close();
		} catch {
			// best-effort
		}
		await server.close();
		process.exit(0);
	};
	process.on("SIGINT", () => void shutdown());
	process.on("SIGTERM", () => void shutdown());

	// Keep the process alive until a signal arrives.
	await new Promise<never>(() => {});
}

if (import.meta.main)
	void main().catch((error) => {
		console.error("[dev-hub] fatal:", error);
		process.exit(1);
	});
