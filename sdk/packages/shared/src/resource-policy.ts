import { z } from "zod";

export const RESOURCE_POLICY_VERSION = 1 as const;

export const ResourceDiagnosticsPolicySchema = z
	.object({
		enabled: z.boolean(),
		sampleIntervalMs: z.number().finite().int().positive(),
		eventLoopResolutionMs: z.number().finite().int().positive(),
	})
	.strict();

export const ResourceAdmissionPolicySchema = z
	.object({
		pendingPrompts: z
			.object({
				maxItems: z.number().finite().int().nonnegative(),
				maxBytes: z.number().finite().int().positive(),
				maxItemBytes: z.number().finite().int().positive(),
			})
			.strict(),
		teamRuns: z
			.object({
				maxConcurrent: z.number().finite().int().positive(),
				maxQueued: z.number().finite().int().nonnegative(),
				maxMessageBytes: z.number().finite().int().positive(),
			})
			.strict(),
	})
	.strict();

export const ResourceTransportPolicySchema = z
	.object({
		websocket: z
			.object({
				softWatermarkBytes: z.number().finite().int().nonnegative(),
				hardWatermarkBytes: z.number().finite().int().positive(),
				congestionGraceMs: z.number().finite().int().nonnegative(),
				closeGraceMs: z.number().finite().int().nonnegative(),
				maxInboundPayloadBytes: z.number().finite().int().positive(),
			})
			.strict()
			.refine(
				(value) => value.softWatermarkBytes <= value.hardWatermarkBytes,
				"WebSocket soft watermark cannot exceed hard watermark",
			),
	})
	.strict();

export const ResourceStreamingPolicySchema = z
	.object({
		flushIntervalMs: z.number().finite().int().positive(),
		maxBatchBytes: z.number().finite().int().positive(),
	})
	.strict();

export const ResourcePolicyProfileV1Schema = z
	.object({
		version: z.literal(RESOURCE_POLICY_VERSION),
		maxParallelism: z.number().finite().int().positive(),
		processMemoryLimitBytes: z.number().finite().int().positive(),
		heapMemoryLimitBytes: z.number().finite().int().positive(),
		diagnostics: ResourceDiagnosticsPolicySchema,
		admission: ResourceAdmissionPolicySchema,
		transport: ResourceTransportPolicySchema,
		streaming: ResourceStreamingPolicySchema,
	})
	.strict();

export const ResourcePolicyProfileSchema = z.discriminatedUnion("version", [
	ResourcePolicyProfileV1Schema,
]);

export type ResourceDiagnosticsPolicy = z.infer<
	typeof ResourceDiagnosticsPolicySchema
>;
export type ResourceAdmissionPolicy = z.infer<
	typeof ResourceAdmissionPolicySchema
>;
export type ResourceTransportPolicy = z.infer<
	typeof ResourceTransportPolicySchema
>;
export type ResourceStreamingPolicy = z.infer<
	typeof ResourceStreamingPolicySchema
>;
export type ResourcePolicyProfileV1 = z.infer<
	typeof ResourcePolicyProfileV1Schema
>;
export type ResourcePolicyProfile = z.infer<typeof ResourcePolicyProfileSchema>;

/** Partial values accepted by Node runtimes when resolving a resource policy. */
export interface ResourcePolicyOverrides {
	maxParallelism?: number;
	processMemoryLimitBytes?: number;
	heapMemoryLimitBytes?: number;
	diagnostics?: Partial<ResourceDiagnosticsPolicy>;
	admission?: {
		pendingPrompts?: Partial<ResourceAdmissionPolicy["pendingPrompts"]>;
		teamRuns?: Partial<ResourceAdmissionPolicy["teamRuns"]>;
	};
	transport?: {
		websocket?: Partial<ResourceTransportPolicy["websocket"]>;
	};
	streaming?: Partial<ResourceStreamingPolicy>;
}

export function parseResourcePolicyProfile(
	value: unknown,
): ResourcePolicyProfile {
	return ResourcePolicyProfileSchema.parse(value);
}

export function isResourcePolicyProfile(
	value: unknown,
): value is ResourcePolicyProfile {
	return ResourcePolicyProfileSchema.safeParse(value).success;
}
