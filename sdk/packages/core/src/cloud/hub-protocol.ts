import type { HandoffGitPublication } from "../services/cloud-handoff/git-preparation";
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
	"getArtifactDownloadUrl",
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
export type CloudHubScope = {
	serviceId: string;
	scopeGeneration: number;
	expectedAccountId?: string;
};

export type CloudHubOperation = (typeof CLOUD_HUB_OPERATIONS)[number];
export type CloudHubMethods = Pick<CloudSessionController, CloudHubOperation>;
type CloudCreateInput = Omit<
	Parameters<CloudSessionController["create"]>[0],
	"handoff"
>;
export type CloudHubCreateInput = CloudCreateInput &
	(
		| { localGit?: never }
		| {
				localGit: HandoffGitPublication;
				organizationId: string | null;
				requestId: string;
				initialMessage: { text: string; images?: string[] };
		  }
	);
export type CloudHubArgs<K extends CloudHubOperation> = K extends "create"
	? [input: CloudHubCreateInput]
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
