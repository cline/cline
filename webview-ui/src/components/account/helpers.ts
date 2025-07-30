import type {
	PaymentTransaction as ClineAccountPaymentTransaction,
	UsageTransaction as ClineAccountUsageTransaction,
} from "@shared/ClineAccount"
import type {
	PaymentTransaction as ProtoPaymentTransaction,
	UsageTransaction as ProtoUsageTransaction,
} from "@shared/proto/cline/account"

export const getMainRole = (roles?: string[]) => {
	if (!roles) return undefined

	if (roles.includes("owner")) return "Owner"
	if (roles.includes("admin")) return "Admin"

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
export function convertProtoUsageTransaction(protoTransaction: ProtoUsageTransaction): ClineAccountUsageTransaction {
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

/**
 * Converts a protobuf PaymentTransaction to a ClineAccount PaymentTransaction
 * This is a temporary workaround for the fact that the protobuf definition is out of sync with the API response.
 */
export function convertProtoPaymentTransaction(protoTransaction: ProtoPaymentTransaction): ClineAccountPaymentTransaction {
	try {
		const unpackedData = JSON.parse(protoTransaction.paidAt)
		return unpackedData as ClineAccountPaymentTransaction
	} catch (error) {
		console.error("Failed to parse packed payment transaction:", error)
		// Return a default/empty object that won't crash the UI
		return {
			id: "",
			transactionId: "",
			userId: "",
			amountCents: 0,
			credits: 0,
			type: "",
			status: "",
			providerReference: "",
			metadata: {},
			createdAt: "",
			updatedAt: "",
			completedAt: "",
		} as unknown as ClineAccountPaymentTransaction
	}
}

/**
 * Converts an array of protobuf PaymentTransactions to ClineAccount PaymentTransactions
 */
export function convertProtoPaymentTransactions(protoTransactions: ProtoPaymentTransaction[]): ClineAccountPaymentTransaction[] {
	return protoTransactions.map(convertProtoPaymentTransaction)
}
