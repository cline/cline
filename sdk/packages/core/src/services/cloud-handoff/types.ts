export type CloudHandoffFingerprint = {
	repoUrl: string;
	branch: string;
	headSha: string;
	modelId: string;
	organizationId?: string;
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
};
