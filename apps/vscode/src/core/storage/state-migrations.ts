import fs from "fs/promises"
import path from "path"
import * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"
import { ensureRulesDirectoryExists } from "./disk"

const ACCOUNT_CLEANUP_MIGRATION_KEY = "phase4AccountCleanupComplete"

const CLINE_ACCOUNT_SECRET_KEYS = [
	"accessToken",
	"authToken",
	"clineAccountId",
	"clineApiKey",
	"clineAuthToken",
	"clinePassToken",
	"clineRefreshToken",
	"idToken",
	"ocaAccessToken",
	"ocaCredentials",
	"ocaRefreshToken",
	"refreshToken",
] as const

const CLINE_ACCOUNT_STATE_KEYS = [
	"activeOrganizationId",
	"billingState",
	"clineAccountId",
	"clinePassEnabled",
	"clinePassState",
	"creditBalance",
	"credits",
	"isLoggedIn",
	"organizationId",
	"organizationName",
	"subscription",
	"userInfo",
] as const

const ACCOUNT_TASK_DEFAULT_FIELDS = new Set([
	"accountId",
	"activeOrganizationId",
	"billingState",
	"clineAccountId",
	"clinePassEnabled",
	"creditBalance",
	"organizationId",
	"refreshToken",
	"subscription",
])

function withoutAccountTaskDefaults(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return value
	}

	return Object.fromEntries(Object.entries(value).filter(([key]) => !ACCOUNT_TASK_DEFAULT_FIELDS.has(key)))
}

/**
 * Removes legacy Cline-hosted account state without touching Bedrock settings,
 * MCP OAuth, history, checkpoints, worktrees, or conversation data.
 */
export async function cleanupClineAccountState(context: vscode.ExtensionContext): Promise<void> {
	if (context.globalState.get<boolean>(ACCOUNT_CLEANUP_MIGRATION_KEY)) {
		return
	}

	try {
		await Promise.all(CLINE_ACCOUNT_SECRET_KEYS.map((key) => context.secrets.delete(key)))
		await Promise.all(CLINE_ACCOUNT_STATE_KEYS.map((key) => context.globalState.update(key, undefined)))

		for (const key of ["taskDefaults", "defaultTaskSettings", "taskSettings"]) {
			const current = context.globalState.get<unknown>(key)
			const cleaned = withoutAccountTaskDefaults(current)
			if (cleaned !== current) {
				await context.globalState.update(key, cleaned)
			}
		}

		await context.globalState.update(ACCOUNT_CLEANUP_MIGRATION_KEY, true)
		Logger.info("[Storage Migration] Removed legacy Cline account state")
	} catch (error) {
		Logger.error("[Storage Migration] Failed to remove legacy Cline account state", error)
	}
}

export async function migrateWorkspaceToGlobalStorage(context: vscode.ExtensionContext) {
	// Keys to migrate from workspace storage back to global storage
	const keysToMigrate = [
		// Core settings
		"apiProvider",
		"apiModelId",
		"thinkingBudgetTokens",
		"reasoningEffort",

		// Bedrock model keys
		"awsBedrockCustomSelected",
		"awsBedrockCustomModelBaseId",

		// Previous mode settings
		"previousModeApiProvider",
		"previousModeModelId",
		"previousModeModelInfo",
		"previousModeThinkingBudgetTokens",
		"previousModeReasoningEffort",
		"previousModeAwsBedrockCustomSelected",
		"previousModeAwsBedrockCustomModelBaseId",
	]

	for (const key of keysToMigrate) {
		// Use raw workspace state since these keys shouldn't be in workspace storage
		const workspaceValue = await context.workspaceState.get(key)
		const globalValue = await context.globalState.get(key)

		if (workspaceValue !== undefined && globalValue === undefined) {
			Logger.log(`[Storage Migration] migrating key: ${key} to global storage. Current value: ${workspaceValue}`)

			// Move to global storage using raw VSCode method to avoid type errors
			await context.globalState.update(key, workspaceValue)
			// Remove from workspace storage
			await context.workspaceState.update(key, undefined)
			const newWorkspaceValue = await context.workspaceState.get(key)

			Logger.log(`[Storage Migration] migrated key: ${key} to global storage. Current value: ${newWorkspaceValue}`)
		}
	}
}

export async function migrateTaskHistoryToFile(_context: vscode.ExtensionContext) {
	// TODO migrate to sdk location
}

export async function migrateCustomInstructionsToGlobalRules(context: vscode.ExtensionContext) {
	try {
		const customInstructions = (await context.globalState.get("customInstructions")) as string | undefined

		if (customInstructions?.trim()) {
			Logger.log("Migrating custom instructions to global Cline rules...")

			// Create global .clinerules directory if it doesn't exist
			const globalRulesDir = await ensureRulesDirectoryExists()

			// Use a fixed filename for custom instructions
			const migrationFileName = "custom_instructions.md"
			const migrationFilePath = path.join(globalRulesDir, migrationFileName)

			try {
				// Check if file already exists to determine if we should append
				let existingContent = ""
				try {
					existingContent = await fs.readFile(migrationFilePath, "utf8")
				} catch (_readError) {
					// File doesn't exist, which is fine
				}

				// Append or create the file with custom instructions
				const contentToWrite = existingContent
					? `${existingContent}\n\n---\n\n${customInstructions.trim()}`
					: customInstructions.trim()

				await fs.writeFile(migrationFilePath, contentToWrite)
				Logger.log(`Successfully ${existingContent ? "appended to" : "created"} migration file: ${migrationFilePath}`)
			} catch (fileError) {
				Logger.error("Failed to write migration file:", fileError)
				return
			}

			// Remove customInstructions from global state only after successful file creation
			await context.globalState.update("customInstructions", undefined)
			Logger.log("Successfully migrated custom instructions to global Cline rules")
		}
	} catch (error) {
		Logger.error("Failed to migrate custom instructions to global rules:", error)
		// Continue execution - migration failure shouldn't break extension startup
	}
}

export async function migrateWelcomeViewCompleted(context: vscode.ExtensionContext) {
	try {
		const welcomeViewCompleted = context.globalState.get("welcomeViewCompleted")

		if (welcomeViewCompleted === undefined) {
			Logger.log("Migrating welcomeViewCompleted setting...")
			const hasBedrockConnection = ["awsRegion", "awsProfile", "awsBedrockEndpoint"].some(
				(key) => context.globalState.get(key) !== undefined,
			)
			await context.globalState.update("welcomeViewCompleted", hasBedrockConnection)
			Logger.log(`Migration: Set welcomeViewCompleted to ${hasBedrockConnection} from Bedrock settings`)
		}
	} catch (error) {
		Logger.error("Failed to migrate welcomeViewCompleted:", error)
		// Continue execution - migration failure shouldn't break extension startup
	}
}
