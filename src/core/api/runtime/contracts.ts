import type { ApiProvider, RuntimeId } from "@shared/api"

export type RuntimeExecutionKind = "api" | "cli" | "control-plane" | "out-of-process"
export type RuntimeLifecycleStatus = "active" | "todo"

export interface RuntimeCapabilities {
	executionKind: RuntimeExecutionKind
	supportsStreaming: boolean
	supportsToolCalls: boolean
	supportsImages?: boolean
	supportsReasoning?: boolean
}

export interface RuntimeDefinition {
	runtimeId: RuntimeId
	legacyProvider: ApiProvider
	displayName: string
	capabilities: RuntimeCapabilities
	lifecycleStatus?: RuntimeLifecycleStatus
}
