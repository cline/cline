import { resolveClineAppUrl } from "@cline/shared/browser"
import type { UsageTransaction as ClineAccountUsageTransaction } from "@shared/ClineAccount"
import type { UsageTransaction as ProtoUsageTransaction, UserOrganization } from "@shared/proto/cline/account"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"

export const getMainRole = (roles?: string[]) => {
	if (!roles) {
		return undefined
	}

	if (roles.includes("owner")) {
		return "Owner"
	}
	if (roles.includes("admin")) {
		return "Admin"
	}

	return "Member"
}

export const getClineUris = (base: string, type: "dashboard" | "credits", route?: "account" | "organization") => {
	const dashboard = new URL("dashboard", base)

	if (type === "dashboard") {
		return dashboard
	}

	const credits = new URL("/" + (route ?? "account"), dashboard)
	credits.searchParams.set("tab", "credits")
	credits.searchParams.set("redirect", "true")
	return credits
}

/**
 * Converts a protobuf UsageTransaction to a ClineAccount UsageTransaction
 * by adding the missing id and metadata fields
 */
function convertProtoUsageTransaction(protoTransaction: ProtoUsageTransaction): ClineAccountUsageTransaction {
	return {
		...protoTransaction,
		id: protoTransaction.generationId, // Use generationId as the id
		metadata: {
			additionalProp1: "",
			additionalProp2: "",
			additionalProp3: "",
		},
	}
}

/**
 * Converts an array of protobuf UsageTransactions to ClineAccount UsageTransactions
 */
export function convertProtoUsageTransactions(protoTransactions: ProtoUsageTransaction[]): ClineAccountUsageTransaction[] {
	return protoTransactions.map(convertProtoUsageTransaction)
}

export type PrivacySettingsClient = "vscode" | "jetbrains"

const runsInJetBrains = () => PLATFORM_CONFIG.type === PlatformType.STANDALONE

export const getPrivacySettingsClient = (): PrivacySettingsClient => (runsInJetBrains() ? "jetbrains" : "vscode")

export const getPrivacySettingsUrl = (
	appBaseUrl: string,
	dataPrivacyPath: string | undefined,
	client: PrivacySettingsClient = getPrivacySettingsClient(),
): URL | undefined => {
	const url = resolveClineAppUrl(dataPrivacyPath, appBaseUrl)
	url?.searchParams.set("client", client)
	return url
}

export const isAdminOrOwner = (activeOrg: UserOrganization): boolean => {
	return activeOrg.roles.findIndex((role) => role === "admin" || role === "owner") > -1
}
