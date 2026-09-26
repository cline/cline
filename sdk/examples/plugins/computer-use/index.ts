import { randomUUID } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	type AgentPlugin,
	type AgentToolContext,
	createTool,
	type Message,
	resolveClineDataDir,
} from "@cline/core";
import { ComputerBackendRestart } from "./backend-restart";
import { ComputerUseClient } from "./client";
import { projectComputerScreenshots } from "./message-builder";
import type {
	ComputerUseAction,
	ComputerUseCoordinate,
	ComputerUseDisplayInfo,
	ComputerUseImage,
	ComputerUseRequest,
	ComputerUseResponse,
} from "./protocol";

interface ClinePluginHost {
	emitEvent?(name: string, payload?: unknown): void;
}

declare global {
	var __clinePluginHost: ClinePluginHost | undefined;
}

type NotifyMode = "steer" | "queue" | "none";
type JobStatus = "running" | "completed" | "failed" | "cancelled";
type JobKind = "computer" | "backend_restart";

interface ComputerToolInput {
	action: ComputerUseAction;
	coordinate?: ComputerUseCoordinate;
	start_coordinate?: ComputerUseCoordinate;
	text?: string;
	duration?: number;
	scroll_direction?: "up" | "down" | "left" | "right";
	scroll_amount?: number;
	region?: readonly [number, number, number, number];
	actions?: ComputerToolInput[];
	expect_unchanged?: readonly [number, number, number, number];
	deadline_ms?: number;
	notify?: NotifyMode;
}

interface JobRecord {
	version: 1;
	jobId: string;
	kind: JobKind;
	status: JobStatus;
	action?: ComputerUseAction;
	sessionId?: string;
	notify: NotifyMode;
	startedAt: string;
	completedAt?: string;
	text?: string;
	error?: string;
	aborted?: boolean;
	imageMediaType?: string;
	notifiedAt?: string;
}

interface JobCompletion {
	text: string;
	image?: ComputerUseImage;
	aborted?: boolean;
}

interface ActiveJob {
	controller: AbortController;
	promise: Promise<JobRecord>;
	promoted: boolean;
}

export interface ComputerUsePluginOptions {
	env?: NodeJS.ProcessEnv;
	jobsDir?: string;
	client?: ComputerUseClient;
	displayInfo?: ComputerUseDisplayInfo;
	deadlineMs?: number;
	requestTimeoutMs?: number;
}

const PORT_ENV = "CLINE_COMPUTER_USE_PORT";
const HOST_ENV = "CLINE_COMPUTER_USE_HOST";
const BACKEND_COMMAND_ENV = "CLINE_COMPUTER_USE_BACKEND_COMMAND";
const DEADLINE_ENV = "CLINE_COMPUTER_USE_DEADLINE_MS";
const REQUEST_TIMEOUT_ENV = "CLINE_COMPUTER_USE_REQUEST_TIMEOUT_MS";
const DEFAULT_DEADLINE_MS = 2_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const MAX_DEADLINE_MS = 10_000;
const JOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const COMPUTER_ACTIONS: readonly ComputerUseAction[] = [
	"screenshot",
	"cursor_position",
	"mouse_move",
	"left_click",
	"left_click_drag",
	"right_click",
	"middle_click",
	"double_click",
	"triple_click",
	"left_mouse_down",
	"left_mouse_up",
	"key",
	"hold_key",
	"type",
	"scroll",
	"wait",
	"zoom",
	"run_sequence",
];
const COMPUTER_ACTION_SET = new Set<string>(COMPUTER_ACTIONS);

function isComputerUseAction(value: unknown): value is ComputerUseAction {
	return typeof value === "string" && COMPUTER_ACTION_SET.has(value);
}

function parseNonNegativeInt(
	value: string | undefined,
	fallback: number,
	maximum = Number.MAX_SAFE_INTEGER,
): number {
	if (value === undefined || value.trim() === "") return fallback;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0
		? Math.min(parsed, maximum)
		: fallback;
}

function requirePort(env: NodeJS.ProcessEnv): number {
	const port = Number(env[PORT_ENV]);
	if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
		throw new Error(
			`Set ${PORT_ENV} to the qbt computer-use backend's TCP port before loading this plugin.`,
		);
	}
	return port;
}

function safeSessionDirectory(sessionId: string | undefined): string {
	return (sessionId?.trim() || "unknown-session").replace(
		/[^a-zA-Z0-9_-]/g,
		"_",
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function optionalCoordinate(value: unknown): ComputerUseCoordinate | undefined {
	return Array.isArray(value) &&
		value.length === 2 &&
		typeof value[0] === "number" &&
		typeof value[1] === "number"
		? [value[0], value[1]]
		: undefined;
}

function optionalRegion(
	value: unknown,
): readonly [number, number, number, number] | undefined {
	return Array.isArray(value) &&
		value.length === 4 &&
		value.every((entry) => typeof entry === "number")
		? [value[0], value[1], value[2], value[3]]
		: undefined;
}

function parseComputerToolInput(value: unknown): ComputerToolInput {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("computer input must be an object");
	}
	const record = value as Record<string, unknown>;
	if (!isComputerUseAction(record.action)) {
		throw new Error(`Unsupported computer action: ${String(record.action)}`);
	}
	const action = record.action;
	const scrollDirection =
		record.scroll_direction === "up" ||
		record.scroll_direction === "down" ||
		record.scroll_direction === "left" ||
		record.scroll_direction === "right"
			? record.scroll_direction
			: undefined;
	const notify =
		record.notify === "queue" || record.notify === "none"
			? record.notify
			: "steer";
	return {
		action,
		coordinate: optionalCoordinate(record.coordinate),
		start_coordinate: optionalCoordinate(record.start_coordinate),
		text: typeof record.text === "string" ? record.text : undefined,
		duration: typeof record.duration === "number" ? record.duration : undefined,
		scroll_direction: scrollDirection,
		scroll_amount:
			typeof record.scroll_amount === "number"
				? record.scroll_amount
				: undefined,
		region: optionalRegion(record.region),
		expect_unchanged: optionalRegion(record.expect_unchanged),
		actions: Array.isArray(record.actions)
			? record.actions.map((step) => parseComputerToolInput(step))
			: undefined,
		deadline_ms:
			typeof record.deadline_ms === "number" ? record.deadline_ms : undefined,
		notify,
	};
}

function toComputerUseRequest(
	input: ComputerToolInput,
): Omit<ComputerUseRequest, "id"> {
	return {
		action: input.action,
		coordinate: input.coordinate,
		startCoordinate: input.start_coordinate,
		text: input.text,
		durationSeconds: input.duration,
		scrollDirection: input.scroll_direction,
		scrollAmount: input.scroll_amount,
		region: input.region,
		expectUnchanged: input.expect_unchanged,
		...(input.actions
			? { actions: input.actions.map((step) => toComputerUseRequest(step)) }
			: {}),
	};
}

function responseToCompletion(
	action: ComputerUseAction,
	response: ComputerUseResponse,
): JobCompletion {
	if (!response.ok) {
		throw new Error(response.error ?? `Computer-use action "${action}" failed`);
	}
	return {
		text:
			response.text ??
			(response.aborted
				? `Action "${action}" aborted. Reassess the screen before continuing.`
				: `Action "${action}" completed.`),
		image: response.image,
		aborted: response.aborted,
	};
}

function completionOutput(completion: JobCompletion): unknown {
	if (!completion.image) return completion.text;
	return [
		{ type: "text" as const, text: completion.text },
		{
			type: "image" as const,
			data: completion.image.data,
			mediaType: completion.image.mediaType,
		},
	];
}

function actionProperties() {
	const action = {
		type: "string",
		enum: [
			"screenshot",
			"cursor_position",
			"mouse_move",
			"left_click",
			"left_click_drag",
			"right_click",
			"middle_click",
			"double_click",
			"triple_click",
			"left_mouse_down",
			"left_mouse_up",
			"key",
			"hold_key",
			"type",
			"scroll",
			"wait",
			"zoom",
		],
		description: "The action to perform.",
	};
	return {
		action,
		coordinate: {
			type: "array",
			items: { type: "number" },
			minItems: 2,
			maxItems: 2,
			description: "[x, y] pixel coordinate for pointer and scroll actions.",
		},
		start_coordinate: {
			type: "array",
			items: { type: "number" },
			minItems: 2,
			maxItems: 2,
			description: "[x, y] start coordinate for left_click_drag.",
		},
		text: {
			type: "string",
			description: "Text to type, or a key combination for key/hold_key.",
		},
		duration: { type: "number", description: "Seconds for hold_key or wait." },
		scroll_direction: {
			type: "string",
			enum: ["up", "down", "left", "right"],
		},
		scroll_amount: { type: "number" },
		region: {
			type: "array",
			items: { type: "number" },
			minItems: 4,
			maxItems: 4,
			description: "[x0, y0, x1, y1] region for zoom.",
		},
		expect_unchanged: {
			type: "array",
			items: { type: "number" },
			minItems: 4,
			maxItems: 4,
			description:
				"[x, y, width, height] click guard. The click is refused if this region changed since the last screenshot.",
		},
	};
}

function computerInputSchema(): Record<string, unknown> {
	const properties = actionProperties();
	return {
		type: "object",
		properties: {
			...properties,
			action: {
				...properties.action,
				enum: [...properties.action.enum, "run_sequence"],
			},
			actions: {
				type: "array",
				minItems: 1,
				maxItems: 20,
				description:
					"Steps for run_sequence. They execute back-to-back and return one final screenshot.",
				items: {
					type: "object",
					properties,
					required: ["action"],
					additionalProperties: false,
				},
			},
			deadline_ms: {
				type: "integer",
				minimum: 0,
				maximum: MAX_DEADLINE_MS,
				description:
					"How long to wait for a direct result before returning an asynchronous job handle. Omit for the configured default; 0 always returns a handle.",
			},
			notify: {
				type: "string",
				enum: ["steer", "queue", "none"],
				description:
					"How to notify this session if the action becomes asynchronous. Defaults to steer.",
			},
		},
		required: ["action"],
		additionalProperties: false,
	};
}

class ComputerJobScheduler {
	private readonly active = new Map<string, ActiveJob>();

	constructor(
		private readonly jobsDir: string,
		private readonly defaultDeadlineMs: number,
	) {
		this.ensureJobsDir();
		this.recoverInterruptedJobs();
		this.pruneOldJobs();
	}

	async submit(input: {
		kind: JobKind;
		action?: ComputerUseAction;
		sessionId?: string;
		notify: NotifyMode;
		deadlineMs?: number;
		run(signal: AbortSignal): Promise<JobCompletion>;
	}): Promise<unknown> {
		const running = this.runningJob();
		if (running) {
			throw new Error(
				`Computer use is busy with job ${running.jobId}. Poll or cancel that job before starting another action.`,
			);
		}

		const record: JobRecord = {
			version: 1,
			jobId: randomUUID(),
			kind: input.kind,
			status: "running",
			action: input.action,
			sessionId: input.sessionId,
			notify: input.notify,
			startedAt: new Date().toISOString(),
		};
		this.writeRecord(record);
		const controller = new AbortController();
		const operation = Promise.resolve().then(() =>
			input.run(controller.signal),
		);
		const promise = this.finish(record, operation, controller).finally(() => {
			this.active.delete(record.jobId);
		});
		const active: ActiveJob = { controller, promise, promoted: false };
		this.active.set(record.jobId, active);

		const deadlineMs = Math.min(
			Math.max(0, input.deadlineMs ?? this.defaultDeadlineMs),
			MAX_DEADLINE_MS,
		);
		const direct =
			deadlineMs === 0
				? undefined
				: await this.withDeadline(promise, deadlineMs);
		if (direct) return this.directResult(direct);

		active.promoted = true;
		// Force a terminal-state check as promotion and completion can race: if
		// the operation settled just as the deadline fired, finish() may have seen
		// promoted=false and removed the active entry before this line runs.
		this.maybeNotify(record.jobId, true);
		return {
			jobId: record.jobId,
			status: "running",
			kind: record.kind,
			action: record.action,
			startedAt: record.startedAt,
			note:
				`The operation exceeded the ${deadlineMs}ms direct-result deadline and is still running. ` +
				`Do not start another computer action. Call computer_poll with job_id=${record.jobId}, ` +
				`or wait for its completion notification.`,
		};
	}

	poll(jobId: string): unknown {
		const record = this.readRecord(jobId);
		if (record.status === "running") {
			return {
				...this.publicRecord(record),
				elapsedMs: Math.max(0, Date.now() - Date.parse(record.startedAt)),
			};
		}
		if (record.status !== "completed") return this.publicRecord(record);
		const completion: JobCompletion = {
			text: record.text ?? `Computer job ${record.jobId} completed.`,
			aborted: record.aborted,
			image: this.readImage(record),
		};
		return completionOutput(completion);
	}

	list(limit: number): unknown[] {
		return this.readAllRecords()
			.sort((left, right) => right.startedAt.localeCompare(left.startedAt))
			.slice(0, Math.min(Math.max(1, limit), 50))
			.map((record) => this.publicRecord(record));
	}

	cancel(jobId: string): unknown {
		const record = this.readRecord(jobId);
		if (record.status !== "running") return this.publicRecord(record);
		const active = this.active.get(jobId);
		if (!active) {
			const interrupted = this.updateRecord(record, {
				status: "cancelled",
				completedAt: new Date().toISOString(),
				error: "Job no longer has a live plugin worker; marked cancelled.",
			});
			return this.publicRecord(interrupted);
		}
		active.controller.abort(
			new Error("Computer job cancelled by computer_cancel"),
		);
		return {
			...this.publicRecord(record),
			status: "running",
			cancellationRequested: true,
			note: "Cancellation stops waiting and asks cooperative work to stop; input already delivered to the backend cannot be recalled.",
		};
	}

	private async finish(
		record: JobRecord,
		operation: Promise<JobCompletion>,
		controller: AbortController,
	): Promise<JobRecord> {
		let terminal: JobRecord;
		try {
			const completion = await operation;
			if (completion.image) this.writeImage(record.jobId, completion.image);
			terminal = this.updateRecord(record, {
				status: "completed",
				completedAt: new Date().toISOString(),
				text: completion.text,
				aborted: completion.aborted,
				imageMediaType: completion.image?.mediaType,
			});
		} catch (error) {
			terminal = this.updateRecord(record, {
				status: controller.signal.aborted ? "cancelled" : "failed",
				completedAt: new Date().toISOString(),
				error: errorMessage(error),
			});
		}
		this.maybeNotify(record.jobId);
		return terminal;
	}

	private async withDeadline(
		promise: Promise<JobRecord>,
		deadlineMs: number,
	): Promise<JobRecord | undefined> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const expired = Symbol("deadline");
		try {
			const result = await Promise.race([
				promise,
				new Promise<typeof expired>((resolve) => {
					timer = setTimeout(() => resolve(expired), deadlineMs);
				}),
			]);
			return result === expired ? undefined : result;
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	private directResult(record: JobRecord): unknown {
		if (record.status !== "completed") {
			throw new Error(
				record.error ?? `Computer job ${record.jobId} ${record.status}`,
			);
		}
		return completionOutput({
			text: record.text ?? `Computer job ${record.jobId} completed.`,
			aborted: record.aborted,
			image: this.readImage(record),
		});
	}

	private maybeNotify(jobId: string, force = false): void {
		const active = this.active.get(jobId);
		if (!force && !active?.promoted) return;
		const record = this.readRecord(jobId);
		if (
			record.status === "running" ||
			record.notify === "none" ||
			record.notifiedAt
		) {
			return;
		}
		const emitEvent = globalThis.__clinePluginHost?.emitEvent;
		if (!emitEvent) return;
		const notified = this.updateRecord(record, {
			notifiedAt: new Date().toISOString(),
		});
		const eventName =
			notified.notify === "queue" ? "queue_message" : "steer_message";
		emitEvent(eventName, {
			sessionId: notified.sessionId,
			prompt:
				`Computer job ${notified.jobId} ${notified.status}. ` +
				`Call computer_poll with {"job_id":"${notified.jobId}"} to retrieve ` +
				`${notified.imageMediaType ? "the result and current screenshot" : "the result"}.`,
		});
	}

	private runningJob(): JobRecord | undefined {
		for (const jobId of this.active.keys()) {
			const record = this.readRecord(jobId);
			if (record.status === "running") return record;
		}
		return undefined;
	}

	private publicRecord(record: JobRecord): Record<string, unknown> {
		return {
			jobId: record.jobId,
			kind: record.kind,
			status: record.status,
			action: record.action,
			startedAt: record.startedAt,
			completedAt: record.completedAt,
			text: record.text,
			error: record.error,
			aborted: record.aborted,
			hasImage: Boolean(record.imageMediaType),
		};
	}

	private recordPath(jobId: string): string {
		if (!JOB_ID_PATTERN.test(jobId))
			throw new Error(`Invalid computer job ID: ${jobId}`);
		return join(this.jobsDir, `${jobId}.json`);
	}

	private imagePath(jobId: string): string {
		if (!JOB_ID_PATTERN.test(jobId))
			throw new Error(`Invalid computer job ID: ${jobId}`);
		return join(this.jobsDir, `${jobId}.image`);
	}

	private writeRecord(record: JobRecord): void {
		this.ensureJobsDir();
		const destination = this.recordPath(record.jobId);
		const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(temporary, destination);
	}

	private updateRecord(
		record: JobRecord,
		patch: Partial<JobRecord>,
	): JobRecord {
		const updated = { ...record, ...patch };
		this.writeRecord(updated);
		return updated;
	}

	private readRecord(jobId: string): JobRecord {
		const path = this.recordPath(jobId);
		if (!existsSync(path)) throw new Error(`Unknown computer job: ${jobId}`);
		const parsed = JSON.parse(readFileSync(path, "utf8")) as JobRecord;
		if (parsed.version !== 1 || parsed.jobId !== jobId) {
			throw new Error(`Invalid computer job record: ${jobId}`);
		}
		return parsed;
	}

	private readAllRecords(): JobRecord[] {
		if (!existsSync(this.jobsDir)) return [];
		const records: JobRecord[] = [];
		for (const name of readdirSync(this.jobsDir)) {
			if (!name.endsWith(".json")) continue;
			try {
				records.push(this.readRecord(name.slice(0, -5)));
			} catch {}
		}
		return records;
	}

	private writeImage(jobId: string, image: ComputerUseImage): void {
		writeFileSync(this.imagePath(jobId), Buffer.from(image.data, "base64"), {
			mode: 0o600,
		});
	}

	private readImage(record: JobRecord): ComputerUseImage | undefined {
		if (!record.imageMediaType) return undefined;
		const path = this.imagePath(record.jobId);
		if (!existsSync(path)) return undefined;
		return {
			data: readFileSync(path).toString("base64"),
			mediaType: record.imageMediaType,
		};
	}

	private recoverInterruptedJobs(): void {
		for (const record of this.readAllRecords()) {
			if (record.status !== "running") continue;
			this.updateRecord(record, {
				status: "failed",
				completedAt: new Date().toISOString(),
				error:
					"Plugin worker restarted before the backend result was captured.",
			});
		}
	}

	private pruneOldJobs(): void {
		const keep = new Set(
			this.readAllRecords()
				.sort((left, right) => right.startedAt.localeCompare(left.startedAt))
				.slice(0, 100)
				.map((record) => record.jobId),
		);
		for (const record of this.readAllRecords()) {
			if (keep.has(record.jobId) || record.status === "running") continue;
			rmSync(this.recordPath(record.jobId), { force: true });
			rmSync(this.imagePath(record.jobId), { force: true });
		}
	}

	private ensureJobsDir(): void {
		mkdirSync(this.jobsDir, { recursive: true, mode: 0o700 });
		try {
			chmodSync(this.jobsDir, 0o700);
		} catch {
			// Best effort on filesystems that do not support POSIX permissions.
		}
	}
}

function resolveSessionId(
	context: AgentToolContext,
	setupSessionId: string | undefined,
): string | undefined {
	return context.sessionId?.trim() || setupSessionId;
}

function requireJobId(input: unknown): string {
	const value =
		input && typeof input === "object"
			? (input as Record<string, unknown>).job_id
			: undefined;
	if (typeof value !== "string" || !JOB_ID_PATTERN.test(value)) {
		throw new Error("job_id must be a valid computer job ID");
	}
	return value;
}

export function createComputerUsePlugin(
	options: ComputerUsePluginOptions = {},
): AgentPlugin {
	return {
		name: "computer-use",
		manifest: { capabilities: ["tools", "messageBuilders"] },
		async setup(api, ctx) {
			const env = options.env ?? process.env;
			const port = requirePort(env);
			const requestTimeoutMs =
				options.requestTimeoutMs ??
				parseNonNegativeInt(
					env[REQUEST_TIMEOUT_ENV],
					DEFAULT_REQUEST_TIMEOUT_MS,
				);
			const defaultDeadlineMs =
				options.deadlineMs ??
				parseNonNegativeInt(
					env[DEADLINE_ENV],
					DEFAULT_DEADLINE_MS,
					MAX_DEADLINE_MS,
				);
			const client =
				options.client ??
				new ComputerUseClient({
					host: env[HOST_ENV]?.trim() || undefined,
					port,
					requestTimeoutMs,
				});
			const display = options.displayInfo ?? (await client.getDisplayInfo());
			const setupSessionId = ctx.session?.sessionId?.trim() || undefined;
			const jobsDir =
				options.jobsDir ??
				join(
					resolveClineDataDir(),
					"plugins",
					"computer-use",
					"jobs",
					safeSessionDirectory(setupSessionId),
				);
			const scheduler = new ComputerJobScheduler(jobsDir, defaultDeadlineMs);
			const backendCommand = env[BACKEND_COMMAND_ENV]?.trim();
			const backendRestart = backendCommand
				? new ComputerBackendRestart({
						client,
						host: env[HOST_ENV]?.trim() || undefined,
						port,
						command: backendCommand,
					})
				: undefined;

			api.registerTool(
				createTool<unknown, unknown>({
					name: "computer",
					description:
						`Control the screen and keyboard/mouse of a ${display.widthPx}x${display.heightPx} computer. ` +
						"Fast actions return their text and screenshot directly. Slower actions return a job handle; " +
						"do not start another computer action until that job completes, and use computer_poll to retrieve its screenshot. " +
						"Every click, type, key, scroll, and drag returns the resulting screen. Prefer run_sequence for related steps. " +
						"Use expect_unchanged for targets that might move or disappear.",
					inputSchema: computerInputSchema(),
					timeoutMs: MAX_DEADLINE_MS + 5_000,
					retryable: false,
					async execute(rawInput, context) {
						const input = parseComputerToolInput(rawInput);
						const request = toComputerUseRequest(input);
						return await scheduler.submit({
							kind: "computer",
							action: input.action,
							sessionId: resolveSessionId(context, setupSessionId),
							notify: input.notify ?? "steer",
							deadlineMs: input.deadline_ms,
							run: async (signal) =>
								responseToCompletion(
									input.action,
									await client.send(request, {
										signal,
										timeoutMs: requestTimeoutMs,
									}),
								),
						});
					},
				}),
			);

			api.registerTool(
				createTool<unknown, unknown>({
					name: "computer_poll",
					description:
						"Poll a computer job. Completed jobs return their result and current screenshot. Poll only after computer returns a job handle or a completion notification names the job.",
					inputSchema: {
						type: "object",
						properties: { job_id: { type: "string" } },
						required: ["job_id"],
						additionalProperties: false,
					},
					timeoutMs: 5_000,
					retryable: false,
					execute: async (input) => scheduler.poll(requireJobId(input)),
				}),
			);

			api.registerTool(
				createTool<unknown, unknown>({
					name: "computer_list_jobs",
					description: "List recent computer jobs and their statuses.",
					inputSchema: {
						type: "object",
						properties: {
							limit: { type: "integer", minimum: 1, maximum: 50 },
						},
						additionalProperties: false,
					},
					timeoutMs: 5_000,
					retryable: false,
					execute: async (input) => {
						const limit =
							input &&
							typeof input === "object" &&
							typeof (input as Record<string, unknown>).limit === "number"
								? ((input as Record<string, unknown>).limit as number)
								: 20;
						return scheduler.list(limit);
					},
				}),
			);

			api.registerTool(
				createTool<unknown, unknown>({
					name: "computer_cancel",
					description:
						"Cancel a running computer job. This stops waiting, but cannot recall input already delivered to the backend.",
					inputSchema: {
						type: "object",
						properties: { job_id: { type: "string" } },
						required: ["job_id"],
						additionalProperties: false,
					},
					timeoutMs: 5_000,
					retryable: false,
					execute: async (input) => scheduler.cancel(requireJobId(input)),
				}),
			);

			if (backendRestart) {
				api.registerTool(
					createTool<unknown, unknown>({
						name: "computer_restart_backend",
						description:
							"Probe the computer-use backend and launch the configured backend command only when it is unreachable. It may return an asynchronous job handle.",
						inputSchema: {
							type: "object",
							properties: {
								deadline_ms: {
									type: "integer",
									minimum: 0,
									maximum: MAX_DEADLINE_MS,
								},
								notify: {
									type: "string",
									enum: ["steer", "queue", "none"],
								},
							},
							additionalProperties: false,
						},
						timeoutMs: MAX_DEADLINE_MS + 5_000,
						retryable: false,
						async execute(input, context) {
							const args =
								input && typeof input === "object"
									? (input as Record<string, unknown>)
									: {};
							return await scheduler.submit({
								kind: "backend_restart",
								sessionId: resolveSessionId(context, setupSessionId),
								notify:
									args.notify === "queue" || args.notify === "none"
										? args.notify
										: "steer",
								deadlineMs:
									typeof args.deadline_ms === "number"
										? args.deadline_ms
										: undefined,
								run: async (signal) => {
									const result = await backendRestart.ensureRunning(signal);
									if (result.status === "failed_to_start") {
										throw new Error(result.error);
									}
									return { text: `Computer-use backend: ${result.status}.` };
								},
							});
						},
					}),
				);
			}

			api.registerMessageBuilder({
				name: "computer-use-current-screen",
				build(messages: Message[]) {
					return projectComputerScreenshots(messages);
				},
			});
			ctx.logger?.log("computer-use plugin ready", {
				backend: `${env[HOST_ENV]?.trim() || "127.0.0.1"}:${port}`,
				deadlineMs: defaultDeadlineMs,
				display: `${display.widthPx}x${display.heightPx}`,
				jobsDir,
				sessionId: setupSessionId,
			});
		},
	};
}

export const plugin = createComputerUsePlugin();
export default plugin;
