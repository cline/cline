import { z } from "zod";

export const DeploymentProfileSchema = z.enum(["local", "cloud", "hybrid"]);
export type DeploymentProfile = z.infer<typeof DeploymentProfileSchema>;

export const EgressClassSchema = z.enum([
	"loopback-only",
	"declared-providers",
	"platform-cloud",
]);
export type EgressClass = z.infer<typeof EgressClassSchema>;

export const ResolvedLlmEgressSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("local"),
			providerId: z.string().min(1),
			baseUrlClass: z.literal("loopback"),
		})
		.strict(),
	z
		.object({
			kind: z.literal("cloud"),
			providerId: z.string().min(1),
		})
		.strict(),
]);
export type ResolvedLlmEgress = z.infer<typeof ResolvedLlmEgressSchema>;

export const SttBackendSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("local-worker"),
			engine: z.string().min(1),
		})
		.strict(),
	z.object({ kind: z.literal("webSpeech") }).strict(),
	z
		.object({
			kind: z.literal("cloud-api"),
			engine: z.string().min(1),
		})
		.strict(),
]);
export type SttBackend = z.infer<typeof SttBackendSchema>;

export const TtsBackendSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("browser-speechSynthesis") }).strict(),
	z
		.object({
			kind: z.literal("local-worker"),
			engine: z.string().min(1),
		})
		.strict(),
	z
		.object({
			kind: z.literal("cloud-api"),
			engine: z.string().min(1),
		})
		.strict(),
]);
export type TtsBackend = z.infer<typeof TtsBackendSchema>;

export const RuntimeTopologySchema = z
	.object({
		profile: DeploymentProfileSchema,
		llm: ResolvedLlmEgressSchema,
		stt: SttBackendSchema,
		tts: TtsBackendSchema,
		egressCeiling: EgressClassSchema,
	})
	.strict();
export type RuntimeTopology = z.infer<typeof RuntimeTopologySchema>;

export function parseRuntimeTopology(input: unknown): RuntimeTopology {
	return RuntimeTopologySchema.parse(input);
}

export function defaultEgressCeiling(profile: DeploymentProfile): EgressClass {
	switch (profile) {
		case "local":
			return "loopback-only";
		case "cloud":
			// Cloud pack defaults to Web Speech STT, which needs platform-cloud.
			return "platform-cloud";
		case "hybrid":
			return "declared-providers";
		default: {
			const _exhaustive: never = profile;
			return _exhaustive;
		}
	}
}

export function sttBackendEgress(backend: SttBackend): EgressClass {
	switch (backend.kind) {
		case "local-worker":
			return "loopback-only";
		case "webSpeech":
			return "platform-cloud";
		case "cloud-api":
			return "declared-providers";
		default: {
			const _exhaustive: never = backend;
			return _exhaustive;
		}
	}
}

export function ttsBackendEgress(backend: TtsBackend): EgressClass {
	switch (backend.kind) {
		case "browser-speechSynthesis":
		case "local-worker":
			return "loopback-only";
		case "cloud-api":
			return "declared-providers";
		default: {
			const _exhaustive: never = backend;
			return _exhaustive;
		}
	}
}

/** Rank egress classes for ceiling comparisons (higher = more open). */
export function egressRank(egress: EgressClass): number {
	switch (egress) {
		case "loopback-only":
			return 0;
		case "declared-providers":
			return 1;
		case "platform-cloud":
			return 2;
		default: {
			const _exhaustive: never = egress;
			return _exhaustive;
		}
	}
}

export function egressWithinCeiling(
	required: EgressClass,
	ceiling: EgressClass,
): boolean {
	return egressRank(required) <= egressRank(ceiling);
}

export function sttBackendsEqual(a: SttBackend, b: SttBackend): boolean {
	switch (a.kind) {
		case "webSpeech":
			return b.kind === "webSpeech";
		case "local-worker":
			return b.kind === "local-worker" && a.engine === b.engine;
		case "cloud-api":
			return b.kind === "cloud-api" && a.engine === b.engine;
		default: {
			const _exhaustive: never = a;
			return _exhaustive;
		}
	}
}

export function ttsBackendsEqual(a: TtsBackend, b: TtsBackend): boolean {
	switch (a.kind) {
		case "browser-speechSynthesis":
			return b.kind === "browser-speechSynthesis";
		case "local-worker":
			return b.kind === "local-worker" && a.engine === b.engine;
		case "cloud-api":
			return b.kind === "cloud-api" && a.engine === b.engine;
		default: {
			const _exhaustive: never = a;
			return _exhaustive;
		}
	}
}

export function llmEgressEqual(
	a: ResolvedLlmEgress,
	b: ResolvedLlmEgress,
): boolean {
	if (a.kind !== b.kind || a.providerId !== b.providerId) {
		return false;
	}
	if (a.kind === "local" && b.kind === "local") {
		return a.baseUrlClass === b.baseUrlClass;
	}
	return true;
}

/** Stable Map key for topology memoization (no JSON.stringify). */
export function topologyCacheKey(topology: RuntimeTopology): string {
	const llmKey =
		topology.llm.kind === "local"
			? `local:${topology.llm.providerId}:${topology.llm.baseUrlClass}`
			: `cloud:${topology.llm.providerId}`;
	const sttKey =
		topology.stt.kind === "webSpeech"
			? "webSpeech"
			: `${topology.stt.kind}:${topology.stt.engine}`;
	const ttsKey =
		topology.tts.kind === "browser-speechSynthesis"
			? "browser-speechSynthesis"
			: `${topology.tts.kind}:${topology.tts.engine}`;
	return [
		topology.profile,
		topology.egressCeiling,
		llmKey,
		sttKey,
		ttsKey,
	].join("|");
}

export function topologiesEqual(
	a: RuntimeTopology,
	b: RuntimeTopology,
): boolean {
	return (
		a.profile === b.profile &&
		a.egressCeiling === b.egressCeiling &&
		llmEgressEqual(a.llm, b.llm) &&
		sttBackendsEqual(a.stt, b.stt) &&
		ttsBackendsEqual(a.tts, b.tts)
	);
}
