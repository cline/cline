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

/**
 * Which client a privacy-settings link identifies itself as. The JetBrains plugin renders this same
 * webview through the standalone host, so standalone means JetBrains here.
 */
export const getPrivacySettingsClient = (): PrivacySettingsClient =>
	PLATFORM_CONFIG.type === PlatformType.STANDALONE ? "jetbrains" : "vscode"

/**
 * Builds the web app's privacy settings URL from the `dataPrivacyPath` the API advertises on
 * GET /users/me. The path is relative and carries a query string, so it is joined with
 * `new URL(path, base)` rather than concatenated. Returns undefined when the API advertised
 * nothing, which is the signal to render no link at all.
 */
export const getPrivacySettingsUrl = (
	base: string,
	dataPrivacyPath: string | undefined,
	client: PrivacySettingsClient = getPrivacySettingsClient(),
): URL | undefined => {
	if (!dataPrivacyPath) {
		return undefined
	}
	try {
		const url = new URL(dataPrivacyPath, base)
		url.searchParams.set("client", client)
		return url
	} catch {
		return undefined
	}
}

export const isAdminOrOwner = (activeOrg: UserOrganization): boolean => {
	return activeOrg.roles.findIndex((role) => role === "admin" || role === "owner") > -1
}
