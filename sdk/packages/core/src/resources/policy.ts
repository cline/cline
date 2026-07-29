import { availableParallelism, totalmem } from "node:os";
import { getHeapStatistics } from "node:v8";
import type {
	ResourcePolicyOverrides,
	ResourcePolicyProfile,
} from "@cline/shared";

export const RESOURCE_POLICY_ENV = {
	maxParallelism: "CLINE_RESOURCE_MAX_PARALLELISM",
	processMemoryLimitBytes: "CLINE_RESOURCE_PROCESS_MEMORY_LIMIT_BYTES",
	heapMemoryLimitBytes: "CLINE_RESOURCE_HEAP_MEMORY_LIMIT_BYTES",
	diagnosticsEnabled: "CLINE_RESOURCE_DIAGNOSTICS_ENABLED",
	diagnosticsSampleIntervalMs: "CLINE_RESOURCE_DIAGNOSTICS_INTERVAL_MS",
	eventLoopResolutionMs: "CLINE_RESOURCE_EVENT_LOOP_RESOLUTION_MS",
	pendingPromptMaxItems: "CLINE_RESOURCE_PENDING_PROMPT_MAX_ITEMS",
	pendingPromptMaxBytes: "CLINE_RESOURCE_PENDING_PROMPT_MAX_BYTES",
	pendingPromptMaxItemBytes: "CLINE_RESOURCE_PENDING_PROMPT_MAX_ITEM_BYTES",
	teamRunMaxConcurrent: "CLINE_RESOURCE_TEAM_RUN_MAX_CONCURRENT",
	teamRunMaxQueued: "CLINE_RESOURCE_TEAM_RUN_MAX_QUEUED",
	teamRunMaxMessageBytes: "CLINE_RESOURCE_TEAM_RUN_MAX_MESSAGE_BYTES",
	websocketSoftWatermarkBytes: "CLINE_RESOURCE_WS_SOFT_WATERMARK_BYTES",
	websocketHardWatermarkBytes: "CLINE_RESOURCE_WS_HARD_WATERMARK_BYTES",
	websocketCongestionGraceMs: "CLINE_RESOURCE_WS_CONGESTION_GRACE_MS",
	websocketCloseGraceMs: "CLINE_RESOURCE_WS_CLOSE_GRACE_MS",
	websocketMaxInboundPayloadBytes:
		"CLINE_RESOURCE_WS_MAX_INBOUND_PAYLOAD_BYTES",
	streamingFlushIntervalMs: "CLINE_RESOURCE_STREAMING_FLUSH_INTERVAL_MS",
	streamingMaxBatchBytes: "CLINE_RESOURCE_STREAMING_MAX_BATCH_BYTES",
} as const;

export const RESOURCE_POLICY_HARD_LIMITS = {
	maxParallelism: { min: 1, max: 256 },
	processMemoryLimitBytes: { min: 64 * 1024 ** 2, max: 1024 ** 4 },
	heapMemoryLimitBytes: { min: 32 * 1024 ** 2, max: 256 * 1024 ** 3 },
	diagnosticsSampleIntervalMs: { min: 100, max: 300_000 },
	eventLoopResolutionMs: { min: 1, max: 1_000 },
	pendingPromptMaxItems: { min: 0, max: 10_000 },
	pendingPromptMaxBytes: { min: 1024, max: 1024 ** 3 },
	pendingPromptMaxItemBytes: { min: 1024, max: 256 * 1024 ** 2 },
	teamRunMaxConcurrent: { min: 1, max: 256 },
	teamRunMaxQueued: { min: 0, max: 100_000 },
	teamRunMaxMessageBytes: { min: 1024, max: 256 * 1024 ** 2 },
	websocketSoftWatermarkBytes: { min: 0, max: 256 * 1024 ** 2 },
	websocketHardWatermarkBytes: { min: 1024, max: 1024 ** 3 },
	websocketCongestionGraceMs: { min: 0, max: 300_000 },
	websocketCloseGraceMs: { min: 0, max: 60_000 },
	websocketMaxInboundPayloadBytes: { min: 1024, max: 256 * 1024 ** 2 },
	streamingFlushIntervalMs: { min: 1, max: 1_000 },
	streamingMaxBatchBytes: { min: 1024, max: 16 * 1024 ** 2 },
} as const;

export type ResourcePolicyValueSource =
	| "hardware"
	| "default"
	| "environment"
	| "explicit";

export interface ResourcePolicySources {
	maxParallelism: ResourcePolicyValueSource;
	processMemoryLimitBytes: ResourcePolicyValueSource;
	heapMemoryLimitBytes: ResourcePolicyValueSource;
	diagnostics: {
		enabled: ResourcePolicyValueSource;
		sampleIntervalMs: ResourcePolicyValueSource;
		eventLoopResolutionMs: ResourcePolicyValueSource;
	};
	admission: {
		pendingPrompts: Record<
			"maxItems" | "maxBytes" | "maxItemBytes",
			ResourcePolicyValueSource
		>;
		teamRuns: Record<
			"maxConcurrent" | "maxQueued" | "maxMessageBytes",
			ResourcePolicyValueSource
		>;
	};
	transport: {
		websocket: Record<
			| "softWatermarkBytes"
			| "hardWatermarkBytes"
			| "congestionGraceMs"
			| "closeGraceMs"
			| "maxInboundPayloadBytes",
			ResourcePolicyValueSource
		>;
	};
	streaming: Record<
		"flushIntervalMs" | "maxBatchBytes",
		ResourcePolicyValueSource
	>;
}

export interface ResourceHardwareProfile {
	availableParallelism: number;
	totalMemoryBytes: number;
	heapSizeLimitBytes: number;
}

export interface ResolvedResourcePolicy {
	profile: ResourcePolicyProfile;
	sources: ResourcePolicySources;
	hardware: ResourceHardwareProfile;
}

export interface ResolveResourcePolicyOptions {
	env?: Readonly<Record<string, string | undefined>>;
	overrides?: ResourcePolicyOverrides | ResourcePolicyProfile;
	hardware?: Partial<ResourceHardwareProfile>;
}

function clampFinite(
	value: number,
	fallback: number,
	limits: { readonly min: number; readonly max: number },
): number {
	if (Number.isNaN(value)) {
		return clampFinite(fallback, limits.min, limits);
	}
	const finite =
		value === Number.POSITIVE_INFINITY
			? limits.max
			: value === Number.NEGATIVE_INFINITY
				? limits.min
				: value;
	return Math.round(Math.min(limits.max, Math.max(limits.min, finite)));
}

function finiteHardwareValue(
	value: number | undefined,
	fallback: number,
): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: fallback;
}

function parseNumber(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === "") {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isNaN(parsed) ? undefined : parsed;
}

function parseBoolean(value: string | undefined): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}
	switch (value.trim().toLowerCase()) {
		case "1":
		case "true":
		case "yes":
		case "on":
			return true;
		case "0":
		case "false":
		case "no":
		case "off":
			return false;
		default:
			return undefined;
	}
}

function chooseNumber(
	explicit: number | undefined,
	environment: number | undefined,
	fallback: number,
	limits: { readonly min: number; readonly max: number },
): { value: number; source: ResourcePolicyValueSource } {
	if (explicit !== undefined) {
		return {
			value: clampFinite(explicit, fallback, limits),
			source: "explicit",
		};
	}
	if (environment !== undefined) {
		return {
			value: clampFinite(environment, fallback, limits),
			source: "environment",
		};
	}
	return {
		value: clampFinite(fallback, limits.min, limits),
		source: "hardware",
	};
}

export function resolveResourcePolicy(
	options: ResolveResourcePolicyOptions = {},
): ResolvedResourcePolicy {
	const env = options.env ?? process.env;
	const explicit = options.overrides ?? {};
	const hardware: ResourceHardwareProfile = {
		availableParallelism: finiteHardwareValue(
			options.hardware?.availableParallelism,
			availableParallelism(),
		),
		totalMemoryBytes: finiteHardwareValue(
			options.hardware?.totalMemoryBytes,
			totalmem(),
		),
		heapSizeLimitBytes: finiteHardwareValue(
			options.hardware?.heapSizeLimitBytes,
			getHeapStatistics().heap_size_limit,
		),
	};

	const maxParallelism = chooseNumber(
		explicit.maxParallelism,
		parseNumber(env[RESOURCE_POLICY_ENV.maxParallelism]),
		hardware.availableParallelism,
		RESOURCE_POLICY_HARD_LIMITS.maxParallelism,
	);
	const processMemoryLimitBytes = chooseNumber(
		explicit.processMemoryLimitBytes,
		parseNumber(env[RESOURCE_POLICY_ENV.processMemoryLimitBytes]),
		hardware.totalMemoryBytes * 0.5,
		RESOURCE_POLICY_HARD_LIMITS.processMemoryLimitBytes,
	);
	const heapMemoryLimitBytes = chooseNumber(
		explicit.heapMemoryLimitBytes,
		parseNumber(env[RESOURCE_POLICY_ENV.heapMemoryLimitBytes]),
		hardware.heapSizeLimitBytes * 0.8,
		RESOURCE_POLICY_HARD_LIMITS.heapMemoryLimitBytes,
	);
	const sampleIntervalMs = chooseNumber(
		explicit.diagnostics?.sampleIntervalMs,
		parseNumber(env[RESOURCE_POLICY_ENV.diagnosticsSampleIntervalMs]),
		5_000,
		RESOURCE_POLICY_HARD_LIMITS.diagnosticsSampleIntervalMs,
	);
	const eventLoopResolutionMs = chooseNumber(
		explicit.diagnostics?.eventLoopResolutionMs,
		parseNumber(env[RESOURCE_POLICY_ENV.eventLoopResolutionMs]),
		20,
		RESOURCE_POLICY_HARD_LIMITS.eventLoopResolutionMs,
	);
	const explicitEnabled = explicit.diagnostics?.enabled;
	const environmentEnabled = parseBoolean(
		env[RESOURCE_POLICY_ENV.diagnosticsEnabled],
	);
	const enabled = explicitEnabled ?? environmentEnabled ?? true;
	const enabledSource: ResourcePolicyValueSource =
		explicitEnabled !== undefined
			? "explicit"
			: environmentEnabled !== undefined
				? "environment"
				: "default";
	const chooseDefault = (
		explicitValue: number | undefined,
		environmentName: string,
		fallback: number,
		limits: { readonly min: number; readonly max: number },
	) => {
		const selected = chooseNumber(
			explicitValue,
			parseNumber(env[environmentName]),
			fallback,
			limits,
		);
		return {
			...selected,
			source:
				selected.source === "hardware" ? ("default" as const) : selected.source,
		};
	};
	const pendingPromptMaxItems = chooseDefault(
		explicit.admission?.pendingPrompts?.maxItems,
		RESOURCE_POLICY_ENV.pendingPromptMaxItems,
		100,
		RESOURCE_POLICY_HARD_LIMITS.pendingPromptMaxItems,
	);
	const pendingPromptMaxBytes = chooseDefault(
		explicit.admission?.pendingPrompts?.maxBytes,
		RESOURCE_POLICY_ENV.pendingPromptMaxBytes,
		1024 * 1024,
		RESOURCE_POLICY_HARD_LIMITS.pendingPromptMaxBytes,
	);
	const pendingPromptMaxItemBytes = chooseDefault(
		explicit.admission?.pendingPrompts?.maxItemBytes,
		RESOURCE_POLICY_ENV.pendingPromptMaxItemBytes,
		256 * 1024,
		RESOURCE_POLICY_HARD_LIMITS.pendingPromptMaxItemBytes,
	);
	const teamRunMaxConcurrent = chooseDefault(
		explicit.admission?.teamRuns?.maxConcurrent,
		RESOURCE_POLICY_ENV.teamRunMaxConcurrent,
		Math.max(1, Math.min(8, Math.floor(hardware.availableParallelism / 2))),
		RESOURCE_POLICY_HARD_LIMITS.teamRunMaxConcurrent,
	);
	const teamRunMaxQueued = chooseDefault(
		explicit.admission?.teamRuns?.maxQueued,
		RESOURCE_POLICY_ENV.teamRunMaxQueued,
		100,
		RESOURCE_POLICY_HARD_LIMITS.teamRunMaxQueued,
	);
	const teamRunMaxMessageBytes = chooseDefault(
		explicit.admission?.teamRuns?.maxMessageBytes,
		RESOURCE_POLICY_ENV.teamRunMaxMessageBytes,
		256 * 1024,
		RESOURCE_POLICY_HARD_LIMITS.teamRunMaxMessageBytes,
	);
	const websocketSoftWatermarkBytes = chooseDefault(
		explicit.transport?.websocket?.softWatermarkBytes,
		RESOURCE_POLICY_ENV.websocketSoftWatermarkBytes,
		256 * 1024,
		RESOURCE_POLICY_HARD_LIMITS.websocketSoftWatermarkBytes,
	);
	const websocketHardWatermarkBytes = chooseDefault(
		explicit.transport?.websocket?.hardWatermarkBytes,
		RESOURCE_POLICY_ENV.websocketHardWatermarkBytes,
		1024 * 1024,
		RESOURCE_POLICY_HARD_LIMITS.websocketHardWatermarkBytes,
	);
	if (websocketSoftWatermarkBytes.value > websocketHardWatermarkBytes.value) {
		websocketSoftWatermarkBytes.value = websocketHardWatermarkBytes.value;
	}
	const websocketCongestionGraceMs = chooseDefault(
		explicit.transport?.websocket?.congestionGraceMs,
		RESOURCE_POLICY_ENV.websocketCongestionGraceMs,
		5_000,
		RESOURCE_POLICY_HARD_LIMITS.websocketCongestionGraceMs,
	);
	const websocketCloseGraceMs = chooseDefault(
		explicit.transport?.websocket?.closeGraceMs,
		RESOURCE_POLICY_ENV.websocketCloseGraceMs,
		1_000,
		RESOURCE_POLICY_HARD_LIMITS.websocketCloseGraceMs,
	);
	const websocketMaxInboundPayloadBytes = chooseDefault(
		explicit.transport?.websocket?.maxInboundPayloadBytes,
		RESOURCE_POLICY_ENV.websocketMaxInboundPayloadBytes,
		1024 * 1024,
		RESOURCE_POLICY_HARD_LIMITS.websocketMaxInboundPayloadBytes,
	);
	const streamingFlushIntervalMs = chooseDefault(
		explicit.streaming?.flushIntervalMs,
		RESOURCE_POLICY_ENV.streamingFlushIntervalMs,
		32,
		RESOURCE_POLICY_HARD_LIMITS.streamingFlushIntervalMs,
	);
	const streamingMaxBatchBytes = chooseDefault(
		explicit.streaming?.maxBatchBytes,
		RESOURCE_POLICY_ENV.streamingMaxBatchBytes,
		64 * 1024,
		RESOURCE_POLICY_HARD_LIMITS.streamingMaxBatchBytes,
	);

	return {
		profile: {
			version: 1,
			maxParallelism: maxParallelism.value,
			processMemoryLimitBytes: processMemoryLimitBytes.value,
			heapMemoryLimitBytes: heapMemoryLimitBytes.value,
			diagnostics: {
				enabled,
				sampleIntervalMs: sampleIntervalMs.value,
				eventLoopResolutionMs: eventLoopResolutionMs.value,
			},
			admission: {
				pendingPrompts: {
					maxItems: pendingPromptMaxItems.value,
					maxBytes: pendingPromptMaxBytes.value,
					maxItemBytes: pendingPromptMaxItemBytes.value,
				},
				teamRuns: {
					maxConcurrent: teamRunMaxConcurrent.value,
					maxQueued: teamRunMaxQueued.value,
					maxMessageBytes: teamRunMaxMessageBytes.value,
				},
			},
			transport: {
				websocket: {
					softWatermarkBytes: websocketSoftWatermarkBytes.value,
					hardWatermarkBytes: websocketHardWatermarkBytes.value,
					congestionGraceMs: websocketCongestionGraceMs.value,
					closeGraceMs: websocketCloseGraceMs.value,
					maxInboundPayloadBytes: websocketMaxInboundPayloadBytes.value,
				},
			},
			streaming: {
				flushIntervalMs: streamingFlushIntervalMs.value,
				maxBatchBytes: streamingMaxBatchBytes.value,
			},
		},
		sources: {
			maxParallelism: maxParallelism.source,
			processMemoryLimitBytes: processMemoryLimitBytes.source,
			heapMemoryLimitBytes: heapMemoryLimitBytes.source,
			diagnostics: {
				enabled: enabledSource,
				sampleIntervalMs:
					sampleIntervalMs.source === "hardware"
						? "default"
						: sampleIntervalMs.source,
				eventLoopResolutionMs:
					eventLoopResolutionMs.source === "hardware"
						? "default"
						: eventLoopResolutionMs.source,
			},
			admission: {
				pendingPrompts: {
					maxItems: pendingPromptMaxItems.source,
					maxBytes: pendingPromptMaxBytes.source,
					maxItemBytes: pendingPromptMaxItemBytes.source,
				},
				teamRuns: {
					maxConcurrent: teamRunMaxConcurrent.source,
					maxQueued: teamRunMaxQueued.source,
					maxMessageBytes: teamRunMaxMessageBytes.source,
				},
			},
			transport: {
				websocket: {
					softWatermarkBytes: websocketSoftWatermarkBytes.source,
					hardWatermarkBytes: websocketHardWatermarkBytes.source,
					congestionGraceMs: websocketCongestionGraceMs.source,
					closeGraceMs: websocketCloseGraceMs.source,
					maxInboundPayloadBytes: websocketMaxInboundPayloadBytes.source,
				},
			},
			streaming: {
				flushIntervalMs: streamingFlushIntervalMs.source,
				maxBatchBytes: streamingMaxBatchBytes.source,
			},
		},
		hardware,
	};
}
