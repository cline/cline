import { describe, expect, it } from "bun:test"
import type * as vscode from "vscode"
import { cleanupClineAccountState } from "./state-migrations"

function createContext() {
	const globalState = new Map<string, unknown>([
		["clineAccountId", "account-1"],
		["organizationId", "org-1"],
		["billingState", { plan: "paid" }],
		["taskDefaults", { accountId: "account-1", mode: "act" }],
		["taskHistory", [{ id: "task-1" }]],
		["awsRegion", "ca-central-1"],
		["awsProfile", "developer"],
	])
	const secrets = new Map<string, string>([
		["accessToken", "access-secret"],
		["refreshToken", "refresh-secret"],
		["clineAccountId", "account-1"],
		["mcpOAuthSecrets", "preserve-mcp-oauth"],
	])

	return {
		context: {
			globalState: {
				get: <T>(key: string) => globalState.get(key) as T | undefined,
				update: async (key: string, value: unknown) => {
					value === undefined ? globalState.delete(key) : globalState.set(key, value)
				},
			},
			secrets: {
				delete: async (key: string) => {
					secrets.delete(key)
				},
			},
		} as unknown as vscode.ExtensionContext,
		globalState,
		secrets,
	}
}

describe("cleanupClineAccountState", () => {
	it("removes account secrets and task defaults while preserving history, Bedrock, and MCP OAuth state", async () => {
		const { context, globalState, secrets } = createContext()

		await cleanupClineAccountState(context)
		await cleanupClineAccountState(context)

		expect(secrets.has("accessToken")).toBe(false)
		expect(secrets.has("refreshToken")).toBe(false)
		expect(secrets.get("mcpOAuthSecrets")).toBe("preserve-mcp-oauth")
		expect(globalState.has("clineAccountId")).toBe(false)
		expect(globalState.has("organizationId")).toBe(false)
		expect(globalState.get("taskDefaults")).toEqual({ mode: "act" })
		expect(globalState.get("taskHistory")).toEqual([{ id: "task-1" }])
		expect(globalState.get("awsRegion")).toBe("ca-central-1")
		expect(globalState.get("awsProfile")).toBe("developer")
		expect(globalState.get("phase4AccountCleanupComplete")).toBe(true)
	})
})
