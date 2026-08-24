export type CloudHandoffFingerprint = {
	repoUrl: string;
	branch: string;
	headSha: string;
	modelId: string;
	organizationId?: string;
	/** Repository-relative source cwd; omitted when the session is at repo root. */
	workspaceRelativePath?: string;
	/** Source interaction mode; omitted for the default Act mode. */
	mode?: "plan" | "yolo" | "zen";
};

export type CloudHandoffMetadata = {
	toCloudSessionId: string;
	handedOffAt: string;
	status: "pending" | "complete";
	innerSessionId?: string;
	dashboardUrl?: string;
	fingerprint?: CloudHandoffFingerprint;
};

export type CloudHandoffDestination = "in_app" | "external";

export type CloudHandoffProgressPhase =
	| "checking"
	| "creating"
	| "provisioning"
	| "connecting"
	| "seeding"
	| "verifying"
	| "starting"
	| "complete";

export type CloudHandoffProgress = {
	phase: CloudHandoffProgressPhase;
	message: string;
	sessionId?: string;
	dashboardUrl?: string;
};

export type CloudHandoffResult = {
	outerSessionId: string;
	innerSessionId: string;
	dashboardUrl: string;
	destination: CloudHandoffDestination;
	warning?: string;
	/** How the follow-up command failed: definitely unqueued, or unconfirmed
	 * either way (an unconfirmed prompt must not be resubmitted blindly). */
	warningKind?: "unqueued" | "unconfirmed";
};
