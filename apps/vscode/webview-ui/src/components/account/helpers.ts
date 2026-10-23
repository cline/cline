import type { ClientName } from "@cline/shared/browser"
import { getClineDashboardUrl } from "@cline/shared/browser"
import type { UsageTransaction as ClineAccountUsageTransaction } from "@shared/ClineAccount"
import type { UsageTransaction as ProtoUsageTransaction, UserOrganization } from "@shared/proto/cline/account"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import type { ClineUser } from "@/context/ClineAuthContext"

export const getClineClientName = (): ClientName =>
	PLATFORM_CONFIG.type === PlatformType.STANDALONE ? "cline-jetbrains" : "cline-vscode"

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

export const getClineUris = (base: string | undefined, type: "dashboard" | "credits", route?: "account" | "organization") =>
	getClineDashboardUrl(
		type === "dashboard" ? "dashboard" : `/dashboard/${route ?? "account"}?tab=credits&redirect=true`,
		base,
		getClineClientName(),
	)

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

export const getPrivacySettingsUrl = (user: Pick<ClineUser, "appBaseUrl" | "dataPrivacyPath"> | null) =>
	getClineDashboardUrl(user?.dataPrivacyPath, user?.appBaseUrl, getClineClientName())

export const isAdminOrOwner = (activeOrg: UserOrganization): boolean => {
	return activeOrg.roles.findIndex((role) => role === "admin" || role === "owner") > -1
}
