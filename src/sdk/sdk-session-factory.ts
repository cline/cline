import type { CoreSessionEvent, SessionHost } from "@clinebot/core"
import type { StateManager } from "@/core/storage/StateManager"
import type { McpHub } from "@/services/mcp/McpHub"
import { buildToolPolicies } from "./sdk-tool-policies"
import { VscodeSessionHost } from "./vscode-session-host"

export type RequestToolApprovalHandler = NonNullable<Parameters<typeof VscodeSessionHost.create>[0]["requestToolApproval"]>
export type AskQuestionHandler = NonNullable<Parameters<typeof VscodeSessionHost.create>[0]["askQuestion"]>

export interface SdkSessionFactoryOptions {
	stateManager: StateManager
	mcpHub: McpHub
	requestToolApproval: RequestToolApprovalHandler
	askQuestion: AskQuestionHandler
	onSessionEvent: (event: CoreSessionEvent) => void
}

export class SdkSessionFactory {
	constructor(private readonly options: SdkSessionFactoryOptions) {}

	async createAndStartSession(startInput: Parameters<VscodeSessionHost["start"]>[0]): Promise<{
		startResult: Awaited<ReturnType<VscodeSessionHost["start"]>>
		sessionManager: SessionHost
		unsubscribe: () => void
	}> {
		const autoApprovalSettings = this.options.stateManager.getGlobalSettingsKey("autoApprovalSettings")
		const toolPolicies = autoApprovalSettings ? buildToolPolicies(autoApprovalSettings, this.options.mcpHub) : undefined

		const sessionManager = await VscodeSessionHost.create({
			mcpHub: this.options.mcpHub,
			requestToolApproval: this.options.requestToolApproval,
			askQuestion: this.options.askQuestion,
			toolPolicies,
		})
		const unsubscribe = sessionManager.subscribe(this.options.onSessionEvent)
		const startResult = await sessionManager.start(startInput)

		return { startResult, sessionManager, unsubscribe }
	}
}
