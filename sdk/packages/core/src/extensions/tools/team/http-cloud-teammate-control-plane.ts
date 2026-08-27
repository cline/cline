import { randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import type { AgentResult, ToolCallRecord } from "@cline/shared";
import { AgentResultSchema } from "@cline/shared";
import { z } from "zod";
import type {
	CloudTeammateControlPlane,
	CloudTeammateProvisionInput,
	CloudTeammateProvisionResult,
	CloudTeammateRunInput,
} from "./cloud-teammate";

const CONTRACT_VERSION = 1;
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

const IsoDateSchema = z.string().datetime({ offset: true });
const TeamSchema = z
	.object({
		id: z.string().startsWith("ctm-"),
		clientTeamId: z.string().min(1),
		name: z.string().min(1),
		contractVersion: z.literal(CONTRACT_VERSION),
		status: z.enum(["active", "terminating", "terminated"]),
		createdAt: IsoDateSchema,
		updatedAt: IsoDateSchema,
	})
	.passthrough();
const CapsuleSchema = z
	.object({
		id: z.string().startsWith("wcp-"),
		teamId: z.string().startsWith("ctm-"),
		manifestVersion: z.literal(CONTRACT_VERSION),
		manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
		archiveSha256: z.string().regex(/^[a-f0-9]{64}$/),
		archiveFormat: z.literal("tar+gzip"),
		archiveMediaType: z.literal(
			"application/vnd.cline.workspace-capsule.v1+tar+gzip",
		),
		archiveSizeBytes: z.number().int().nonnegative(),
		unpackedSizeBytes: z.number().int().nonnegative(),
		createdAt: IsoDateSchema,
	})
	.passthrough();
const NodeSchema = z
	.object({
		id: z.string().startsWith("cnd-"),
		teamId: z.string().startsWith("ctm-"),
		initialCapsuleId: z.string().startsWith("wcp-"),
		name: z.string().min(1),
		rolePrompt: z.string().min(1),
		kind: z.literal("cloud"),
		status: z.enum([
			"provisioning",
			"online",
			"busy",
			"offline",
			"terminating",
			"terminated",
		]),
		createdAt: IsoDateSchema,
		updatedAt: IsoDateSchema,
	})
	.passthrough();
const RunSchema = z
	.object({
		id: z.string().startsWith("crn-"),
		teamId: z.string().startsWith("ctm-"),
		taskId: z.string().min(1),
		nodeId: z.string().startsWith("cnd-"),
		clientRunId: z.string().optional(),
		status: z.enum([
			"queued",
			"running",
			"waiting_for_parent",
			"cancelling",
			"completed",
			"failed",
			"cancelled",
		]),
		prompt: z.string(),
		statusReason: z.string().optional(),
		startedAt: IsoDateSchema.optional(),
		completedAt: IsoDateSchema.optional(),
		createdAt: IsoDateSchema,
		updatedAt: IsoDateSchema,
	})
	.passthrough();
const OutcomeSchema = z
	.object({
		id: z.string().min(1),
		teamId: z.string().startsWith("ctm-"),
		taskId: z.string().min(1),
		runId: z.string().startsWith("crn-"),
		status: z.string().min(1),
		summary: z.string().optional(),
		payload: z.record(z.string(), z.unknown()).optional(),
		createdAt: IsoDateSchema,
		updatedAt: IsoDateSchema,
	})
	.passthrough();
const RunViewSchema = z
	.object({
		run: RunSchema,
		outcome: OutcomeSchema.optional(),
	})
	.passthrough();

type CoreTeam = z.infer<typeof TeamSchema>;
type CoreRun = z.infer<typeof RunSchema>;
type CoreOutcome = z.infer<typeof OutcomeSchema>;

export interface HttpCloudTeammateControlPlaneOptions {
	baseUrl: string;
	fetch?: typeof fetch;
	headers?:
		| ConstructorParameters<typeof Headers>[0]
		| (() =>
				| ConstructorParameters<typeof Headers>[0]
				| Promise<ConstructorParameters<typeof Headers>[0]>);
	organizationId?: string;
	pollIntervalMs?: number;
	/** Per-attempt HTTP deadline, composed with any caller AbortSignal. */
	requestTimeoutMs?: number;
	/** Maximum time a synchronous client waits for a durable run. */
	runPollTimeoutMs?: number;
	/** Maximum time to wait for a newly-created node to become online. */
	provisioningTimeoutMs?: number;
	/** Polling cadence while a node remains in provisioning. */
	provisioningPollIntervalMs?: number;
	maxRequestAttempts?: number;
	compatibility?: {
		os?: string;
		architecture?: string;
		runtimeVersion?: string;
	};
	sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

function normalizeBaseUrl(value: string): URL {
	const parsed = new URL(value);
	if (
		!(["http:", "https:"] as string[]).includes(parsed.protocol) ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash
	) {
		throw new Error(
			"Core baseUrl must be an HTTP(S) URL without credentials, query, or fragment",
		);
	}
	if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
	return parsed;
}

export function defaultSleep(
	milliseconds: number,
	signal?: AbortSignal,
): Promise<void> {
	if (signal?.aborted) {
		return Promise.reject(
			signal.reason ?? new DOMException("Aborted", "AbortError"),
		);
	}
	return new Promise((resolve, reject) => {
		const finish = () => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		};
		const timer = setTimeout(finish, milliseconds);
		const onAbort = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function isRetryableStatus(status: number): boolean {
	return status === 408 || status === 429 || status >= 500;
}

class CloudControlPlaneHttpError extends Error {
	constructor(
		operation: string,
		readonly status: number,
		readonly retryAfterMs?: number,
	) {
		super(`${operation} failed with HTTP ${status}`);
		this.name = "CloudControlPlaneHttpError";
	}
}

class CloudControlPlaneTransportError extends Error {
	constructor(operation: string) {
		super(`${operation} request failed`);
		this.name = "CloudControlPlaneTransportError";
	}
}

function retryAfterMilliseconds(response: Response): number | undefined {
	const value = response.headers.get("retry-after")?.trim();
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const date = Date.parse(value);
	return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function asFiniteNonnegative(value: unknown, fallback = 0): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: fallback;
}

function outcomeDate(value: unknown, fallback: string): Date {
	if (typeof value === "string") {
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) return parsed;
	}
	return new Date(fallback);
}

function normalizeToolCalls(
	value: unknown,
	startedAt: Date,
	endedAt: Date,
): ToolCallRecord[] {
	if (!Array.isArray(value)) return [];
	return value.map((item, index) => {
		const record =
			item && typeof item === "object" ? (item as Record<string, unknown>) : {};
		const callStartedAt = outcomeDate(
			record.startedAt,
			startedAt.toISOString(),
		);
		const callEndedAt = outcomeDate(record.endedAt, endedAt.toISOString());
		return {
			id:
				typeof record.id === "string" && record.id.trim()
					? record.id
					: `cloud-tool-${index + 1}`,
			name:
				typeof record.name === "string" && record.name.trim()
					? record.name
					: "unknown_tool",
			...(record.execution === "client" || record.execution === "provider"
				? { execution: record.execution }
				: {}),
			input: Object.hasOwn(record, "input") ? record.input : null,
			output: Object.hasOwn(record, "output") ? record.output : null,
			...(typeof record.error === "string" ? { error: record.error } : {}),
			durationMs: asFiniteNonnegative(
				record.durationMs,
				Math.max(0, callEndedAt.getTime() - callStartedAt.getTime()),
			),
			startedAt: callStartedAt,
			endedAt: callEndedAt,
		};
	});
}

function mapOutcomeToAgentResult(
	run: CoreRun,
	outcome: CoreOutcome,
): AgentResult {
	const payload = outcome.payload ?? {};
	const startedAt = outcomeDate(
		payload.startedAt,
		run.startedAt ?? run.createdAt,
	);
	const endedAt = outcomeDate(
		payload.endedAt,
		run.completedAt ?? outcome.updatedAt,
	);
	const rawUsage =
		payload.usage && typeof payload.usage === "object"
			? (payload.usage as Record<string, unknown>)
			: {};
	const rawModel =
		payload.model && typeof payload.model === "object"
			? (payload.model as Record<string, unknown>)
			: {};
	const finishReason = [
		"completed",
		"max_iterations",
		"aborted",
		"mistake_limit",
		"error",
	].includes(String(payload.finishReason))
		? payload.finishReason
		: "completed";
	const mapped = AgentResultSchema.safeParse({
		text:
			typeof payload.text === "string"
				? payload.text
				: (outcome.summary ?? "Cloud teammate completed"),
		usage: {
			inputTokens: asFiniteNonnegative(rawUsage.inputTokens),
			outputTokens: asFiniteNonnegative(rawUsage.outputTokens),
			cacheReadTokens: asFiniteNonnegative(rawUsage.cacheReadTokens),
			cacheWriteTokens: asFiniteNonnegative(rawUsage.cacheWriteTokens),
			totalCost: asFiniteNonnegative(rawUsage.totalCost),
		},
		messages: Array.isArray(payload.messages) ? payload.messages : [],
		toolCalls: normalizeToolCalls(payload.toolCalls, startedAt, endedAt),
		iterations: Math.max(
			0,
			Math.floor(asFiniteNonnegative(payload.iterations, 1)),
		),
		finishReason,
		model: {
			id: typeof rawModel.id === "string" ? rawModel.id : "core-cloud",
			provider:
				typeof rawModel.provider === "string" ? rawModel.provider : "cline",
		},
		startedAt,
		endedAt,
		durationMs: asFiniteNonnegative(
			payload.durationMs,
			Math.max(0, endedAt.getTime() - startedAt.getTime()),
		),
	});
	if (!mapped.success) {
		throw new Error("Cloud outcome returned an invalid AgentResult");
	}
	return mapped.data;
}

export class HttpCloudTeammateControlPlane
	implements CloudTeammateControlPlane
{
	private readonly baseUrl: URL;
	private readonly fetchImplementation: typeof fetch;
	private readonly pollIntervalMs: number;
	private readonly requestTimeoutMs: number;
	private readonly runPollTimeoutMs: number;
	private readonly provisioningTimeoutMs: number;
	private readonly provisioningPollIntervalMs: number;
	private readonly maxRequestAttempts: number;
	private readonly sleep: (
		milliseconds: number,
		signal?: AbortSignal,
	) => Promise<void>;
	private readonly teams = new Map<string, Promise<CoreTeam>>();
	private readonly cleanedTeams = new Set<string>();

	constructor(private readonly options: HttpCloudTeammateControlPlaneOptions) {
		this.baseUrl = normalizeBaseUrl(options.baseUrl);
		this.fetchImplementation = options.fetch ?? globalThis.fetch;
		this.pollIntervalMs = Math.max(10, options.pollIntervalMs ?? 1000);
		this.requestTimeoutMs = Math.max(
			100,
			Math.floor(options.requestTimeoutMs ?? 30_000),
		);
		this.runPollTimeoutMs = Math.max(
			100,
			Math.floor(options.runPollTimeoutMs ?? 60 * 60 * 1000),
		);
		this.provisioningTimeoutMs = Math.max(
			100,
			Math.floor(options.provisioningTimeoutMs ?? 5 * 60 * 1000),
		);
		this.provisioningPollIntervalMs = Math.max(
			10,
			Math.floor(options.provisioningPollIntervalMs ?? this.pollIntervalMs),
		);
		this.maxRequestAttempts = Math.max(
			1,
			Math.floor(options.maxRequestAttempts ?? 3),
		);
		this.sleep = options.sleep ?? defaultSleep;
	}

	async provisionTeammate(
		input: CloudTeammateProvisionInput,
	): Promise<CloudTeammateProvisionResult> {
		this.cleanedTeams.delete(input.teamId);
		const team = await this.ensureTeam(
			input.teamId,
			input.teamName,
			input.signal,
		);
		const capsule = await this.uploadCapsule(team.id, input);
		// Core provides semantic idempotency for (team, node name) when this
		// exact body is retried after an ambiguous transport failure.
		const node = await this.requestJson(
			"create cloud node",
			`teams/${encodeURIComponent(team.id)}/nodes`,
			NodeSchema,
			{
				method: "POST",
				signal: input.signal,
				body: JSON.stringify({
					contractVersion: CONTRACT_VERSION,
					name: input.agentId,
					rolePrompt: input.rolePrompt,
					compatibility: {
						kind: "cloud",
						...this.options.compatibility,
					},
					initialCapsuleId: capsule.id,
				}),
			},
		);
		try {
			if (node.teamId !== team.id || node.initialCapsuleId !== capsule.id) {
				throw new Error("create cloud node returned mismatched identity");
			}
			const readyNode = await this.waitForNodeOnline(
				team.id,
				node,
				input.signal,
			);
			return { nodeId: readyNode.id };
		} catch (error) {
			// Node creation succeeded, so readiness failure must compensate even
			// when the caller's AbortSignal is already aborted.
			await this.requestNoContent(
				"delete cloud node after failed provisioning",
				`teams/${encodeURIComponent(team.id)}/nodes/${encodeURIComponent(node.id)}`,
			).catch(() => undefined);
			throw error;
		}
	}

	async reattachTeammate(input: {
		teamId: string;
		teamName: string;
		nodeId: string;
		agentId: string;
	}): Promise<CloudTeammateProvisionResult> {
		const team = await this.ensureTeam(input.teamId, input.teamName);
		const node = await this.requestJson(
			"get cloud node",
			`teams/${encodeURIComponent(team.id)}/nodes/${encodeURIComponent(input.nodeId)}`,
			NodeSchema,
			{ method: "GET" },
		);
		if (
			node.id !== input.nodeId ||
			node.teamId !== team.id ||
			node.name !== input.agentId
		) {
			throw new Error("get cloud node returned mismatched identity");
		}
		if (node.status !== "online" && node.status !== "busy") {
			throw new Error(
				`Cannot reattach cloud node ${input.nodeId} with status ${node.status}`,
			);
		}
		return { nodeId: node.id };
	}

	async runTeammateTask(input: CloudTeammateRunInput): Promise<AgentResult> {
		const team = await this.ensureTeam(
			input.teamId,
			input.teamName,
			input.signal,
		);
		const clientRunId = input.runId ?? `cline-${randomUUID()}`;
		const run = await this.requestJson(
			"create cloud run",
			`teams/${encodeURIComponent(team.id)}/nodes/${encodeURIComponent(input.nodeId)}/runs`,
			RunSchema,
			{
				method: "POST",
				body: JSON.stringify({
					contractVersion: CONTRACT_VERSION,
					message: input.message,
					runId: clientRunId,
					...(input.taskId ? { taskId: input.taskId } : {}),
					...(input.fromAgentId ? { fromAgentId: input.fromAgentId } : {}),
					...(input.continueConversation ? { continueConversation: true } : {}),
				}),
				signal: input.signal,
			},
		);
		if (run.teamId !== team.id || run.nodeId !== input.nodeId) {
			throw new Error("create cloud run returned mismatched identity");
		}
		if (run.clientRunId !== clientRunId) {
			throw new Error("create cloud run returned mismatched client run id");
		}
		return await this.pollRun(team.id, run.id, input.signal);
	}

	async destroyTeammate(input: {
		teamId: string;
		teamName: string;
		nodeId: string;
		agentId: string;
		reason?: string;
	}): Promise<void> {
		if (
			input.reason === "team_cleanup" &&
			this.cleanedTeams.has(input.teamId)
		) {
			return;
		}
		const team = await this.ensureTeam(input.teamId, input.teamName);
		if (input.reason === "team_cleanup") {
			await this.requestNoContent(
				"delete cloud team",
				`teams/${encodeURIComponent(team.id)}`,
			);
			this.teams.delete(input.teamId);
			this.cleanedTeams.add(input.teamId);
			return;
		}
		await this.requestNoContent(
			"delete cloud node",
			`teams/${encodeURIComponent(team.id)}/nodes/${encodeURIComponent(input.nodeId)}`,
		);
	}

	private async ensureTeam(
		clientTeamId: string,
		name: string,
		signal?: AbortSignal,
	): Promise<CoreTeam> {
		const cached = this.teams.get(clientTeamId);
		if (cached) {
			const team = await cached;
			if (team.status !== "active") {
				throw new Error(`Cloud team ${team.id} is ${team.status}`);
			}
			return team;
		}
		const pending = this.requestJson("create cloud team", "teams", TeamSchema, {
			method: "POST",
			body: JSON.stringify({
				contractVersion: CONTRACT_VERSION,
				clientTeamId,
				name,
				...(this.options.organizationId
					? { organizationId: this.options.organizationId }
					: {}),
			}),
			signal,
		}).then((team) => {
			if (team.clientTeamId !== clientTeamId) {
				throw new Error("create cloud team returned mismatched client team id");
			}
			if (team.status !== "active") {
				throw new Error(`Cloud team ${team.id} is ${team.status}`);
			}
			return team;
		});
		this.teams.set(clientTeamId, pending);
		try {
			return await pending;
		} catch (error) {
			this.teams.delete(clientTeamId);
			throw error;
		}
	}

	private async uploadCapsule(
		teamId: string,
		input: CloudTeammateProvisionInput,
	): Promise<z.infer<typeof CapsuleSchema>> {
		const archive = input.initialCapsule.metadata;
		const metadata = {
			contractVersion: CONTRACT_VERSION,
			teamId,
			manifest: input.initialCapsule.manifest,
			archive: {
				format: archive.format,
				mediaType: archive.mediaType,
				sha256: archive.sha256,
				manifestSha256: archive.manifestSha256,
				archiveSizeBytes: archive.archiveSizeBytes,
				unpackedSizeBytes: archive.unpackedSizeBytes,
			},
		};
		const form = new FormData();
		form.append(
			"metadata",
			new Blob([JSON.stringify(metadata)], { type: "application/json" }),
			"metadata.json",
		);
		form.append(
			"archive",
			await openAsBlob(input.initialCapsule.archivePath, {
				type: archive.mediaType,
			}),
			"workspace-capsule.tar.gz",
		);
		// Core deduplicates capsule ingest by (team, manifestSha256), validating
		// that an ambiguous retry carries the same archive hash.
		const capsule = await this.requestJson(
			"upload workspace capsule",
			`teams/${encodeURIComponent(teamId)}/capsules`,
			CapsuleSchema,
			{ method: "POST", body: form, signal: input.signal },
		);
		if (
			capsule.teamId !== teamId ||
			capsule.manifestSha256 !== archive.manifestSha256 ||
			capsule.archiveSha256 !== archive.sha256
		) {
			throw new Error("upload workspace capsule returned mismatched identity");
		}
		return capsule;
	}

	private async pollRun(
		teamId: string,
		runId: string,
		signal?: AbortSignal,
	): Promise<AgentResult> {
		const deadline = Date.now() + this.runPollTimeoutMs;
		while (true) {
			if (Date.now() >= deadline) {
				throw new Error(`Timed out waiting for durable cloud run ${runId}`);
			}
			const view = await this.requestJson(
				"get cloud run",
				`teams/${encodeURIComponent(teamId)}/runs/${encodeURIComponent(runId)}`,
				RunViewSchema,
				{ method: "GET", signal },
			);
			if (view.run.status === "waiting_for_parent") {
				throw new Error(
					`Cloud run ${runId} is waiting for parent input and remains durable`,
				);
			}
			if (!TERMINAL_RUN_STATUSES.has(view.run.status)) {
				await this.sleep(this.pollIntervalMs, signal);
				continue;
			}
			if (view.run.status === "completed" && !view.outcome) {
				await this.sleep(this.pollIntervalMs, signal);
				continue;
			}
			if (view.run.status !== "completed" || !view.outcome) {
				throw new Error(
					`Cloud run ${runId} ended with status ${view.run.status}`,
				);
			}
			if (
				view.run.id !== runId ||
				view.run.teamId !== teamId ||
				view.outcome.runId !== runId ||
				view.outcome.teamId !== teamId
			) {
				throw new Error("get cloud run returned mismatched identity");
			}
			return mapOutcomeToAgentResult(view.run, view.outcome);
		}
	}

	private async waitForNodeOnline(
		teamId: string,
		initialNode: z.infer<typeof NodeSchema>,
		signal?: AbortSignal,
	): Promise<z.infer<typeof NodeSchema>> {
		let node = initialNode;
		const deadline = Date.now() + this.provisioningTimeoutMs;
		while (node.status !== "online") {
			if (node.status !== "provisioning") {
				throw new Error(
					`Cloud node ${node.id} became unavailable with status ${node.status}`,
				);
			}
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				throw new Error(
					`Cloud node ${node.id} did not become online before the provisioning timeout`,
				);
			}
			await this.sleep(
				Math.min(this.provisioningPollIntervalMs, remaining),
				signal,
			);
			if (Date.now() >= deadline) {
				throw new Error(
					`Cloud node ${node.id} did not become online before the provisioning timeout`,
				);
			}
			try {
				const requestTimeout = AbortSignal.timeout(
					Math.max(1, deadline - Date.now()),
				);
				const requestSignal = signal
					? AbortSignal.any([signal, requestTimeout])
					: requestTimeout;
				node = await this.requestJson(
					"get cloud node readiness",
					`teams/${encodeURIComponent(teamId)}/nodes/${encodeURIComponent(node.id)}`,
					NodeSchema,
					{ method: "GET", signal: requestSignal },
					{ maxAttempts: 1 },
				);
			} catch (error) {
				if (
					error instanceof CloudControlPlaneTransportError ||
					(error instanceof CloudControlPlaneHttpError &&
						isRetryableStatus(error.status))
				) {
					const retryDelay = Math.min(
						error instanceof CloudControlPlaneHttpError
							? (error.retryAfterMs ?? this.provisioningPollIntervalMs)
							: this.provisioningPollIntervalMs,
						Math.max(0, deadline - Date.now()),
					);
					if (retryDelay > 0) await this.sleep(retryDelay, signal);
					continue;
				}
				throw error;
			}
			if (node.id !== initialNode.id || node.teamId !== teamId) {
				throw new Error(
					"get cloud node readiness returned mismatched identity",
				);
			}
		}
		return node;
	}

	private async requestJson<T extends z.ZodTypeAny>(
		operation: string,
		path: string,
		schema: T,
		init: RequestInit,
		requestOptions?: { maxAttempts?: number },
	): Promise<z.infer<T>> {
		const response = await this.request(
			operation,
			path,
			init,
			false,
			requestOptions,
		);
		let parsed: unknown;
		try {
			parsed = await response.json();
		} catch {
			throw new Error(`${operation} returned invalid JSON`);
		}
		const envelope = z
			.object({ success: z.literal(true), data: schema })
			.passthrough()
			.safeParse(parsed);
		if (!envelope.success) {
			throw new Error(`${operation} returned an invalid response`);
		}
		return envelope.data.data as z.infer<T>;
	}

	private async requestNoContent(
		operation: string,
		path: string,
	): Promise<void> {
		const response = await this.request(
			operation,
			path,
			{ method: "DELETE" },
			true,
		);
		await response.body?.cancel().catch(() => undefined);
	}

	private async request(
		operation: string,
		path: string,
		init: RequestInit,
		allowNotFound = false,
		requestOptions?: { maxAttempts?: number },
	): Promise<Response> {
		const target = new URL(
			path,
			new URL("api/v2/cloud-agent-clusters/", this.baseUrl),
		);
		const maxAttempts = Math.max(
			1,
			Math.floor(requestOptions?.maxAttempts ?? this.maxRequestAttempts),
		);
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			let response: Response;
			const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
			const requestSignal = init.signal
				? AbortSignal.any([init.signal, timeoutSignal])
				: timeoutSignal;
			try {
				response = await this.fetchImplementation(target, {
					...init,
					signal: requestSignal,
					headers: await this.buildHeaders(init.headers, init.body),
					redirect: "error",
				});
			} catch (error) {
				if (init.signal?.aborted) throw init.signal.reason ?? error;
				if (attempt === maxAttempts) {
					throw new CloudControlPlaneTransportError(operation);
				}
				await this.sleep(
					Math.min(1000, 100 * 2 ** (attempt - 1)),
					init.signal ?? undefined,
				);
				continue;
			}
			if (response.ok || (allowNotFound && response.status === 404)) {
				return response;
			}
			const retryAfterMs = retryAfterMilliseconds(response);
			await response.body?.cancel().catch(() => undefined);
			if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
				throw new CloudControlPlaneHttpError(
					operation,
					response.status,
					retryAfterMs,
				);
			}
			await this.sleep(
				Math.min(
					30_000,
					retryAfterMs ?? Math.min(1000, 100 * 2 ** (attempt - 1)),
				),
				init.signal ?? undefined,
			);
		}
		throw new Error(`${operation} request failed`);
	}

	private async buildHeaders(
		requestHeaders: ConstructorParameters<typeof Headers>[0] | undefined,
		body: RequestInit["body"],
	): Promise<Headers> {
		const configured =
			typeof this.options.headers === "function"
				? await this.options.headers()
				: this.options.headers;
		const headers = new Headers(configured);
		new Headers(requestHeaders).forEach((value, name) => {
			headers.set(name, value);
		});
		if (body instanceof FormData) {
			headers.delete("content-type");
		} else if (typeof body === "string" && !headers.has("content-type")) {
			headers.set("content-type", "application/json");
		}
		headers.set("accept", "application/json");
		return headers;
	}
}

export function createHttpCloudTeammateControlPlane(
	options: HttpCloudTeammateControlPlaneOptions,
): CloudTeammateControlPlane {
	return new HttpCloudTeammateControlPlane(options);
}
