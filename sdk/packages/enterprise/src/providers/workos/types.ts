import type {
	EnterpriseAccessToken,
	EnterpriseConfigBundle,
	EnterpriseIdentityClaims,
	EnterpriseProjectContext,
} from "../../contracts";

export interface WorkosResolvedIdentity {
	claims: EnterpriseIdentityClaims;
	token?: EnterpriseAccessToken;
	context?: EnterpriseProjectContext;
	metadata?: Record<string, unknown>;
}

export interface WorkosControlPlaneBundle {
	bundle: EnterpriseConfigBundle;
}
