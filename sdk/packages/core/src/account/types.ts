import type { ClineSubscriptionPlan } from "@cline/shared";

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

export interface UserRemoteConfigOrganization {
	organizationId: string;
	name: string;
}

export interface UserRemoteConfigResponse {
	organizationId: string;
	value: string;
	enabled: boolean;
	organizations?: UserRemoteConfigOrganization[];
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

// Canonical definition lives in the shared UI contracts (@cline/shared/ui)
// so presentation packages can consume it without depending on @cline/core.
export type { ClineSubscriptionPlan } from "@cline/shared";

export interface UserCurrentPlan {
	cancelAt?: string;
	canceledAt?: string;
	currentPeriodEnd?: string;
	currentPeriodStart?: string;
	plan?: ClineSubscriptionPlan | null;
	planHistoryId?: string;
	subscriptionId?: string;
	userId?: string;
	[key: string]: unknown;
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
