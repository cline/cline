import {
	Agent,
	AgentSideConnection,
	CancelNotification,
	InitializeRequest,
	InitializeResponse,
	NewSessionRequest,
	NewSessionResponse,
	PromptRequest,
	PromptResponse,
	RequestError,
	SetSessionModeRequest,
	SetSessionModeResponse,
	type RequestPermissionResponse,
	type SessionNotification,
	type ContentBlock,
	ndJsonStream,
} from "@agentclientprotocol/sdk"
import { fileURLToPath } from "node:url"
import * as path from "node:path"
import { randomUUID } from "node:crypto"
import type { ExtensionContext } from "vscode"
import { initialize, tearDown } from "@/common"
import { Controller } from "@/core/controller"
import { getRequestRegistry } from "@/core/controller/grpc-handler"
import { subscribeToState } from "@/core/controller/state/subscribeToState"
import { subscribeToPartialMessage } from "@/core/controller/ui/subscribeToPartialMessage"
import { AuthHandler } from "@/hosts/external/AuthHandler"
import { ExternalCommentReviewController } from "@/hosts/external/ExternalCommentReviewController"
import { ExternalDiffViewProvider } from "@/hosts/external/ExternalDiffviewProvider"
import { ExternalWebviewProvider } from "@/hosts/external/ExternalWebviewProvider"
import { ExternalHostBridgeClientManager } from "@/hosts/external/host-bridge-client-manager"
import { HostProvider } from "@/hosts/host-provider"
import { StandaloneTerminalManager } from "@/integrations/terminal"
import type { ExtensionState, ClineMessage } from "@/shared/ExtensionMessage"
import { convertProtoToClineMessage } from "@/shared/proto-conversions/cline-message"
import { EmptyRequest } from "@/shared/proto/cline/common"
import { State } from "@/shared/proto/cline/state"
import type { ClineMessage as ProtoClineMessage } from "@/shared/proto/cline/ui"
import type { McpServerConfig } from "@/services/mcp/types"
import { waitForHostBridgeReady } from "@/standalone/hostbridge-client"
import { initializeContext } from "@/standalone/vscode-context"
import {
	buildModeState,
	buildNotificationsForMessage,
	buildNotificationsForPartialMessage,
	buildPermissionToolCall,
	buildToolCallDetailsFromMessage,
	createAcpConversionState,
	isPermissionAskType,
	resolveClineModeId,
	shouldSkipStateMessage,
} from "./convert"
import { nodeToWebReadable, nodeToWebWritable } from "./stdio"
import packageJson from "../../../package.json"

const PERMISSION_OPTIONS = [
	{ optionId: "allow", name: "Allow", kind: "allow_once" },
	{ optionId: "reject", name: "Reject", kind: "reject_once" },
	{ optionId: "allow_always", name: "Always Allow", kind: "allow_always" },
]

type ClineAcpRuntime = {
	controller: Controller
	dispose: () => Promise<void>
}

type SessionSubscriptions = {
	stateRequestId: string
	partialRequestId: string
}

type ClineAcpSession = {
	sessionId: string
	controller: Controller
	conversionState: ReturnType<typeof createAcpConversionState>
	lastMessageCount: number
	lastModeId: "plan" | "act"
	awaitingUserInput: boolean
	pendingAsk?: ClineMessage
	permissionRequests: Set<number>
	promptInFlight: boolean
	cancelled: boolean
	subscriptions: SessionSubscriptions
}

export class ClineAcpAgent implements Agent {
	private runtime?: ClineAcpRuntime
	private runtimePromise?: Promise<ClineAcpRuntime>
	private sessions = new Map<string, ClineAcpSession>()

	constructor(private client: AgentSideConnection) {}

	async initialize(request: InitializeRequest): Promise<InitializeResponse> {
		return {
			protocolVersion: 1,
			agentCapabilities: {
				promptCapabilities: {
					image: true,
					embeddedContext: true,
					audio: false,
				},
				mcpCapabilities: {
					http: true,
					sse: true,
				},
				sessionCapabilities: {},
			},
			agentInfo: {
				name: packageJson.name,
				title: "Cline",
				version: packageJson.version,
			},
			authMethods: [],
			_meta: request._meta ?? null,
		}
	}

	async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
		const runtime = await this.ensureRuntime(params.cwd)

		if (this.sessions.size > 0) {
			for (const sessionId of this.sessions.keys()) {
				await this.closeSession(sessionId)
			}
		}

		await this.configureMcpServers(runtime.controller, params.mcpServers)

		const sessionId = randomUUID()
		const initialMode = resolveClineModeId(runtime.controller.stateManager.getGlobalSettingsKey("mode"))
		const subscriptions = await this.attachSubscriptions(runtime.controller, sessionId)

		this.sessions.set(sessionId, {
			sessionId,
			controller: runtime.controller,
			conversionState: createAcpConversionState(),
			lastMessageCount: 0,
			lastModeId: initialMode,
			awaitingUserInput: false,
			permissionRequests: new Set(),
			promptInFlight: false,
			cancelled: false,
			subscriptions,
		})

		await this.warnIfCwdMismatch(params.cwd)

		return {
			sessionId,
			modes: buildModeState(initialMode),
		}
	}

	async prompt(params: PromptRequest): Promise<PromptResponse> {
		const session = this.getSession(params.sessionId)
		if (session.promptInFlight) {
			throw new Error("Prompt already in progress")
		}

		session.promptInFlight = true
		session.cancelled = false

		try {
			const { text, images, files } = extractPromptContent(params.prompt)
			const task = session.controller.task
			const isStreaming = task?.taskState.isStreaming || task?.taskState.isWaitingForFirstChunk

			if (session.pendingAsk && task) {
				session.awaitingUserInput = false
				session.pendingAsk = undefined
				await task.handleWebviewAskResponse("messageResponse", text, images, files)
			} else if (!task || !isStreaming) {
				await session.controller.initTask(text, images, files)
			} else {
				throw new Error("Task is busy; wait for the current turn to finish")
			}

			const stopReason = await this.waitForTurnCompletion(session)
			return { stopReason }
		} finally {
			session.promptInFlight = false
		}
	}

	async cancel(params: CancelNotification): Promise<void> {
		const session = this.getSession(params.sessionId)
		session.cancelled = true
		await session.controller.cancelTask()
	}

	async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
		const session = this.getSession(params.sessionId)
		const modeId = params.modeId === "act" ? "act" : "plan"
		await session.controller.togglePlanActMode(modeId)
		session.lastModeId = modeId
		await this.client.sessionUpdate({
			sessionId: session.sessionId,
			update: {
				sessionUpdate: "current_mode_update",
				currentModeId: modeId,
			},
		})
		return {}
	}

	private async ensureRuntime(cwd: string): Promise<ClineAcpRuntime> {
		if (this.runtime) {
			return this.runtime
		}
		if (!this.runtimePromise) {
			this.runtimePromise = this.createRuntime(cwd)
		}
		this.runtime = await this.runtimePromise
		return this.runtime
	}

	private async createRuntime(cwd: string): Promise<ClineAcpRuntime> {
		process.chdir(path.dirname(fileURLToPath(import.meta.url)))
		await waitForHostBridgeReady()

		const { extensionContext, DATA_DIR, EXTENSION_DIR } = initializeContext(undefined)
		this.setupHostProvider(extensionContext, EXTENSION_DIR, DATA_DIR)
		const webviewProvider = await initialize(extensionContext)
		AuthHandler.getInstance().setEnabled(true)

		return {
			controller: webviewProvider.controller,
			dispose: async () => {
				await tearDown()
			},
		}
	}

	private setupHostProvider(extensionContext: ExtensionContext, extensionDir: string, dataDir: string) {
		const createWebview = () => new ExternalWebviewProvider(extensionContext)
		const createDiffView = () => new ExternalDiffViewProvider()
		const createCommentReview = () => new ExternalCommentReviewController()
		const createTerminalManager = () => new StandaloneTerminalManager()
		const getCallbackUrl = async () => AuthHandler.getInstance().getCallbackUrl()
		const getBinaryLocation = async (name: string) => path.join(process.cwd(), name)

		HostProvider.initialize(
			createWebview,
			createDiffView,
			createCommentReview,
			createTerminalManager,
			new ExternalHostBridgeClientManager(),
			(...args: unknown[]) => console.error(...args),
			getCallbackUrl,
			getBinaryLocation,
			extensionDir,
			dataDir,
		)
	}

	private async configureMcpServers(controller: Controller, servers: NewSessionRequest["mcpServers"]) {
		if (!servers?.length) {
			return
		}
		const serverConfigs: Record<string, McpServerConfig> = {}
		for (const server of servers) {
			if ("type" in server && server.type && server.type !== "stdio") {
				const transportType = server.type === "http" ? "streamableHttp" : "sse"
				serverConfigs[server.name] = {
					type: transportType,
					url: server.url,
					headers: server.headers ? Object.fromEntries(server.headers.map((h) => [h.name, h.value])) : undefined,
				}
			} else {
				serverConfigs[server.name] = {
					type: "stdio",
					command: server.command,
					args: server.args,
					env: server.env ? Object.fromEntries(server.env.map((e) => [e.name, e.value])) : undefined,
				}
			}
		}

		await controller.mcpHub.updateServerConnectionsRPC(serverConfigs)
	}

	private async warnIfCwdMismatch(cwd: string) {
		try {
			const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
			const primary = workspacePaths.paths[0]
			if (primary && path.resolve(primary) !== path.resolve(cwd)) {
				console.error(
					`[cline-acp] Warning: ACP session cwd (${cwd}) does not match host bridge workspace (${primary}).`,
				)
			}
		} catch (error) {
			console.error("[cline-acp] Failed to check workspace paths:", error)
		}
	}

	private async attachSubscriptions(controller: Controller, sessionId: string): Promise<SessionSubscriptions> {
		const stateRequestId = `cline-acp-state-${sessionId}`
		const partialRequestId = `cline-acp-partial-${sessionId}`

		await subscribeToState(
			controller,
			EmptyRequest.create(),
			async (state: State) => {
				await this.handleStateUpdate(sessionId, state)
			},
			stateRequestId,
		)

		await subscribeToPartialMessage(
			controller,
			EmptyRequest.create(),
			async (message) => {
				await this.handlePartialMessage(sessionId, message)
			},
			partialRequestId,
		)

		return { stateRequestId, partialRequestId }
	}

	private async handleStateUpdate(sessionId: string, state: State) {
		const session = this.sessions.get(sessionId)
		if (!session || !state.stateJson) {
			return
		}

		let parsed: ExtensionState
		try {
			parsed = JSON.parse(state.stateJson) as ExtensionState
		} catch (error) {
			console.error("[cline-acp] Failed to parse state update:", error)
			return
		}

		const modeId = resolveClineModeId(parsed.mode)
		if (modeId !== session.lastModeId) {
			session.lastModeId = modeId
			await this.client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "current_mode_update",
					currentModeId: modeId,
				},
			})
		}

		const messages = parsed.clineMessages ?? []
		if (messages.length <= session.lastMessageCount) {
			return
		}

		const newMessages = messages.slice(session.lastMessageCount)
		session.lastMessageCount = messages.length

		for (const message of newMessages) {
			if (shouldSkipStateMessage(message, session.conversionState)) {
				continue
			}
			await this.handleAskMessage(session, message)
			await this.sendNotifications(sessionId, buildNotificationsForMessage(message, sessionId, session.conversionState))
		}
	}

	private async handlePartialMessage(sessionId: string, message: ProtoClineMessage) {
		const session = this.sessions.get(sessionId)
		if (!session) {
			return
		}
		const clineMessage = convertProtoToClineMessage(message)
		const notifications = buildNotificationsForPartialMessage(
			clineMessage,
			sessionId,
			session.conversionState,
			message.partial === false,
		)
		await this.sendNotifications(sessionId, notifications)
	}

	private async handleAskMessage(session: ClineAcpSession, message: ClineMessage) {
		if (message.type !== "ask") {
			return
		}
		if (isPermissionAskType(message.ask)) {
			await this.handlePermissionRequest(session, message)
			return
		}
		session.awaitingUserInput = true
		session.pendingAsk = message
	}

	private async handlePermissionRequest(session: ClineAcpSession, message: ClineMessage) {
		if (session.permissionRequests.has(message.ts)) {
			return
		}
		session.permissionRequests.add(message.ts)

		const details =
			buildToolCallDetailsFromMessage(message, session.conversionState, {
				toolCallPrefix: "cline-permission",
				fallbackTitle: "Permission required",
			}) ??
			buildToolCallDetailsFromMessage(
				{ ...message, type: "say", say: "command", text: message.text },
				session.conversionState,
				{ toolCallPrefix: "cline-permission", fallbackTitle: "Permission required" },
			)

		if (!details) {
			return
		}

		let response: RequestPermissionResponse
		try {
			response = await this.client.requestPermission({
				sessionId: session.sessionId,
				toolCall: buildPermissionToolCall(details),
				options: PERMISSION_OPTIONS,
			})
		} catch (error) {
			console.error("[cline-acp] Permission request failed:", error)
			return
		}

		if (response.outcome?.outcome === "cancelled" || session.cancelled) {
			session.cancelled = true
			await session.controller.cancelTask()
			return
		}

		const approved =
			response.outcome?.outcome === "selected" &&
			(response.outcome.optionId === "allow" || response.outcome.optionId === "allow_always")

		await session.controller.task?.handleWebviewAskResponse(approved ? "yesButtonClicked" : "noButtonClicked")
	}

	private async waitForTurnCompletion(session: ClineAcpSession): Promise<PromptResponse["stopReason"]> {
		while (true) {
			if (session.cancelled) {
				return "cancelled"
			}

			const task = session.controller.task
			if (!task) {
				return "end_turn"
			}

			if (session.awaitingUserInput) {
				return "end_turn"
			}

			if (!task.taskState.isStreaming && !task.taskState.isWaitingForFirstChunk) {
				return "end_turn"
			}

			await new Promise((resolve) => setTimeout(resolve, 100))
		}
	}

	private async sendNotifications(sessionId: string, notifications: SessionNotification[]) {
		for (const notification of notifications) {
			try {
				await this.client.sessionUpdate(notification)
			} catch (error) {
				console.error(`[cline-acp] Failed to send session update for ${sessionId}:`, error)
			}
		}
	}

	private async closeSession(sessionId: string) {
		const session = this.sessions.get(sessionId)
		if (!session) {
			return
		}
		getRequestRegistry().cancelRequest(session.subscriptions.stateRequestId)
		getRequestRegistry().cancelRequest(session.subscriptions.partialRequestId)
		await session.controller.clearTask()
		this.sessions.delete(sessionId)
	}

	private getSession(sessionId: string): ClineAcpSession {
		const session = this.sessions.get(sessionId)
		if (!session) {
			throw RequestError.invalidParams("Session not found")
		}
		return session
	}
}

export function runAcp() {
	const input = nodeToWebWritable(process.stdout)
	const output = nodeToWebReadable(process.stdin)
	const stream = ndJsonStream(input, output)
	new AgentSideConnection((client) => new ClineAcpAgent(client), stream)
}

function extractPromptContent(blocks: ContentBlock[]): { text: string; images: string[]; files: string[] } {
	const textParts: string[] = []
	const images: string[] = []
	const files: string[] = []
	const embeddedResources: string[] = []

	for (const block of blocks ?? []) {
		switch (block.type) {
			case "text":
				textParts.push(block.text)
				break
			case "image":
				if (block.data && block.mimeType) {
					images.push(`data:${block.mimeType};base64,${block.data}`)
				}
				break
			case "resource":
				if ("text" in block.resource && block.resource.text) {
					embeddedResources.push(
						`<file_content path="${block.resource.uri}">\n${block.resource.text}\n</file_content>`,
					)
				}
				break
			case "resource_link": {
				const filePath = resolveFilePath(block.uri)
				if (filePath) {
					files.push(filePath)
				} else {
					textParts.push(`Resource: ${block.uri}`)
				}
				break
			}
			default:
				break
		}
	}

	if (embeddedResources.length > 0) {
		textParts.push(`Embedded resources:\n\n${embeddedResources.join("\n\n")}`)
	}

	return {
		text: textParts.join("\n\n"),
		images,
		files,
	}
}

function resolveFilePath(uri: string): string | undefined {
	try {
		const url = new URL(uri)
		if (url.protocol === "file:") {
			return fileURLToPath(url)
		}
	} catch (_error) {
		if (path.isAbsolute(uri)) {
			return uri
		}
	}
	return undefined
}
