import { z } from "zod";
import type { CloudSessionController } from "./controller";

/** Operations available to cloud UI clients. Lifecycle callbacks remain host-local. */
export const CLOUD_HUB_OPERATIONS = [
	"create",
	"attach",
	"send",
	"abort",
	"pendingPrompts",
	"updatePendingPrompt",
	"removePendingPrompt",
	"readMessages",
	"updateTitle",
	"delete",
	"list",
	"listForDiscovery",
	"getCrossScopeDiscoveryRecord",
	"listModels",
	"listRepositories",
	"listBranches",
	"respondApproval",
	"restoreCreationOptions",
	"refreshOrganization",
	"prepareHandoffRepository",
] as const;
export type CloudHubScope = { serviceId: string; scopeGeneration: number };

export const cloudSendFailureSchema = z.object({
	dispatched: z.boolean(),
	message: z.string(),
	detail: z.string().optional(),
});
export type CloudSendFailure = z.infer<typeof cloudSendFailureSchema>;

export function serializeCloudSendFailure(
	error: unknown,
	dispatched: boolean,
): CloudSendFailure {
	return {
		dispatched,
		message: error instanceof Error ? error.message : String(error),
		...(error instanceof Error &&
		"detail" in error &&
		typeof error.detail === "string"
			? { detail: error.detail }
			: {}),
	};
}

export class CloudSendError extends Error {
	constructor(
		message: string,
		readonly dispatched: boolean,
		readonly detail?: string,
	) {
		super(message);
		this.name = "CloudSendError";
	}
}

export type CloudHubOperation = (typeof CLOUD_HUB_OPERATIONS)[number];
export type CloudHubMethods = Pick<CloudSessionController, CloudHubOperation>;
export type CloudHubArgs<K extends CloudHubOperation> = K extends "create"
	? [input: Omit<Parameters<CloudSessionController["create"]>[0], "handoff">]
	: K extends "send"
		? [
				sessionId: string,
				prompt: string,
				delivery?: "queue" | "steer",
				modelId?: string,
				images?: string[],
			]
		: Parameters<CloudHubMethods[K]>;
export type CloudHubResult<K extends CloudHubOperation> = Awaited<
	ReturnType<CloudHubMethods[K]>
>;
