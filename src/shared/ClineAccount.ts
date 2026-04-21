export interface UserResponse {
	id: string
	email: string
	displayName: string
	photoUrl: string
	createdAt: string
	updatedAt: string
	organizations: [
		{
			active: boolean
			memberId: string
			name: string
			organizationId: string
			roles: ["admin" | "member" | "owner"]
		},
	]
}

export interface BalanceResponse {
	balance: number
	userId: string
}

export interface FeaturebaseTokenResponse {
	featurebaseJwt: string
}

export interface UsageTransaction {
	aiInferenceProviderName: string
	aiModelName: string
	aiModelTypeName: string
	completionTokens: number
	costUsd: number
	createdAt: string
	creditsUsed: number
	generationId: string
	id: string
	metadata: {
		additionalProp1: string
		additionalProp2: string
		additionalProp3: string
	}
	operation?: string
	organizationId: string
	promptTokens: number
	totalTokens: number
	userId: string
}

export interface PaymentTransaction {
	paidAt: string
	creatorId: string
	amountCents: number
	credits: number
}

export interface OrganizationBalanceResponse {
	balance: number
	organizationId: string
}

export interface OrganizationUsageTransaction {
	aiInferenceProviderName: string
	aiModelName: string
	aiModelTypeName: string
	completionTokens: number
	costUsd: number
	createdAt: string
	creditsUsed: number
	generationId: string
	id: string
	memberDisplayName: string
	memberEmail: string
	metadata: {
		additionalProp1: string
		additionalProp2: string
		additionalProp3: string
	}
	operation?: string
	organizationId: string
	promptTokens: number
	totalTokens: number
	userId: string
}

export interface UserRemoteConfigOrganization {
	organizationId: string
	name: string
}

export interface UserRemoteConfigDiscoveryResponse {
	organizationId: string
	value: string
	organizations?: UserRemoteConfigOrganization[]
}

// Used in cline.ts provider and in webview-ui/src/components/chat/ChatRow.tsx to display the login button
export const CLINE_ACCOUNT_AUTH_ERROR_MESSAGE = "Unauthorized: Please sign in to Cline before trying again."

// ---------------------------------------------------------------------------
// Spend control (third-party API spend limits)
// ---------------------------------------------------------------------------

/**
 * Source of the effective limits for a user.
 * - "none": no limits apply
 * - "org_default": org-wide defaults apply to this user
 * - "user_override": a per-user override has been set
 */
export type LimitSource = "none" | "org_default" | "user_override"

/**
 * Effective budget limits for a user within an organization.
 * All USD amounts. `null` means the limit is not set.
 */
export interface EffectiveLimits {
	monthlyLimitUsd: number | null
	dailyLimitUsd: number | null
	orgMonthlyUsd: number | null
	source: LimitSource
}

/**
 * A user's current-period spend (for the active org).
 * ISO-8601 timestamps for reset times.
 */
export interface BudgetUserCurrentPeriod {
	monthlySpendUsd: number
	dailySpendUsd: number
	monthResetsAt?: string
	dayResetsAt?: string
}

/**
 * Payload returned by the backend overbudget check endpoint.
 * See: GET /api/v1/organizations/{orgId}/budget/overbudget
 */
export interface OverbudgetStatus {
	overbudget: boolean
	limits: EffectiveLimits
	usage: BudgetUserCurrentPeriod
}
