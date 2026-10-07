import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	AgentAfterToolContext,
	AgentBeforeToolContext,
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeEvent,
	AgentToolResult,
	BasicLogger,
} from "@cline/shared";
import type { CoreRecordingConfig } from "../../types/config";
import {
	SESSION_RECORDING_DIR,
	SESSION_RECORDING_FILES,
	SESSION_RECORDING_FORMAT,
	SESSION_RECORDING_MATCH_KEY_VERSION,
	SESSION_RECORDING_VERSION,
	type SessionRecordedEvent,
	type SessionRecordedModelCall,
	type SessionRecordingBlobKind,
	type SessionRecordingHeader,
	SessionRecordingHeaderSchema,
	type SessionRecordingSegment,
} from "./recording-schema";
import {
	classifyToolEnvironment,
	collectRecordedEnv,
	commandResultFacts,
	hashFileFacts,
	TOOL_ENVIRONMENT_METADATA_KEY,
	type ToolEnvironmentFacts,
	type ToolEnvironmentFileFact,
	toolEnvironmentTargetPaths,
} from "./tool-environment";

export const SESSION_RECORDING_ENV = "CLINE_RECORD_SESSIONS";

/**
 * Whether a session should be recorded: an explicit `recording.enabled`
 * wins; otherwise `CLINE_RECORD_SESSIONS=1|true` turns recording on for every
 * session the process hosts (hub daemons included).
 */
export function resolveSessionRecording(
	config: CoreRecordingConfig | undefined,
	env: NodeJS.ProcessEnv = process.env,
): "config" | "env" | undefined {
	if (config?.enabled === true) return "config";
	if (config?.enabled === false) return undefined;
	const value = env[SESSION_RECORDING_ENV]?.trim().toLowerCase();
	return value === "1" || value === "true" || value === "yes"
		? "env"
		: undefined;
}

export function sessionRecordingDir(sessionDir: string): string {
	return join(sessionDir, SESSION_RECORDING_DIR);
}

/**
 * Connection settings recorded per model call. Never includes credentials.
 * Field names avoid the `*Id` suffix the export redaction rules strip.
 */
export interface SessionRecordedProvider {
	provider: string;
	model: string;
	baseUrl?: string;
	headerNames?: string[];
	maxOutputTokens?: number;
	temperature?: number;
	reasoningEffort?: unknown;
	thinking?: unknown;
	thinkingBudgetTokens?: number;
}

export interface SessionRecorderCompactionState {
	source_prefix_hash?: string;
	source_message_count: number;
	updated_at: string;
}

export interface SessionRecorderOptions {
	sessionId: string;
	/** `<session-dir>/recording`. */
	dir: string;
	enabledBy: "config" | "env";
	cwd: string;
	logger?: BasicLogger;
	getCompactionState?: () => SessionRecorderCompactionState | undefined;
	now?: () => number;
}

export interface SessionRecorderStats {
	modelCalls: number;
	events: number;
	blobs: number;
	blobsDeduplicated: number;
	bytes: { requests: number; blobs: number; events: number; header: number };
	/**
	 * Sum of every request's serialized parts (system prompt, tools, messages,
	 * options) before deduplication: roughly what capturing each request body
	 * would store.
	 */
	fullRequestBytes: number;
	/** Synchronous time spent hashing and serializing records. */
	recordMs: number;
	/** Time spent in file writes. */
	writeMs: number;
}

export interface SessionDecisionInput {
	agentId?: string | null;
	iteration?: number;
	toolCallId?: string;
	refs?: Record<string, string | number>;
	payload?: Record<string, unknown>;
}

/** The recorder surface a {@link SessionRuntime} drives. */
export interface SessionRuntimeRecorder {
	wrapModel(model: AgentModel, provider: SessionRecordedProvider): AgentModel;
	onAssistantMessageAssembled(message: AgentMessage): void;
	onRuntimeEvent(event: AgentRuntimeEvent): void;
	beforeTool(ctx: AgentBeforeToolContext): Promise<void>;
	afterTool(ctx: AgentAfterToolContext): Promise<AgentToolResult | undefined>;
}

interface PendingModelCall {
	record: Omit<SessionRecordedModelCall, "seq" | "finishedAt" | "durationMs">;
	startedMs: number;
	finishedMs?: number;
}

type WriteTarget = "requests" | "blobs" | "events";

interface HashedRequestMessage {
	sha256: string;
	contentSha256: string;
	bytes: number;
}

function sha256Hex(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

function toJsonSafe<T>(value: T): T | null {
	try {
		const text = JSON.stringify(value);
		return text === undefined ? null : (JSON.parse(text) as T);
	} catch {
		return null;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function stripUrlCredentials(url: string | undefined): string | undefined {
	if (!url) return undefined;
	try {
		const parsed = new URL(url);
		if (!parsed.username && !parsed.password) return url;
		parsed.username = "";
		parsed.password = "";
		return parsed.toString();
	} catch {
		return url;
	}
}

export function describeRecordedProvider(input: {
	providerId: string;
	modelId: string;
	baseUrl?: string;
	headers?: Record<string, string>;
	maxTokensPerTurn?: number;
	temperature?: number;
	reasoningEffort?: unknown;
	thinking?: unknown;
	thinkingBudgetTokens?: number;
}): SessionRecordedProvider {
	const headerNames = input.headers ? Object.keys(input.headers).sort() : [];
	const baseUrl = stripUrlCredentials(input.baseUrl);
	return {
		provider: input.providerId,
		model: input.modelId,
		...(baseUrl ? { baseUrl } : {}),
		...(headerNames.length > 0 ? { headerNames } : {}),
		...(input.maxTokensPerTurn !== undefined
			? { maxOutputTokens: input.maxTokensPerTurn }
			: {}),
		...(input.temperature !== undefined
			? { temperature: input.temperature }
			: {}),
		...(input.reasoningEffort !== undefined
			? { reasoningEffort: input.reasoningEffort }
			: {}),
		...(input.thinking !== undefined ? { thinking: input.thinking } : {}),
		...(input.thinkingBudgetTokens !== undefined
			? { thinkingBudgetTokens: input.thinkingBudgetTokens }
			: {}),
	};
}

/** sha256 of a message's `[role, content]`: what the provider sees of it. */
export function recordedMessageContentSha256(message: {
	role: string;
	content: unknown;
}): string {
	return sha256Hex(JSON.stringify([message.role, message.content]));
}

/**
 * A request message as stored in a `message` blob. The runtime rebuilds
 * request messages with fresh ids and timestamps for every model call and
 * neither reaches the provider, so both are dropped; otherwise no message
 * would deduplicate across calls.
 */
export function recordedRequestMessage(
	message: AgentModelRequest["messages"][number],
): Record<string, unknown> {
	const { id: _id, createdAt: _createdAt, ...stable } = message;
	return stable;
}

/**
 * The two serializations a request message is hashed by, built from one
 * `JSON.stringify` of its content (the bulk of a long conversation):
 * `JSON.stringify([role, content])` and
 * `JSON.stringify(recordedRequestMessage(message))`.
 */
function serializeRequestMessage(
	message: AgentModelRequest["messages"][number],
): { contentJson: string; blobJson: string } {
	const { id: _id, createdAt: _createdAt, role, content, ...rest } = message;
	const roleJson = JSON.stringify(role);
	const contentPart = JSON.stringify(content);
	const restJson = JSON.stringify(rest);
	return {
		contentJson: `[${roleJson},${contentPart}]`,
		blobJson: `{"role":${roleJson},"content":${contentPart}${
			restJson === "{}" ? "}" : `,${restJson.slice(1)}`
		}`,
	};
}

/**
 * The key phase-3 replay pairs a live request with a recorded one by. Built
 * from content hashes only, so message ids, timestamps and metadata (all of
 * which differ between runs) do not affect it.
 */
export function computeRecordedRequestMatchKey(input: {
	systemPromptSha256: string | null;
	toolsSha256: string;
	messageContentSha256s: readonly string[];
}): string {
	return sha256Hex(
		[
			SESSION_RECORDING_MATCH_KEY_VERSION,
			input.systemPromptSha256 ?? "",
			input.toolsSha256,
			...input.messageContentSha256s,
		].join("\n"),
	);
}

export function recordedToolDefinitions(
	tools: AgentModelRequest["tools"],
): Array<{ name: string; description: string; inputSchema: unknown }> {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));
}

/**
 * Writes one session's recording. Writes are buffered and appended in the
 * background; recording failures are logged and never fail the session.
 */
export class SessionRecorder implements SessionRuntimeRecorder {
	readonly sessionId: string;
	readonly dir: string;
	readonly enabledBy: "config" | "env";
	private readonly cwd: string;
	private readonly logger?: BasicLogger;
	private readonly getCompactionState?: SessionRecorderOptions["getCompactionState"];
	private readonly now: () => number;
	private readonly envSnapshot: Record<string, string>;
	readonly envSha256: string;

	private seq = 0;
	private callIndex = 0;
	private readonly knownBlobs = new Set<string>();
	private header: SessionRecordingHeader | undefined;
	private segment: SessionRecordingSegment | undefined;
	private readonly attempts = new Map<string, number>();
	private currentRunId: string | null = null;
	private currentIteration = 0;
	private pendingCall: PendingModelCall | undefined;
	/**
	 * Hashes of the last request's messages by serialized blob. Requests
	 * repeat almost every message of the one before, so this skips nearly
	 * all hashing while holding one request's worth of strings.
	 */
	private previousMessageHashes = new Map<string, HashedRequestMessage>();
	/** Message list of the last request, which the next one is stored against. */
	private previousRequestMessages:
		| { callIndex: number; sha256s: string[] }
		| undefined;
	private readonly preImages = new Map<
		string,
		Promise<ToolEnvironmentFileFact[]>
	>();
	private readonly buffers: Record<WriteTarget, string[]> = {
		requests: [],
		blobs: [],
		events: [],
	};
	private writeChain: Promise<void> = Promise.resolve();
	private flushScheduled = false;
	private dirReady = false;
	private headerDirty = false;
	private currentMode: string | null = null;
	private writeFailed = false;
	private closed = false;
	private readonly statsState: SessionRecorderStats = {
		modelCalls: 0,
		events: 0,
		blobs: 0,
		blobsDeduplicated: 0,
		bytes: { requests: 0, blobs: 0, events: 0, header: 0 },
		fullRequestBytes: 0,
		recordMs: 0,
		writeMs: 0,
	};

	private constructor(options: SessionRecorderOptions) {
		this.sessionId = options.sessionId;
		this.dir = options.dir;
		this.enabledBy = options.enabledBy;
		this.cwd = options.cwd;
		this.logger = options.logger;
		this.getCompactionState = options.getCompactionState;
		this.now = options.now ?? Date.now;
		this.envSnapshot = collectRecordedEnv();
		this.envSha256 = sha256Hex(JSON.stringify(this.envSnapshot));
	}

	/**
	 * Opens the recording directory, continuing the sequence, call index and
	 * blob set of an earlier host start of the same session.
	 */
	static async open(options: SessionRecorderOptions): Promise<SessionRecorder> {
		const recorder = new SessionRecorder(options);
		await recorder.load();
		return recorder;
	}

	private path(name: keyof typeof SESSION_RECORDING_FILES): string {
		return join(this.dir, SESSION_RECORDING_FILES[name]);
	}

	private async load(): Promise<void> {
		const headerPath = this.path("header");
		if (existsSync(headerPath)) {
			try {
				const parsed = SessionRecordingHeaderSchema.safeParse(
					JSON.parse(await readFile(headerPath, "utf8")),
				);
				if (parsed.success) this.header = parsed.data;
			} catch {
				this.header = undefined;
			}
		}
		const readLines = async (name: WriteTarget): Promise<string[]> => {
			const file = this.path(name);
			if (!existsSync(file)) return [];
			return (await readFile(file, "utf8"))
				.split("\n")
				.filter((line) => line.trim().length > 0);
		};
		for (const line of await readLines("blobs")) {
			const match = /^\{"sha256":"([0-9a-f]{64})"/.exec(line);
			if (match?.[1]) this.knownBlobs.add(match[1]);
		}
		for (const line of [
			...(await readLines("events")),
			...(await readLines("requests")),
		]) {
			try {
				const parsed = JSON.parse(line) as {
					seq?: unknown;
					callIndex?: unknown;
				};
				if (typeof parsed.seq === "number") {
					this.seq = Math.max(this.seq, parsed.seq + 1);
				}
				if (typeof parsed.callIndex === "number") {
					this.callIndex = Math.max(this.callIndex, parsed.callIndex + 1);
				}
			} catch {
				// A torn last line from an earlier crash; later lines still parse.
			}
		}
	}

	/**
	 * Adds this host start to `recording.json`. A mode that differs from the
	 * previous segment's (a restart to switch plan/act) is recorded as a
	 * `mode_switched` decision. Nothing reaches disk until the first record
	 * does, so a session that never runs leaves no recording behind.
	 */
	startSegment(input: {
		leadAgentId: string | null;
		initialMessageCount: number;
		mode?: string;
		toolPolicies?: Record<string, unknown>;
	}): void {
		const startedAt = new Date(this.now()).toISOString();
		const previousMode = this.header?.segments.at(-1)?.mode ?? null;
		this.segment = {
			startedAt,
			enabledBy: this.enabledBy,
			pid: process.pid,
			leadAgentId: input.leadAgentId,
			initialMessageCount: input.initialMessageCount,
			firstSeq: this.seq,
			mode: input.mode ?? null,
			cwd: this.cwd,
			host: {
				platform: process.platform,
				arch: process.arch,
				node: process.version,
			},
			env: this.envSnapshot,
			envSha256: this.envSha256,
			...(input.toolPolicies
				? { toolPolicies: toJsonSafe(input.toolPolicies) ?? {} }
				: {}),
		};
		this.header = {
			format: SESSION_RECORDING_FORMAT,
			version: SESSION_RECORDING_VERSION,
			sessionId: this.sessionId,
			createdAt: this.header?.createdAt ?? startedAt,
			segments: [...(this.header?.segments ?? []), this.segment],
		};
		this.headerDirty = true;
		this.currentMode = this.segment.mode;
		if (
			previousMode &&
			this.segment.mode &&
			previousMode !== this.segment.mode
		) {
			this.recordDecision("mode_switched", {
				agentId: input.leadAgentId,
				payload: {
					from: previousMode,
					to: this.segment.mode,
					source: "session_restart",
				},
			});
		}
	}

	/**
	 * Notes the mode a turn or steered message runs in, recording a
	 * `mode_switched` decision when it differs from the mode in force.
	 */
	noteMode(
		mode: string | undefined,
		source: "turn" | "steer",
		input: SessionDecisionInput = {},
	): void {
		if (!mode || mode === this.currentMode) return;
		const from = this.currentMode;
		this.currentMode = mode;
		if (!from) return;
		this.recordDecision("mode_switched", {
			...input,
			payload: { ...(input.payload ?? {}), from, to: mode, source },
		});
	}

	private async writeHeader(): Promise<void> {
		if (!this.header || !this.headerDirty) return;
		this.headerDirty = false;
		const contents = `${JSON.stringify(this.header, null, 2)}\n`;
		await writeFile(this.path("header"), contents, "utf8");
		this.statsState.bytes.header = Buffer.byteLength(contents, "utf8");
	}

	/** Next value of the per-session ordering key. */
	nextSeq(): number {
		const value = this.seq;
		this.seq += 1;
		return value;
	}

	stats(): SessionRecorderStats {
		return {
			...this.statsState,
			bytes: { ...this.statsState.bytes },
		};
	}

	// ── Writing ─────────────────────────────────────────────────────────

	private enqueueLine(target: WriteTarget, value: unknown): void {
		if (this.closed) return;
		const line = `${JSON.stringify(value)}\n`;
		this.buffers[target].push(line);
		this.statsState.bytes[target] += Buffer.byteLength(line, "utf8");
		this.enqueueFlush();
	}

	/** Appends everything buffered so far; resolves when it is on disk. */
	flush(): Promise<void> {
		const batches = (Object.keys(this.buffers) as WriteTarget[])
			.map((target) => {
				const lines = this.buffers[target];
				this.buffers[target] = [];
				return { target, contents: lines.join("") };
			})
			.filter((batch) => batch.contents.length > 0);
		if (batches.length === 0) return this.writeChain;
		this.writeChain = this.writeChain.then(async () => {
			const started = performance.now();
			try {
				if (!this.dirReady) {
					await mkdir(this.dir, { recursive: true });
					this.dirReady = true;
				}
				await this.writeHeader();
				// Blobs before the records that name them.
				for (const target of ["blobs", "requests", "events"] as const) {
					const batch = batches.find((entry) => entry.target === target);
					if (batch) {
						await appendFile(this.path(target), batch.contents, "utf8");
					}
				}
			} catch (error) {
				this.reportWriteFailure(error);
			} finally {
				this.statsState.writeMs += performance.now() - started;
			}
		});
		return this.writeChain;
	}

	private reportWriteFailure(error: unknown): void {
		if (this.writeFailed) return;
		this.writeFailed = true;
		this.logger?.log?.("Session recording write failed", {
			sessionId: this.sessionId,
			dir: this.dir,
			error,
			severity: "warn",
		});
	}

	/** Flushes and stops recording. Later calls are ignored. */
	async close(): Promise<void> {
		if (this.closed) return;
		this.flushPendingCall();
		await this.flush();
		this.closed = true;
	}

	private putBlob(kind: SessionRecordingBlobKind, value: unknown): string {
		return this.putBlobJson(kind, JSON.stringify(value ?? null));
	}

	private putBlobJson(
		kind: SessionRecordingBlobKind,
		json: string,
		contentSha256?: string,
	): string {
		const sha256 = sha256Hex(json);
		this.statsState.fullRequestBytes += Buffer.byteLength(json, "utf8");
		if (this.knownBlobs.has(sha256)) {
			this.statsState.blobsDeduplicated += 1;
			return sha256;
		}
		this.knownBlobs.add(sha256);
		this.statsState.blobs += 1;
		// `sha256` stays the first key: resume scans lines for it without parsing.
		const line = `{"sha256":"${sha256}","kind":"${kind}"${
			contentSha256 ? `,"contentSha256":"${contentSha256}"` : ""
		},"value":${json}}`;
		if (!this.closed) {
			this.buffers.blobs.push(`${line}\n`);
			this.statsState.bytes.blobs += Buffer.byteLength(line, "utf8") + 1;
			this.enqueueFlush();
		}
		return sha256;
	}

	private enqueueFlush(): void {
		if (this.flushScheduled) return;
		this.flushScheduled = true;
		setImmediate(() => {
			this.flushScheduled = false;
			void this.flush();
		});
	}

	// ── Events and decisions ────────────────────────────────────────────

	private writeEvent(
		kind: SessionRecordedEvent["kind"],
		name: string,
		input: SessionDecisionInput,
		seq = this.nextSeq(),
	): number {
		const event: SessionRecordedEvent = {
			seq,
			ts: new Date(this.now()).toISOString(),
			kind,
			name,
			sessionId: this.sessionId,
			agentId: input.agentId ?? null,
			...(input.iteration !== undefined ? { iteration: input.iteration } : {}),
			...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
			...(input.refs && Object.keys(input.refs).length > 0
				? { refs: input.refs }
				: {}),
			payload: toJsonSafe(input.payload ?? {}) ?? {},
		};
		this.statsState.events += 1;
		this.enqueueLine("events", event);
		return seq;
	}

	/** Records a human or host decision (approval, mode, prompt delivery, abort). */
	recordDecision(name: string, input: SessionDecisionInput = {}): number {
		return this.writeEvent("decision", name, input);
	}

	/** Current run id and iteration of the lead agent, for decisions made mid-run. */
	currentPosition(): { runId: string | null; iteration: number } {
		return { runId: this.currentRunId, iteration: this.currentIteration };
	}

	// ── Model calls ─────────────────────────────────────────────────────

	wrapModel(model: AgentModel, provider: SessionRecordedProvider): AgentModel {
		return {
			stream: async (request) => {
				const call = this.beginModelCall(request, provider);
				let source: AsyncIterable<AgentModelEvent>;
				try {
					source = await model.stream(request);
				} catch (error) {
					this.failModelCall(call, request, error);
					throw error;
				}
				return this.recordStream(call, request, source);
			},
		};
	}

	private async *recordStream(
		call: PendingModelCall,
		request: AgentModelRequest,
		source: AsyncIterable<AgentModelEvent>,
	): AsyncGenerator<AgentModelEvent> {
		let completed = false;
		let failed = false;
		try {
			for await (const event of source) {
				this.recordModelEvent(call, event);
				yield event;
			}
			completed = true;
		} catch (error) {
			failed = true;
			this.failModelCall(call, request, error);
			throw error;
		} finally {
			if (!failed) {
				call.finishedMs = this.now();
				if (!completed) {
					call.record.response.outcome = request.signal?.aborted
						? "aborted"
						: "interrupted";
				}
				// Linked to its assistant message by the runtime's afterModel
				// hook; flushed unlinked by the next call or run end otherwise.
				this.pendingCall = call;
			}
		}
	}

	private beginModelCall(
		request: AgentModelRequest,
		provider: SessionRecordedProvider,
	): PendingModelCall {
		this.flushPendingCall();
		const started = performance.now();
		const startedMs = this.now();
		const metadata =
			request.options?.metadata && typeof request.options.metadata === "object"
				? (request.options.metadata as Record<string, unknown>)
				: {};
		const runId =
			typeof metadata.runId === "string" ? metadata.runId : this.currentRunId;
		const iteration =
			typeof metadata.iteration === "number"
				? metadata.iteration
				: this.currentIteration;
		const agentId =
			typeof metadata.agentId === "string" ? metadata.agentId : "unknown";
		const attemptKey = `${runId ?? ""}:${iteration}`;
		const attempt = this.attempts.get(attemptKey) ?? 0;
		this.attempts.set(attemptKey, attempt + 1);

		const systemPromptSha256 =
			request.systemPrompt !== undefined
				? this.putBlob("system-prompt", request.systemPrompt)
				: null;
		const toolsSha256 = this.putBlob(
			"tools",
			recordedToolDefinitions(request.tools),
		);
		const modelToolsSha256 =
			request.modelTools && request.modelTools.length > 0
				? this.putBlob("model-tools", toJsonSafe(request.modelTools))
				: null;
		const contentSha256s: string[] = [];
		const hashed = new Map<string, HashedRequestMessage>();
		const messageSha256s = request.messages.map((message) => {
			const { contentJson, blobJson } = serializeRequestMessage(message);
			const known = this.previousMessageHashes.get(blobJson);
			if (known) {
				hashed.set(blobJson, known);
				contentSha256s.push(known.contentSha256);
				this.statsState.fullRequestBytes += known.bytes;
				this.statsState.blobsDeduplicated += 1;
				return known.sha256;
			}
			const contentSha256 = sha256Hex(contentJson);
			contentSha256s.push(contentSha256);
			const sha256 = this.putBlobJson("message", blobJson, contentSha256);
			hashed.set(blobJson, {
				sha256,
				contentSha256,
				bytes: Buffer.byteLength(blobJson, "utf8"),
			});
			return sha256;
		});
		this.previousMessageHashes = hashed;
		const previous = this.previousRequestMessages;
		let shared = 0;
		if (previous) {
			const limit = Math.min(previous.sha256s.length, messageSha256s.length);
			while (
				shared < limit &&
				previous.sha256s[shared] === messageSha256s[shared]
			) {
				shared += 1;
			}
		}
		this.previousRequestMessages = {
			callIndex: this.callIndex,
			sha256s: messageSha256s,
		};
		const options = request.options ? toJsonSafe(request.options) : null;
		const compactionState = this.getCompactionState?.();
		const record: PendingModelCall["record"] = {
			callIndex: this.callIndex,
			sessionId: this.sessionId,
			agentId,
			runId: runId ?? null,
			iteration,
			attempt,
			startedAt: new Date(startedMs).toISOString(),
			compaction: compactionState
				? {
						id: compactionState.source_prefix_hash ?? null,
						sourceMessageCount: compactionState.source_message_count,
						updatedAt: compactionState.updated_at,
					}
				: null,
			request: {
				matchKey: computeRecordedRequestMatchKey({
					systemPromptSha256,
					toolsSha256,
					messageContentSha256s: contentSha256s,
				}),
				systemPromptSha256,
				toolsSha256,
				modelToolsSha256,
				messageCount: messageSha256s.length,
				messagePrefix:
					previous && shared > 0
						? { callIndex: previous.callIndex, count: shared }
						: null,
				messageSha256s: messageSha256s.slice(shared),
				options,
				provider: { ...provider },
			},
			response: {
				outcome: "completed",
				finishReason: null,
				requestId: null,
				error: null,
				messageId: null,
				toolCallIds: [],
				usage: null,
				events: [],
			},
		};
		this.callIndex += 1;
		if (options) {
			this.statsState.fullRequestBytes += Buffer.byteLength(
				JSON.stringify(options),
				"utf8",
			);
		}
		this.statsState.recordMs += performance.now() - started;
		return { record, startedMs };
	}

	private recordModelEvent(
		call: PendingModelCall,
		event: AgentModelEvent,
	): void {
		const started = performance.now();
		const response = call.record.response;
		const safe = toJsonSafe(event) as Record<string, unknown> | null;
		response.events.push({
			t: Math.max(0, this.now() - call.startedMs),
			event: safe ?? { type: event.type },
		});
		switch (event.type) {
			case "usage":
				response.usage = {
					...(response.usage ?? {}),
					...(toJsonSafe(event.usage) ?? {}),
				};
				break;
			case "finish":
				response.finishReason = event.reason;
				response.requestId = event.requestId ?? null;
				response.error = event.error ?? null;
				if (event.reason === "error") response.outcome = "error";
				if (event.reason === "aborted") response.outcome = "aborted";
				break;
			case "tool-call-delta":
				if (
					event.toolCallId &&
					!response.toolCallIds.includes(event.toolCallId)
				) {
					response.toolCallIds.push(event.toolCallId);
				}
				break;
			default:
				break;
		}
		this.statsState.recordMs += performance.now() - started;
	}

	private failModelCall(
		call: PendingModelCall,
		request: AgentModelRequest,
		error: unknown,
	): void {
		call.finishedMs = this.now();
		call.record.response.outcome = request.signal?.aborted
			? "aborted"
			: "error";
		call.record.response.error = errorMessage(error);
		this.pendingCall = call;
		this.flushPendingCall();
	}

	/** Called from the runtime's afterModel hook with the assembled message. */
	onAssistantMessageAssembled(message: AgentMessage): void {
		const call = this.pendingCall;
		if (!call) return;
		call.record.response.messageId = message.id;
		for (const part of message.content) {
			if (
				part.type === "tool-call" &&
				!call.record.response.toolCallIds.includes(part.toolCallId)
			) {
				call.record.response.toolCallIds.push(part.toolCallId);
			}
		}
		this.flushPendingCall();
	}

	private flushPendingCall(): void {
		const call = this.pendingCall;
		if (!call) return;
		this.pendingCall = undefined;
		const finishedMs = call.finishedMs ?? this.now();
		const { record } = call;
		const seq = this.writeEvent("runtime", "model_finished", {
			agentId: record.agentId,
			iteration: record.iteration,
			refs: {
				modelCallIndex: record.callIndex,
				...(record.runId ? { runId: record.runId } : {}),
				...(record.response.messageId
					? { messageId: record.response.messageId }
					: {}),
			},
			payload: {
				attempt: record.attempt,
				outcome: record.response.outcome,
				finishReason: record.response.finishReason,
				durationMs: finishedMs - call.startedMs,
				toolCalls: record.response.toolCallIds.length,
			},
		});
		const full: SessionRecordedModelCall = {
			...record,
			seq,
			finishedAt: new Date(finishedMs).toISOString(),
			durationMs: Math.max(0, finishedMs - call.startedMs),
		};
		this.statsState.modelCalls += 1;
		this.enqueueLine("requests", full);
	}

	// ── Runtime events ──────────────────────────────────────────────────

	onRuntimeEvent(event: AgentRuntimeEvent): void {
		const agentId = event.snapshot.agentId;
		switch (event.type) {
			case "run-started":
				this.currentRunId = event.snapshot.runId ?? null;
				this.currentIteration = 0;
				this.writeEvent("runtime", "run_started", {
					agentId,
					refs: this.currentRunId ? { runId: this.currentRunId } : {},
				});
				break;
			case "turn-started":
				this.currentIteration = event.iteration;
				this.writeEvent("runtime", "turn_started", {
					agentId,
					iteration: event.iteration,
					refs: this.currentRunId ? { runId: this.currentRunId } : {},
				});
				break;
			case "assistant-message":
				this.writeEvent("runtime", "assistant_message", {
					agentId,
					iteration: event.iteration,
					refs: { messageId: event.message.id },
					payload: { finishReason: event.finishReason },
				});
				break;
			case "tool-started":
				this.writeEvent("runtime", "tool_started", {
					agentId,
					iteration: event.iteration,
					toolCallId: event.toolCall.toolCallId,
					payload: {
						toolName: event.toolCall.toolName,
						...(event.toolCall.execution
							? { execution: event.toolCall.execution }
							: {}),
					},
				});
				break;
			case "tool-finished": {
				const resultPart = event.message.content.find(
					(part) => part.type === "tool-result",
				);
				this.writeEvent("runtime", "tool_finished", {
					agentId,
					iteration: event.iteration,
					toolCallId: event.toolCall.toolCallId,
					refs: { messageId: event.message.id },
					payload: {
						toolName: event.toolCall.toolName,
						isError:
							resultPart?.type === "tool-result" && resultPart.isError === true,
						...(event.toolCall.execution
							? { execution: event.toolCall.execution }
							: {}),
					},
				});
				break;
			}
			case "run-finished":
				this.flushPendingCall();
				this.writeEvent("runtime", "run_finished", {
					agentId,
					refs: this.currentRunId ? { runId: this.currentRunId } : {},
					payload: {
						status: event.result.status,
						iterations: event.result.iterations,
					},
				});
				break;
			case "run-failed":
				this.flushPendingCall();
				this.writeEvent("runtime", "run_failed", {
					agentId,
					refs: this.currentRunId ? { runId: this.currentRunId } : {},
					payload: {
						error: event.error.message,
						...(event.errorClass ? { errorClass: event.errorClass } : {}),
					},
				});
				break;
			default:
				break;
		}
	}

	// ── Tool environment ────────────────────────────────────────────────

	async beforeTool(ctx: AgentBeforeToolContext): Promise<void> {
		const kind = classifyToolEnvironment(ctx.tool.name);
		if (kind !== "edit" && kind !== "patch") return;
		const paths = toolEnvironmentTargetPaths(kind, ctx.input, this.cwd);
		if (paths.length === 0) return;
		const facts = hashFileFacts(paths);
		this.preImages.set(ctx.toolCall.toolCallId, facts);
		await facts;
	}

	async afterTool(
		ctx: AgentAfterToolContext,
	): Promise<AgentToolResult | undefined> {
		const toolCallId = ctx.toolCall.toolCallId;
		const preImage = await this.preImages.get(toolCallId);
		this.preImages.delete(toolCallId);
		const kind = classifyToolEnvironment(ctx.tool.name);
		if (!kind) return undefined;
		const facts: ToolEnvironmentFacts = { version: 1 };
		if (kind === "read") {
			const paths = toolEnvironmentTargetPaths(kind, ctx.input, this.cwd);
			if (paths.length > 0) facts.read = await hashFileFacts(paths);
		} else if (kind === "edit" || kind === "patch") {
			if (preImage) facts.preImage = preImage;
			const paths = toolEnvironmentTargetPaths(kind, ctx.input, this.cwd);
			if (paths.length > 0) facts.postImage = await hashFileFacts(paths);
		} else {
			facts.commands = {
				cwd: this.cwd,
				envSha256: this.envSha256,
				results: commandResultFacts(ctx.result.output),
			};
		}
		if (Object.keys(facts).length === 1) return undefined;
		return {
			...ctx.result,
			metadata: {
				...(ctx.result.metadata ?? {}),
				[TOOL_ENVIRONMENT_METADATA_KEY]: facts,
			},
		};
	}
}
