import type { UsageTransaction as ClineAccountUsageTransaction } from "@shared/ClineAccount"
import type { UsageTransaction as ProtoUsageTransaction, UserOrganization } from "@shared/proto/cline/account"

/** Returns the i18n key for the user's main organization role; translate at the render site. */
export const getMainRole = (roles?: string[]) => {
	if (!roles) {
		return undefined
	}

	if (roles.includes("owner")) {
		return "account:roles.owner"
	}
	if (roles.includes("admin")) {
		return "account:roles.admin"
	}

	return "account:roles.member"
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

export const isAdminOrOwner = (activeOrg: UserOrganization): boolean => {
	return activeOrg.roles.findIndex((role) => role === "admin" || role === "owner") > -1
}
