import {
	type BedrockCoderCoreStartInput,
	type CoreSessionConfig,
	readCompactionStrategyGlobally,
	type StartSessionResult,
} from "@bedrock-coder/core"
import { buildBedrockCoderSystemPrompt } from "@bedrock-coder/shared"
import { type ApiConfiguration, BEDROCK_DEFAULT_MODEL_ID } from "@shared/api"
import { BedrockCoderClient } from "@shared/bedrock-coder"
import type { HistoryItem } from "@shared/HistoryItem"
import { DEFAULT_LANGUAGE_SETTINGS, getLanguageKey, type LanguageDisplay } from "@shared/Languages"
import { Logger } from "@shared/services/Logger"
import type { Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import * as vscode from "vscode"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { buildBedrockProviderConfig } from "./bedrock-config"
import { buildAgentHooks } from "./hooks-adapter"
import type { SdkSessionHost } from "./session-host"

export interface SessionConfigInput {
	prompt?: string
	images?: string[]
	files?: string[]
	historyItem?: HistoryItem
	taskSettings?: Partial<Settings>
	cwd: string
	workspaceRoot?: string
	mode?: Mode
}

export interface ActiveSession {
	sessionId: string
	startConfig?: Pick<CoreSessionConfig, "providerId" | "modelId">
	sdkHost: SdkSessionHost
	unsubscribe: () => void
	startResult?: StartSessionResult
	isRunning: boolean
}

function createSdkLogger() {
	return {
		debug: (message: string, metadata?: Record<string, unknown>) => Logger.debug(message, metadata),
		log: (message: string, metadata?: Record<string, unknown>) => Logger.log(message, metadata),
		error: (message: string, metadata?: Record<string, unknown>) => Logger.error(message, metadata),
	}
}

async function resolveHostIdentity() {
	try {
		return await HostProvider.env.getHostVersion({})
	} catch (error) {
		Logger.debug("Failed to resolve host version for client identity", error)
		return undefined
	}
}

async function resolveIsMultiRootWorkspace(): Promise<boolean> {
	try {
		return (await HostProvider.workspace.getWorkspacePaths({})).paths.length > 1
	} catch {
		return false
	}
}

function resolveWorkspaceName(workspacePath: string): string {
	const withoutTrailingSeparators = workspacePath.trim().replace(/[\\/]+$/, "")
	return withoutTrailingSeparators.split(/[\\/]/).filter(Boolean).pop()?.trim() || "workspace"
}

function resolveModelId(configuration: ApiConfiguration, mode: Mode): string {
	const selected = mode === "plan" ? configuration.planModeApiModelId : configuration.actModeApiModelId
	return selected?.trim() || BEDROCK_DEFAULT_MODEL_ID
}

function resolveReasoning(
	configuration: ApiConfiguration,
	mode: Mode,
): Pick<CoreSessionConfig, "thinking" | "thinkingBudgetTokens" | "reasoningEffort"> {
	const budget = mode === "plan" ? configuration.planModeThinkingBudgetTokens : configuration.actModeThinkingBudgetTokens
	const effort = mode === "plan" ? configuration.planModeReasoningEffort : configuration.actModeReasoningEffort
	if (typeof budget === "number" && Number.isFinite(budget) && budget > 0) {
		return { thinking: true, thinkingBudgetTokens: budget }
	}
	if (effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh") {
		return { thinking: true, reasoningEffort: effort }
	}
	return {}
}

export async function buildSessionConfig(input: SessionConfigInput): Promise<CoreSessionConfig> {
	if (!input.cwd) {
		throw new Error("buildSessionConfig requires a cwd resolved by the host controller")
	}
	const cwd = input.cwd
	const workspaceRoot = input.workspaceRoot?.trim() || cwd
	const mode: Mode = input.mode ?? "act"
	const stateManager = StateManager.get()
	const apiConfiguration = stateManager.getApiConfiguration()
	const modelId = resolveModelId(apiConfiguration, mode)
	const sdkLogger = createSdkLogger()

	let systemPrompt: string
	try {
		systemPrompt = buildBedrockCoderSystemPrompt({
			ide: "VS Code",
			workspaceRoot,
			workspaceName: resolveWorkspaceName(workspaceRoot),
			mode: mode === "plan" ? "plan" : "act",
			platform: process.platform,
		})
	} catch (error) {
		Logger.warn("[SessionFactory] Failed to build system prompt, using minimal fallback:", error)
		systemPrompt = "You are Bedrock Coder, a highly skilled software engineer. Help the user with their request."
	}

	try {
		const preferredLanguage = getLanguageKey(
			stateManager.getGlobalSettingsKey("preferredLanguage") as LanguageDisplay | undefined,
		)
		if (preferredLanguage && preferredLanguage !== DEFAULT_LANGUAGE_SETTINGS) {
			systemPrompt = `${systemPrompt}\n\n# Preferred Language\n\nSpeak in ${preferredLanguage}.`
		}
	} catch (error) {
		Logger.warn("[SessionFactory] Failed to inject preferredLanguage instructions:", error)
	}

	const globalUseAutoCondense = stateManager.getGlobalSettingsKey("useAutoCondense") ?? false
	const useAutoCondense = input.taskSettings?.useAutoCondense ?? globalUseAutoCondense
	const enableCheckpoints = stateManager.getGlobalSettingsKey("enableCheckpointsSetting") ?? true
	const hostIdentity = await resolveHostIdentity()
	const isMultiRoot = await resolveIsMultiRootWorkspace()
	const configuredTeamConcurrency = vscode.workspace.getConfiguration("bedrockCoder").get<number>("maxConcurrentTeamRuns", 2)
	const maxConcurrentTeamRuns = Math.max(1, Math.min(8, Math.floor(configuredTeamConcurrency)))
	const executableExtensionsEnabled = vscode.workspace
		.getConfiguration("bedrockCoder")
		.get<boolean>("corporateAllowExecutableExtensions", false)
	if (!executableExtensionsEnabled) {
		Logger.log("[SessionFactory] Executable hooks/plugins are disabled by the corporate-safe default")
	}

	return {
		providerId: "bedrock",
		modelId,
		providerConfig: buildBedrockProviderConfig(apiConfiguration, modelId, workspaceRoot),
		cwd,
		workspaceRoot,
		systemPrompt,
		enableTools: true,
		checkpoint: { enabled: enableCheckpoints },
		enableSpawnAgent: false,
		enableAgentTeams: true,
		maxConcurrentTeamRuns,
		...(useAutoCondense ? { compaction: { enabled: true, strategy: readCompactionStrategyGlobally() } } : {}),
		disableMcpSettingsTools: true,
		mode: mode === "plan" ? "plan" : "act",
		...resolveReasoning(apiConfiguration, mode),
		maxIterations: undefined,
		logger: sdkLogger,
		extensionContext: {
			client: {
				name: hostIdentity?.bedrockCoderType || BedrockCoderClient.VSCode,
				version: hostIdentity?.bedrockCoderVersion || ExtensionRegistryInfo.version,
				platform: hostIdentity?.platform || undefined,
				platformVersion: hostIdentity?.version || undefined,
				isMultiRoot,
			},
			workspace: {
				rootPath: workspaceRoot,
				cwd,
				workspaceName: resolveWorkspaceName(workspaceRoot),
				ide: "VS Code",
				platform: process.platform,
				mode: mode === "plan" ? "plan" : "act",
			},
			logger: sdkLogger,
		},
		hooks: executableExtensionsEnabled ? buildAgentHooks(stateManager) : undefined,
	}
}

export function buildStartSessionInput(config: CoreSessionConfig, input: SessionConfigInput): BedrockCoderCoreStartInput {
	return {
		config,
		prompt: undefined,
		interactive: true,
		sessionMetadata: {
			schemaVersion: 2,
			mode: input.mode === "plan" ? "plan" : "act",
			outcome: "interrupted",
			workspace: {
				root: input.workspaceRoot?.trim() || input.cwd,
				repositoryRoot: input.cwd,
			},
			bedrockTarget: {
				invocationId: config.modelId,
				region:
					config.providerConfig &&
					typeof config.providerConfig === "object" &&
					"region" in config.providerConfig &&
					typeof config.providerConfig.region === "string"
						? config.providerConfig.region
						: undefined,
			},
		},
		userImages: input.images,
		userFiles: input.files,
	}
}

export function buildResumeSessionInput(
	sessionId: string,
	prompt: string,
	images?: string[],
	files?: string[],
): { sessionId: string; prompt: string; userImages?: string[]; userFiles?: string[] } {
	return { sessionId, prompt, userImages: images, userFiles: files }
}

export function createHistoryItemFromSession(sessionId: string, prompt: string, modelId?: string, cwd?: string): HistoryItem {
	return {
		id: sessionId,
		ts: Date.now(),
		task: prompt,
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		modelId,
		cwdOnTaskInitialization: cwd,
	}
}
