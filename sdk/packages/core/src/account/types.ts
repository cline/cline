export interface ClineAccountOrganization {
	active: boolean;
	memberId: string;
	name: string;
	organizationId: string;
	roles: Array<"admin" | "member" | "owner">;
}

export interface ClineAccountUser {
	id: string;
	email: string;
	displayName: string;
	photoUrl: string;
	createdAt: string;
	updatedAt: string;
	organizations: ClineAccountOrganization[];
}

export interface UserRemoteConfigResponse {
	organizationId: string;
	value: string;
	enabled: boolean;
}

export interface ClineAccountBalance {
	balance: number;
	userId: string;
}

export interface ClineAccountUsageTransaction {
	aiInferenceProviderName: string;
	aiModelName: string;
	aiModelTypeName: string;
	completionTokens: number;
	costUsd: number;
	createdAt: string;
	creditsUsed: number;
	generationId: string;
	id: string;
	metadata: {
		additionalProp1: string;
		additionalProp2: string;
		additionalProp3: string;
	};
	operation?: string;
	organizationId: string;
	promptTokens: number;
	totalTokens: number;
	userId: string;
}

export interface ClineAccountPaymentTransaction {
	paidAt: string;
	creatorId: string;
	amountCents: number;
	credits: number;
}

export interface ClineOrganization {
	createdAt: string;
	defaultRemoteConfig?: string;
	deletedAt?: string;
	externalOrganizationId?: string;
	id: string;
	memberCount?: number;
	name: string;
	remoteConfigEnabled: boolean;
	updatedAt: string;
}

export interface ClineAccountOrganizationBalance {
	balance: number;
	organizationId: string;
}

export interface FeaturebaseTokenResponse {
	featurebaseJwt: string;
}

export interface ClineAccountOrganizationUsageTransaction {
	aiInferenceProviderName: string;
	aiModelName: string;
	aiModelTypeName: string;
	completionTokens: number;
	costUsd: number;
	createdAt: string;
	creditsUsed: number;
	generationId: string;
	id: string;
	memberDisplayName: string;
	memberEmail: string;
	metadata: {
		additionalProp1: string;
		additionalProp2: string;
		additionalProp3: string;
	};
	operation?: string;
	organizationId: string;
	promptTokens: number;
	totalTokens: number;
	userId: string;
}
