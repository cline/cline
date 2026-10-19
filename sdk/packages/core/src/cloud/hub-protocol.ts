import type { CreateCloudSessionInput } from "./api";
import type { CloudSessionController } from "./controller";

/** Operations available to cloud UI clients. Handoff callbacks remain host-local. */
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
] as const;
export type CloudHubOperation = (typeof CLOUD_HUB_OPERATIONS)[number];
export type CloudHubMethods = Pick<CloudSessionController, CloudHubOperation>;
export type CloudHubArgs<K extends CloudHubOperation> = K extends "create"
	? [input: Omit<CreateCloudSessionInput, "handoff">]
	: Parameters<CloudHubMethods[K]>;
export type CloudHubResult<K extends CloudHubOperation> = Awaited<
	ReturnType<CloudHubMethods[K]>
>;
