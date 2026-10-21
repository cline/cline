import type { CreateCloudSessionInput } from "./api";
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
] as const;
export type CloudHubScope = { serviceId: string; scopeGeneration: number };

export type CloudHubOperation = (typeof CLOUD_HUB_OPERATIONS)[number];
export type CloudHubMethods = Pick<CloudSessionController, CloudHubOperation>;
export type CloudHubArgs<K extends CloudHubOperation> = K extends "create"
	? [input: Omit<CreateCloudSessionInput, "handoff">]
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
