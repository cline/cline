import type { FutureRuntimeId } from "@shared/api"
import { FUTURE_RUNTIME_IDS } from "@shared/api"
import type { RuntimeCapabilities, RuntimeExecutionKind, RuntimeLifecycleStatus } from "./contracts"

export interface FutureRuntimeDescriptor {
	runtimeId: FutureRuntimeId
	displayName: string
	mvpStage: 2 | 3 | 4
	lifecycleStatus: RuntimeLifecycleStatus
	executionKind: RuntimeExecutionKind
	shimStrategy: "cli-wrapper" | "out-of-process"
	primaryUseCase: string
	capabilities: RuntimeCapabilities
}

const futureRuntimeDescriptors: FutureRuntimeDescriptor[] = [
	{
		runtimeId: "github-cli",
		displayName: "GitHub CLI Runtime",
		mvpStage: 3,
		lifecycleStatus: "todo",
		executionKind: "cli",
		shimStrategy: "cli-wrapper",
		primaryUseCase: "Todo-grade later candidate for GitHub-oriented agent workflows.",
		capabilities: {
			executionKind: "cli",
			supportsStreaming: true,
			supportsToolCalls: true,
			supportsReasoning: false,
		},
	},
	{
		runtimeId: "custom-langgraph-cli",
		displayName: "Custom LangGraph CLI Runtime",
		mvpStage: 4,
		lifecycleStatus: "todo",
		executionKind: "out-of-process",
		shimStrategy: "out-of-process",
		primaryUseCase: "Remote or sidecar LangGraph runtime behind the same translation boundary.",
		capabilities: {
			executionKind: "out-of-process",
			supportsStreaming: true,
			supportsToolCalls: true,
			supportsReasoning: true,
		},
	},
]

export const getFutureRuntimeDescriptors = (): FutureRuntimeDescriptor[] => futureRuntimeDescriptors

export const getFutureRuntimeDescriptor = (runtimeId: FutureRuntimeId): FutureRuntimeDescriptor => {
	const descriptor = futureRuntimeDescriptors.find((entry) => entry.runtimeId === runtimeId)
	if (!descriptor) {
		throw new Error(`Future runtime ${runtimeId} is not defined`)
	}

	return descriptor
}

export const validateFutureRuntimeDescriptorCoverage = (): true => {
	for (const runtimeId of FUTURE_RUNTIME_IDS) {
		getFutureRuntimeDescriptor(runtimeId)
	}

	return true
}
