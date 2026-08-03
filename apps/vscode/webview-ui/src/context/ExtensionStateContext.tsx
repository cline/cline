import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { type ClineMessage, DEFAULT_PLATFORM, type ExtensionState, type TurnState } from "@shared/ExtensionMessage"
import { DEFAULT_MCP_DISPLAY_MODE } from "@shared/McpDisplayMode"
import type { UserInfo } from "@shared/proto/cline/account"
import { EmptyRequest } from "@shared/proto/cline/common"
import type { OpenRouterCompatibleModelInfo, ProviderModelsResponse } from "@shared/proto/cline/models"
import { OnboardingModelGroup, type TerminalProfile } from "@shared/proto/cline/state"
import { LoadHistoryBatchRequest } from "@shared/proto/cline/task"
import { convertProtoToClineMessage } from "@shared/proto-conversions/cline-message"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { fromProtobufModels } from "@shared/proto-conversions/models/typeConversion"
import type React from "react"
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import {
	type ModelInfo,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
} from "../../../src/shared/api"
import { Environment } from "../../../src/shared/config-types"
import type { McpServer, McpViewTab } from "../../../src/shared/mcp"
import {
	createReplicaState,
	type ReplicaState,
	applyBatchPrepend as reducerApplyBatchPrepend,
	applyMessage as reducerApplyMessage,
	applyStateSnapshot as reducerApplyStateSnapshot,
} from "../components/chat/chat-view/messageReducer"
import {
	McpServiceClient,
	ModelsServiceClient,
	StateServiceClient,
	TaskServiceClient,
	UiServiceClient,
} from "../services/grpc-client"
import { createFrameCoalescer, type FrameCoalescer, scheduleAnimationFrame } from "../utils/messageFrameScheduler"

export type ProviderId = string

/**
 * High-frequency message state, decoupled from the low-frequency
 * ExtensionStateContext (V12 方案3 — fine-grained subscription).
 *
 * Streaming deltas, partial messages and transcript snapshots only update this
 * context, so settings/theme changes no longer re-render the message list and,
 * symmetrically, message updates no longer re-render settings/theme consumers.
 */
export interface MessagesState {
	clineMessages: ClineMessage[]
	turnState?: TurnState
	messageTruncated?: boolean
	totalMessageCount?: number
	/** Conversation/replica fence (see messageReducer.ts). */
	epoch: number
	/** Highest state snapshot version applied. */
	stateVersion: number
	/** True while older messages may still be loaded via loadHistoryBatch. */
	hasMoreMessages: boolean
	loadHistoryBatch: (taskId: string, beforeTs: number) => Promise<void>
}

/**
 * Low-frequency extension state. Message-transcript fields live in
 * MessagesStateContext (see above); they are excluded here so the main context
 * value stays stable while messages stream (V12 方案3).
 */
export type MainExtensionState = Omit<
	ExtensionState,
	"clineMessages" | "turnState" | "messageTruncated" | "totalMessageCount" | "epoch" | "stateVersion"
>

const MessagesStateContext = createContext<MessagesState | undefined>(undefined)

interface ProviderModelsState {
	providerId: ProviderId
	models: Record<string, ModelInfo>
	defaultModelId: string
	configFingerprint: string
	requestId: string
	source?: string
	fetchedAt: number
	isLoading: boolean
	isStale: boolean
	error?: string
}

export interface ExtensionStateContextType
	extends Omit<
		ExtensionState,
		"clineMessages" | "turnState" | "messageTruncated" | "totalMessageCount" | "epoch" | "stateVersion"
	> {
	didHydrateState: boolean
	showWelcome: boolean
	onboardingModels: OnboardingModelGroup | undefined
	openRouterModels: Record<string, ModelInfo>
	vercelAiGatewayModels: Record<string, ModelInfo>
	hicapModels: Record<string, ModelInfo>
	liteLlmModels: Record<string, ModelInfo>
	openAiModels: string[]
	requestyModels: Record<string, ModelInfo>
	groqModels: Record<string, ModelInfo>
	basetenModels: Record<string, ModelInfo>
	huggingFaceModels: Record<string, ModelInfo>
	providerModelsByProvider: Partial<Record<ProviderId, ProviderModelsState>>
	latestModelRequestIdByProvider: Partial<Record<ProviderId, string>>
	mcpServers: McpServer[]
	totalTasksSize: number | null
	lastDismissedCliBannerVersion: number
	dismissedBanners?: Array<{ bannerId: string; dismissedAt: number }>

	availableTerminalProfiles: TerminalProfile[]

	// View state
	showMarketplace: boolean
	showMcp: boolean
	mcpTab?: McpViewTab
	showSettings: boolean
	settingsTargetSection?: string
	settingsInitialModelTab?: "recommended" | "free"
	showHistory: boolean
	showAccount: boolean
	showWorktrees: boolean
	showAnnouncement: boolean
	expandTaskHeader: boolean

	// Setters
	setShowAnnouncement: (value: boolean) => void
	setShouldShowAnnouncement: (value: boolean) => void
	setMcpServers: (value: McpServer[]) => void
	setRequestyModels: (value: Record<string, ModelInfo>) => void
	setGroqModels: (value: Record<string, ModelInfo>) => void
	setBasetenModels: (value: Record<string, ModelInfo>) => void
	setHuggingFaceModels: (value: Record<string, ModelInfo>) => void
	setGlobalClineRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalClineRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalCursorRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalWindsurfRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalAgentsRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalWorkflowToggles: (toggles: Record<string, boolean>) => void
	setGlobalWorkflowToggles: (toggles: Record<string, boolean>) => void
	setGlobalSkillsToggles: (toggles: Record<string, boolean>) => void
	setLocalSkillsToggles: (toggles: Record<string, boolean>) => void
	setRemoteRulesToggles: (toggles: Record<string, boolean>) => void
	setRemoteWorkflowToggles: (toggles: Record<string, boolean>) => void
	setTotalTasksSize: (value: number | null) => void
	setExpandTaskHeader: (value: boolean) => void
	setShowWelcome: (value: boolean) => void
	setOnboardingModels: (value: OnboardingModelGroup | undefined) => void
	startProviderModelsRequest: (providerId: ProviderId, requestId: string) => void
	applyProviderModelsResponse: (response: ProviderModelsResponse) => void

	// Refresh functions
	refreshOpenRouterModels: () => void
	refreshVercelAiGatewayModels: () => void
	refreshHicapModels: () => void
	refreshLiteLlmModels: () => Promise<void>
	setUserInfo: (userInfo?: UserInfo) => void

	// Navigation state setters
	setShowMarketplace: (value: boolean) => void
	setShowMcp: (value: boolean) => void
	setMcpTab: (tab?: McpViewTab) => void

	// Navigation functions
	navigateToMarketplace: () => void
	navigateToMcp: (tab?: McpViewTab) => void
	navigateToSettings: (targetSection?: string) => void
	navigateToSettingsModelPicker: (opts: { targetSection?: string; initialModelTab?: "recommended" | "free" }) => void
	navigateToHistory: () => void
	navigateToAccount: () => void
	navigateToWorktrees: () => void
	navigateToChat: () => void

	// Hide functions
	hideSettings: () => void
	hideHistory: () => void
	hideAccount: () => void
	hideWorktrees: () => void
	hideAnnouncement: () => void
	closeMarketplaceView: () => void
	closeMcpView: () => void

	// Event callbacks
	onRelinquishControl: (callback: () => void) => () => void
}

export const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined)

export const ExtensionStateContextProvider: React.FC<{
	children: React.ReactNode
}> = ({ children }) => {
	// UI view state
	const [showMarketplace, setShowMarketplace] = useState(false)
	const [showMcp, setShowMcp] = useState(false)
	const [mcpTab, setMcpTab] = useState<McpViewTab | undefined>(undefined)
	const [showSettings, setShowSettings] = useState(false)
	const [settingsTargetSection, setSettingsTargetSection] = useState<string | undefined>(undefined)
	const [settingsInitialModelTab, setSettingsInitialModelTab] = useState<"recommended" | "free" | undefined>(undefined)
	const [showHistory, setShowHistory] = useState(false)
	const [showAccount, setShowAccount] = useState(false)
	const [showWorktrees, setShowWorktrees] = useState(false)
	const [showAnnouncement, setShowAnnouncement] = useState(false)

	// Helper for MCP view
	const closeMcpView = useCallback(() => {
		setShowMcp(false)
		setMcpTab(undefined)
	}, [setShowMcp, setMcpTab])
	const closeMarketplaceView = useCallback(() => {
		setShowMarketplace(false)
	}, [])

	// Hide functions
	const hideSettings = useCallback(() => {
		setShowSettings(false)
		setSettingsTargetSection(undefined)
		setSettingsInitialModelTab(undefined)
	}, [])
	const hideHistory = useCallback(() => setShowHistory(false), [setShowHistory])
	const hideAccount = useCallback(() => setShowAccount(false), [setShowAccount])
	const hideWorktrees = useCallback(() => setShowWorktrees(false), [setShowWorktrees])
	const hideAnnouncement = useCallback(() => setShowAnnouncement(false), [setShowAnnouncement])

	// Navigation functions
	const navigateToMcp = useCallback(
		(tab?: McpViewTab) => {
			setShowSettings(false)
			setShowHistory(false)
			setShowAccount(false)
			setShowWorktrees(false)
			closeMcpView()
			if (tab) {
				setMcpTab(tab)
			}
			setShowMarketplace(true)
		},
		[closeMcpView, setMcpTab, setShowSettings, setShowHistory, setShowAccount, setShowWorktrees],
	)

	const navigateToMarketplace = useCallback(() => {
		setShowSettings(false)
		closeMcpView()
		setShowHistory(false)
		setShowAccount(false)
		setShowWorktrees(false)
		setShowMarketplace(true)
	}, [closeMcpView])

	const navigateToSettings = useCallback(
		(targetSection?: string) => {
			closeMarketplaceView()
			setShowHistory(false)
			closeMcpView()
			setShowAccount(false)
			setShowWorktrees(false)
			setSettingsTargetSection(targetSection)
			setSettingsInitialModelTab(undefined)
			setShowSettings(true)
		},
		[closeMarketplaceView, closeMcpView],
	)

	const navigateToSettingsModelPicker = useCallback(
		(opts: { targetSection?: string; initialModelTab?: "recommended" | "free" }) => {
			closeMarketplaceView()
			setShowHistory(false)
			closeMcpView()
			setShowAccount(false)
			setShowWorktrees(false)
			setSettingsTargetSection(opts.targetSection)
			setSettingsInitialModelTab(opts.initialModelTab)
			setShowSettings(true)
		},
		[closeMarketplaceView, closeMcpView],
	)

	const navigateToHistory = useCallback(() => {
		closeMarketplaceView()
		setShowSettings(false)
		closeMcpView()
		setShowAccount(false)
		setShowWorktrees(false)
		setShowHistory(true)
	}, [closeMarketplaceView, setShowSettings, closeMcpView, setShowAccount, setShowWorktrees, setShowHistory])

	const navigateToAccount = useCallback(() => {
		closeMarketplaceView()
		setShowSettings(false)
		closeMcpView()
		setShowHistory(false)
		setShowWorktrees(false)
		setShowAccount(true)
	}, [closeMarketplaceView, setShowSettings, closeMcpView, setShowHistory, setShowWorktrees, setShowAccount])

	const navigateToWorktrees = useCallback(() => {
		closeMarketplaceView()
		setShowSettings(false)
		closeMcpView()
		setShowHistory(false)
		setShowAccount(false)
		setShowWorktrees(true)
	}, [closeMarketplaceView, setShowSettings, closeMcpView, setShowHistory, setShowAccount, setShowWorktrees])

	const navigateToChat = useCallback(() => {
		closeMarketplaceView()
		setShowSettings(false)
		closeMcpView()
		setShowHistory(false)
		setShowAccount(false)
		setShowWorktrees(false)
	}, [closeMarketplaceView, setShowSettings, closeMcpView, setShowHistory, setShowAccount, setShowWorktrees])

	const [state, setState] = useState<MainExtensionState>({
		version: "",
		queuedPrompts: [],
		taskHistory: undefined,
		shouldShowAnnouncement: false,
		autoApprovalSettings: DEFAULT_AUTO_APPROVAL_SETTINGS,
		browserSettings: DEFAULT_BROWSER_SETTINGS,
		preferredLanguage: "English",
		mode: "act",
		platform: DEFAULT_PLATFORM,
		environment: Environment.production,
		telemetrySetting: "unset",
		distinctId: "",
		planActSeparateModelsSetting: true,
		enableCheckpointsSetting: true,
		mcpDisplayMode: DEFAULT_MCP_DISPLAY_MODE,
		globalClineRulesToggles: {},
		localClineRulesToggles: {},
		localCursorRulesToggles: {},
		localWindsurfRulesToggles: {},
		localAgentsRulesToggles: {},
		localWorkflowToggles: {},
		globalWorkflowToggles: {},
		shellIntegrationTimeout: 4000,
		terminalReuseEnabled: true,
		vscodeTerminalExecutionMode: "backgroundExec",
		maxConsecutiveMistakes: 3,
		defaultTerminalProfile: "default",
		isNewUser: false,
		welcomeViewCompleted: false,
		onboardingModels: undefined,
		mcpResponsesCollapsed: false, // Default value (expanded), will be overwritten by extension state
		yoloModeToggled: false,
		customPrompt: undefined,
		useAutoCondense: false,
		compactionStrategy: "basic",
		subagentsEnabled: false,
		worktreesEnabled: { user: true, featureFlag: false },
		favoritedModelIds: [],
		lastDismissedInfoBannerVersion: 0,
		lastDismissedModelBannerVersion: 0,
		optOutOfRemoteConfig: false,
		remoteConfigSettings: {},
		backgroundCommandRunning: false,
		backgroundCommandTaskId: undefined,
		foregroundCommandRunning: false,
		lastDismissedCliBannerVersion: 0,
		backgroundEditEnabled: false,
		showFeatureTips: true,
		globalSkillsToggles: {},
		localSkillsToggles: {},

		// NEW: Add workspace information with defaults
		workspaceRoots: [],
		primaryRootIndex: 0,
		isMultiRootWorkspace: false,
		multiRootSetting: { user: false, featureFlag: false },
		hooksEnabled: false,
	})
	const [expandTaskHeader, setExpandTaskHeader] = useState(true)
	const [didHydrateState, setDidHydrateState] = useState(false)

	const [showWelcome, setShowWelcome] = useState(false)
	const [onboardingModels, setOnboardingModels] = useState<OnboardingModelGroup | undefined>(undefined)

	const [openRouterModels, setOpenRouterModels] = useState<Record<string, ModelInfo>>({
		[openRouterDefaultModelId]: openRouterDefaultModelInfo,
	})
	const [vercelAiGatewayModels, setVercelAiGatewayModels] = useState<Record<string, ModelInfo>>({})
	const [hicapModels, setHicapModels] = useState<Record<string, ModelInfo>>({})
	const [liteLlmModels, setLiteLlmModels] = useState<Record<string, ModelInfo>>({})
	const [totalTasksSize, setTotalTasksSize] = useState<number | null>(null)
	const [availableTerminalProfiles, setAvailableTerminalProfiles] = useState<TerminalProfile[]>([])

	const [openAiModels, _setOpenAiModels] = useState<string[]>([])
	const [requestyModels, setRequestyModels] = useState<Record<string, ModelInfo>>({
		[requestyDefaultModelId]: requestyDefaultModelInfo,
	})
	// Groq and Baseten model lists start empty. The pickers populate them
	// from two sources: the SDK catalog over gRPC (`useProviderModels`)
	// for the curated set, and the host-side refresh RPCs
	// (`ModelsServiceClient.refreshGroqModelsRpc`,
	// `ModelsServiceClient.refreshBasetenModels`) for any models the
	// live API exposes on top of the SDK catalog.
	const [groqModelsState, setGroqModels] = useState<Record<string, ModelInfo>>({})
	const [basetenModelsState, setBasetenModels] = useState<Record<string, ModelInfo>>({})
	const [huggingFaceModels, setHuggingFaceModels] = useState<Record<string, ModelInfo>>({})
	const [providerModelsByProvider, setProviderModelsByProvider] = useState<Partial<Record<ProviderId, ProviderModelsState>>>({})
	const [latestModelRequestIdByProvider, setLatestModelRequestIdByProvider] = useState<Partial<Record<ProviderId, string>>>({})
	const latestModelRequestIdByProviderRef = useRef<Partial<Record<ProviderId, string>>>({})
	const [mcpServers, setMcpServers] = useState<McpServer[]>([])

	const startProviderModelsRequest = useCallback((providerId: ProviderId, requestId: string) => {
		latestModelRequestIdByProviderRef.current = { ...latestModelRequestIdByProviderRef.current, [providerId]: requestId }
		setLatestModelRequestIdByProvider((prev) => ({ ...prev, [providerId]: requestId }))
		setProviderModelsByProvider((prev) => ({
			...prev,
			[providerId]: {
				...(prev[providerId] ?? {
					providerId,
					models: {},
					defaultModelId: "",
					configFingerprint: "",
					fetchedAt: 0,
					isStale: false,
				}),
				providerId,
				requestId,
				isLoading: true,
				error: undefined,
			},
		}))
	}, [])

	const applyProviderModelsResponse = useCallback((response: ProviderModelsResponse) => {
		setProviderModelsByProvider((prevModels) => {
			const latestRequestId = latestModelRequestIdByProviderRef.current[response.providerId]
			if (latestRequestId !== response.requestId) {
				console.debug("Dropping stale provider models response", {
					providerId: response.providerId,
					requestId: response.requestId,
					latestRequestId,
				})
				return prevModels
			}

			return {
				...prevModels,
				[response.providerId]: {
					providerId: response.providerId,
					models: response.ok ? fromProtobufModels(response.models) : {},
					defaultModelId: response.defaultModelId ?? "",
					configFingerprint: response.configFingerprint,
					requestId: response.requestId,
					source: response.source,
					fetchedAt: response.fetchedAt,
					isLoading: false,
					isStale: false,
					error: response.ok ? undefined : response.error?.message,
				},
			}
		})
	}, [])

	/**
	 * Track the last applied state version so we can detect gaps in delta
	 * messages and request a full-sync fallback from the backend.
	 */
	const lastStateVersionRef = useRef(0)

	/**
	 * Request a full state snapshot from the backend via the streaming subscription.
	 * This is the self-healing fallback when the webview detects a gap in deltas.
	 */
	const requestFullSync = useCallback(() => {
		stateSubscriptionRef.current?.()
		stateSubscriptionRef.current = StateServiceClient.subscribeToState(EmptyRequest.create({}), {
			onResponse: (response: any) => {
				if (response.stateJson) {
					try {
						const stateData = JSON.parse(response.stateJson) as ExtensionState
						const incomingStateVersion = stateData.stateVersion ?? 0

						// Route the snapshot's transcript through the convergent-replica reducer:
						// merge by ts/seq within the same epoch (never truncate), replace on a
						// newer epoch, ignore stale/older snapshots. Pagination metadata
						// travels with the snapshot so it is owned/reset by the conversation fence.
						const prevEpoch = replicaRef.current.epoch
						replicaRef.current = reducerApplyStateSnapshot(
							replicaRef.current,
							stateData.clineMessages ?? [],
							stateData.epoch ?? 0,
							incomingStateVersion,
							stateData.turnState,
							stateData.messageTruncated,
							stateData.totalMessageCount,
						)
						if (replicaRef.current.epoch !== prevEpoch) {
							setHasMoreMessages(true)
						}

						// Publish the (seq-gated) transcript + pagination metadata through the
						// high-frequency messages context (V12 方案3).
						publishReplica()

						const {
							clineMessages: _clineMessages,
							turnState: _turnState,
							epoch: _epoch,
							stateVersion: _stateVersion,
							...restStateData
						} = stateData
						setState((prevState) => {
							const incomingVersion = stateData.autoApprovalSettings?.version ?? 1
							const currentVersion = prevState.autoApprovalSettings?.version ?? 1
							const shouldUpdateAutoApproval = incomingVersion > currentVersion
							const newState = {
								...restStateData,
								autoApprovalSettings: shouldUpdateAutoApproval
									? stateData.autoApprovalSettings
									: prevState.autoApprovalSettings,
							}
							if (!newState.welcomeViewCompleted && !showWelcome) {
								setShowWelcome(true)
								setOnboardingModels(newState.onboardingModels)
							} else if (newState.welcomeViewCompleted) {
								setShowWelcome(false)
								setOnboardingModels(undefined)
							}
							setDidHydrateState(true)
							return newState
						})
						lastStateVersionRef.current = incomingStateVersion
					} catch (error) {
						console.error("Error parsing state JSON during full sync:", error)
					}
				}
			},
			onError: (error: any) => {
				console.error("Error in full sync state subscription:", error)
			},
			onComplete: () => {
				console.log("Full sync state subscription completed")
			},
		})
	}, [showWelcome])

	// References to store subscription cancellation functions
	const stateSubscriptionRef = useRef<(() => void) | null>(null)

	const marketplaceButtonUnsubscribeRef = useRef<(() => void) | null>(null)
	const mcpButtonUnsubscribeRef = useRef<(() => void) | null>(null)
	const historyButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const chatButtonUnsubscribeRef = useRef<(() => void) | null>(null)
	const accountButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const settingsButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const worktreesButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const partialMessageUnsubscribeRef = useRef<(() => void) | null>(null)
	const openRouterModelsUnsubscribeRef = useRef<(() => void) | null>(null)
	const liteLlmModelsUnsubscribeRef = useRef<(() => void) | null>(null)
	const workspaceUpdatesUnsubscribeRef = useRef<(() => void) | null>(null)
	const relinquishControlUnsubscribeRef = useRef<(() => void) | null>(null)

	// Add ref for callbacks
	const relinquishControlCallbacks = useRef<Set<() => void>>(new Set())

	// Create hook function
	const onRelinquishControl = useCallback((callback: () => void) => {
		relinquishControlCallbacks.current.add(callback)
		return () => {
			relinquishControlCallbacks.current.delete(callback)
		}
	}, [])
	const mcpServersSubscriptionRef = useRef<(() => void) | null>(null)
	// Convergent-replica state for clineMessages. The partial-message stream and the full state
	// snapshots both feed this reducer so the transcript converges correctly regardless of
	// arrival order, duplication, or loss. See messageReducer.ts.
	const replicaRef = useRef<ReplicaState>(createReplicaState())

	/**
	 * React state mirror of the replica, published through MessagesStateContext
	 * (V12 方案3). Kept separate from the main ExtensionState so high-frequency
	 * message traffic does not re-render settings/theme consumers.
	 */
	const [replicaMessages, setReplicaMessages] = useState<{
		clineMessages: ClineMessage[]
		turnState?: TurnState
		epoch: number
		stateVersion: number
		messageTruncated?: boolean
		totalMessageCount?: number
	}>({
		clineMessages: [],
		epoch: 0,
		stateVersion: 0,
	})

	// Frame-coalesced publish (V12 方案6): deltas/partials/snapshots arriving
	// within a single animation frame are merged into ONE setReplicaMessages,
	// so streaming bursts do not render intermediate frames.
	const messageFlushSchedulerRef = useRef<FrameCoalescer | null>(null)
	/**
	 * Publish the current replica to the messages context. Only triggers a
	 * re-render when the transcript actually changed (reference comparison —
	 * the reducer returns the same object for no-op merges). Pagination
	 * metadata (messageTruncated / totalMessageCount) is owned by the replica
	 * itself (see messageReducer.ts), so it resets automatically on task
	 * switch instead of leaking stale values from the previous conversation.
	 */
	const publishReplica = useCallback(() => {
		if (!messageFlushSchedulerRef.current) {
			messageFlushSchedulerRef.current = createFrameCoalescer(() => {
				const replica = replicaRef.current
				setReplicaMessages((prev) => {
					const transcriptChanged =
						prev.clineMessages !== replica.messages ||
						prev.turnState !== replica.turnState ||
						prev.epoch !== replica.epoch ||
						prev.stateVersion !== replica.stateVersion ||
						prev.messageTruncated !== replica.messageTruncated ||
						prev.totalMessageCount !== replica.totalMessageCount
					if (!transcriptChanged) {
						return prev
					}
					return {
						clineMessages: replica.messages,
						turnState: replica.turnState,
						epoch: replica.epoch,
						stateVersion: replica.stateVersion,
						messageTruncated: replica.messageTruncated,
						totalMessageCount: replica.totalMessageCount,
					}
				})
			}, scheduleAnimationFrame)
		}
		messageFlushSchedulerRef.current.schedule()
	}, [])

	// Subscribe to state updates and UI events using the gRPC streaming API
	useEffect(() => {
		// Set up state subscription
		stateSubscriptionRef.current = StateServiceClient.subscribeToState(EmptyRequest.create({}), {
			onResponse: (response: any) => {
				// CHANNEL 1: Full state snapshot (ground truth — replaces everything)
				if (response.stateJson) {
					try {
						const stateData = JSON.parse(response.stateJson) as ExtensionState
						const incomingStateVersion = stateData.stateVersion ?? 0

						// Route the snapshot's transcript through the convergent-replica reducer:
						// merge by ts/seq within the same epoch (never truncate), replace on a
						// newer epoch, ignore stale/older snapshots. Pagination metadata
						// travels with the snapshot so it is owned/reset by the conversation fence.
						const prevEpoch = replicaRef.current.epoch
						replicaRef.current = reducerApplyStateSnapshot(
							replicaRef.current,
							stateData.clineMessages ?? [],
							stateData.epoch ?? 0,
							incomingStateVersion,
							stateData.turnState,
							stateData.messageTruncated,
							stateData.totalMessageCount,
						)
						if (replicaRef.current.epoch !== prevEpoch) {
							setHasMoreMessages(true)
						}
						
						// Publish the (seq-gated) transcript + pagination metadata through the
						// high-frequency messages context (V12 方案3).
						publishReplica()

						const {
							clineMessages: _clineMessages,
							turnState: _turnState,
							epoch: _epoch,
							stateVersion: _stateVersion,
							...restStateData
						} = stateData

						setState((prevState) => {
							// Versioning logic for autoApprovalSettings
							const incomingVersion = stateData.autoApprovalSettings?.version ?? 1
							const currentVersion = prevState.autoApprovalSettings?.version ?? 1
							const shouldUpdateAutoApproval = incomingVersion > currentVersion

							const newState = {
								...restStateData,
								autoApprovalSettings: shouldUpdateAutoApproval
									? stateData.autoApprovalSettings
									: prevState.autoApprovalSettings,
							}

							// Update welcome screen state based on API configuration if welcome view not in progress
							if (!newState.welcomeViewCompleted && !showWelcome) {
								setShowWelcome(true)
								setOnboardingModels(newState.onboardingModels)
							} else if (newState.welcomeViewCompleted) {
								setShowWelcome(false)
								setOnboardingModels(undefined)
							}

							setDidHydrateState(true)

							return newState
						})

						lastStateVersionRef.current = incomingStateVersion
					} catch (error) {
						console.error("Error parsing state JSON:", error)
					}
					return
				}

				// CHANNEL 2: State delta (incremental update — patch only changed fields)
				// The backend sends `{ type, payload, version }` where payload is the StateDelta
				// from state-post-debouncer: `{ type: "append_message", message, version }` or
				// `{ type: "update_message", messageId, patch, version }`.
				if (response.deltaJson) {
					try {
						const raw = JSON.parse(response.deltaJson)
						const deltaVersion = raw.version ?? 0

						// Self-healing: if we missed a delta (gap in version), request full sync
						if (lastStateVersionRef.current > 0 && deltaVersion > lastStateVersionRef.current + 1) {
							console.warn(
								`[StateDelta] Gap detected: last=${lastStateVersionRef.current}, delta=${deltaVersion}. Requesting full sync.`,
							)
							requestFullSync()
							return
						}

						if (deltaVersion > 0) {
							lastStateVersionRef.current = deltaVersion
						}

						const inner = raw.payload
						switch (raw.type) {
							case "append_message":
								if (inner?.message) {
									const before = replicaRef.current
									const next = reducerApplyMessage(before, inner.message)
									if (next !== before) {
										replicaRef.current = next
										publishReplica()
									}
								}
								break

							case "update_message":
								// Extract messageId (ts) and patch from the inner delta
								if (inner?.messageId) {
									const patchMessage = { ts: inner.messageId, ...inner.patch }
									const before = replicaRef.current
									const next = reducerApplyMessage(before, patchMessage as any)
									if (next !== before) {
										replicaRef.current = next
										publishReplica()
									}
								}
								break

							case "replace_all":
								// Settings/state replacement — the message transcript is not part of
								// the main state, so a plain spread suffices.
								setState((prevState) => ({ ...prevState, ...inner }))
								break

							default:
								console.warn("[StateDelta] Unknown delta type:", raw.type)
						}
					} catch (error) {
						console.error("Error processing state delta:", error)
					}
					return
				}
			},
			onError: (error: any) => {
				console.error("Error in state subscription:", error)
			},
			onComplete: () => {
				console.log("State subscription completed")
			},
		})

		// Subscribe to MCP button clicked events with webview type
		mcpButtonUnsubscribeRef.current = UiServiceClient.subscribeToMcpButtonClicked(
			{},
			{
				onResponse: () => {
					navigateToMarketplace()
				},
				onError: (error: any) => {
					console.error("Error in mcpButtonClicked subscription:", error)
				},
				onComplete: () => {
					console.log("mcpButtonClicked subscription completed")
				},
			},
		)

		marketplaceButtonUnsubscribeRef.current = UiServiceClient.subscribeToMarketplaceButtonClicked(EmptyRequest.create({}), {
			onResponse: () => {
				navigateToMarketplace()
			},
			onError: (error: any) => {
				console.error("Error in marketplaceButtonClicked subscription:", error)
			},
			onComplete: () => {
				console.log("marketplaceButtonClicked subscription completed")
			},
		})

		// Set up history button clicked subscription with webview type
		historyButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToHistoryButtonClicked(
			{},
			{
				onResponse: () => {
					// When history button is clicked, navigate to history view
					navigateToHistory()
				},
				onError: (error: any) => {
					console.error("Error in history button clicked subscription:", error)
				},
				onComplete: () => {
					console.log("History button clicked subscription completed")
				},
			},
		)

		// Subscribe to chat button clicked events with webview type
		chatButtonUnsubscribeRef.current = UiServiceClient.subscribeToChatButtonClicked(
			{},
			{
				onResponse: () => {
					// When chat button is clicked, navigate to chat
					navigateToChat()
				},
				onError: (error: any) => {
					console.error("Error in chat button subscription:", error)
				},
				onComplete: () => {},
			},
		)

		// Subscribe to MCP servers updates
		mcpServersSubscriptionRef.current = McpServiceClient.subscribeToMcpServers(EmptyRequest.create(), {
			onResponse: (response: any) => {
				if (response.mcpServers) {
					setMcpServers(convertProtoMcpServersToMcpServers(response.mcpServers))
				}
			},
			onError: (error: any) => {
				console.error("Error in MCP servers subscription:", error)
			},
			onComplete: () => {
				console.log("MCP servers subscription completed")
			},
		})

		// Set up settings button clicked subscription
		settingsButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToSettingsButtonClicked(EmptyRequest.create({}), {
			onResponse: () => {
				// When settings button is clicked, navigate to settings
				navigateToSettings()
			},
			onError: (error: any) => {
				console.error("Error in settings button clicked subscription:", error)
			},
			onComplete: () => {
				console.log("Settings button clicked subscription completed")
			},
		})

		// Set up worktrees button clicked subscription
		worktreesButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToWorktreesButtonClicked(
			EmptyRequest.create({}),
			{
				onResponse: () => {
					// When worktrees button is clicked, navigate to worktrees
					navigateToWorktrees()
				},
				onError: (error: any) => {
					console.error("Error in worktrees button clicked subscription:", error)
				},
				onComplete: () => {
					console.log("Worktrees button clicked subscription completed")
				},
			},
		)

		// Subscribe to partial message events
		partialMessageUnsubscribeRef.current = UiServiceClient.subscribeToPartialMessage(EmptyRequest.create({}), {
			onResponse: (protoMessage: any) => {
				try {
					// Validate critical fields
					if (!protoMessage.ts || protoMessage.ts <= 0) {
						console.error("Invalid timestamp in partial message:", protoMessage)
						return
					}

					const partialMessage = convertProtoToClineMessage(protoMessage)
					// Route through the convergent-replica reducer: merge by ts keeping the
					// higher seq, fence stale epochs, never let an out-of-order or duplicate
					// delivery corrupt the transcript. Unstamped (classic/legacy) messages
					// default to epoch 0 and merge by ts as before.
					const before = replicaRef.current
					const next = reducerApplyMessage(before, partialMessage)
					if (next !== before) {
						// Stale/ignored — no change.
						replicaRef.current = next
						publishReplica()
					}
				} catch (error) {
					console.error("Failed to process partial message:", error, protoMessage)
				}
			},
			onError: (error: any) => {
				console.error("Error in partialMessage subscription:", error)
			},
			onComplete: () => {},
		})

		// Subscribe to OpenRouter models updates
		openRouterModelsUnsubscribeRef.current = ModelsServiceClient.subscribeToOpenRouterModels(EmptyRequest.create({}), {
			onResponse: (response: OpenRouterCompatibleModelInfo) => {
				const models = fromProtobufModels(response.models)
				setOpenRouterModels({
					[openRouterDefaultModelId]: openRouterDefaultModelInfo, // in case the extension sent a model list without the default model
					...models,
				})
			},
			onError: (error: any) => {
				console.error("Error in OpenRouter models subscription:", error)
			},
			onComplete: () => {
				console.log("OpenRouter models subscription completed")
			},
		})

		// Subscribe to LiteLLM models updates
		liteLlmModelsUnsubscribeRef.current = ModelsServiceClient.subscribeToLiteLlmModels(EmptyRequest.create({}), {
			onResponse: (response: OpenRouterCompatibleModelInfo) => {
				const models = fromProtobufModels(response.models)
				setLiteLlmModels(models)
			},
			onError: (error: any) => {
				console.error("Error in LiteLLM models subscription:", error)
			},
			onComplete: () => {
				console.log("LiteLLM models subscription completed")
			},
		})

		// Initialize webview using gRPC
		UiServiceClient.initializeWebview(EmptyRequest.create({})).catch((error) => {
			console.error("Failed to initialize webview via gRPC:", error)
		})

		// Set up account button clicked subscription
		accountButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToAccountButtonClicked(EmptyRequest.create(), {
			onResponse: () => {
				// When account button is clicked, navigate to account view
				navigateToAccount()
			},
			onError: (error: any) => {
				console.error("Error in account button clicked subscription:", error)
			},
			onComplete: () => {
				console.log("Account button clicked subscription completed")
			},
		})

		// Fetch available terminal profiles on launch
		StateServiceClient.getAvailableTerminalProfiles(EmptyRequest.create({}))
			.then((response) => {
				setAvailableTerminalProfiles(response.profiles)
			})
			.catch((error) => {
				console.error("Failed to fetch available terminal profiles:", error)
			})

		// Subscribe to relinquish control events
		relinquishControlUnsubscribeRef.current = UiServiceClient.subscribeToRelinquishControl(EmptyRequest.create({}), {
			onResponse: () => {
				// Call all registered callbacks
				relinquishControlCallbacks.current.forEach((callback) => {
					callback()
				})
			},
			onError: (error: any) => {
				console.error("Error in relinquishControl subscription:", error)
			},
			onComplete: () => {},
		})

		// Clean up subscriptions when component unmounts
		return () => {
			// Reset the delta version counter so re-mount starts fresh; otherwise
			// a stale high-water mark from a previous lifecycle would trigger a
			// spurious gap detection on the very first delta after reconnection.
			lastStateVersionRef.current = 0
			// Cancel any pending frame-coalesced message flush.
			messageFlushSchedulerRef.current?.cancel()
			messageFlushSchedulerRef.current = null
			if (stateSubscriptionRef.current) {
				stateSubscriptionRef.current()
				stateSubscriptionRef.current = null
			}
			if (mcpButtonUnsubscribeRef.current) {
				mcpButtonUnsubscribeRef.current()
				mcpButtonUnsubscribeRef.current = null
			}
			if (marketplaceButtonUnsubscribeRef.current) {
				marketplaceButtonUnsubscribeRef.current()
				marketplaceButtonUnsubscribeRef.current = null
			}
			if (historyButtonClickedSubscriptionRef.current) {
				historyButtonClickedSubscriptionRef.current()
				historyButtonClickedSubscriptionRef.current = null
			}
			if (chatButtonUnsubscribeRef.current) {
				chatButtonUnsubscribeRef.current()
				chatButtonUnsubscribeRef.current = null
			}
			if (accountButtonClickedSubscriptionRef.current) {
				accountButtonClickedSubscriptionRef.current()
				accountButtonClickedSubscriptionRef.current = null
			}
			if (settingsButtonClickedSubscriptionRef.current) {
				settingsButtonClickedSubscriptionRef.current()
				settingsButtonClickedSubscriptionRef.current = null
			}
			if (worktreesButtonClickedSubscriptionRef.current) {
				worktreesButtonClickedSubscriptionRef.current()
				worktreesButtonClickedSubscriptionRef.current = null
			}
			if (partialMessageUnsubscribeRef.current) {
				partialMessageUnsubscribeRef.current()
				partialMessageUnsubscribeRef.current = null
			}
			if (openRouterModelsUnsubscribeRef.current) {
				openRouterModelsUnsubscribeRef.current()
				openRouterModelsUnsubscribeRef.current = null
			}
			if (liteLlmModelsUnsubscribeRef.current) {
				liteLlmModelsUnsubscribeRef.current()
				liteLlmModelsUnsubscribeRef.current = null
			}
			if (workspaceUpdatesUnsubscribeRef.current) {
				workspaceUpdatesUnsubscribeRef.current()
				workspaceUpdatesUnsubscribeRef.current = null
			}
			if (relinquishControlUnsubscribeRef.current) {
				relinquishControlUnsubscribeRef.current()
				relinquishControlUnsubscribeRef.current = null
			}
			if (mcpServersSubscriptionRef.current) {
				mcpServersSubscriptionRef.current()
				mcpServersSubscriptionRef.current = null
			}
		}
	}, [])

	const refreshOpenRouterModels = useCallback(() => {
		ModelsServiceClient.refreshOpenRouterModelsRpc(EmptyRequest.create({}))
			.then((response: OpenRouterCompatibleModelInfo) => {
				const models = fromProtobufModels(response.models)
				setOpenRouterModels({
					[openRouterDefaultModelId]: openRouterDefaultModelInfo, // in case the extension sent a model list without the default model
					...models,
				})
			})
			.catch((error: Error) => console.error("Failed to refresh OpenRouter models:", error))
	}, [])

	const refreshHicapModels = useCallback(() => {
		ModelsServiceClient.refreshHicapModels(EmptyRequest.create({}))
			.then((response: OpenRouterCompatibleModelInfo) => {
				const models = response.models
				setHicapModels({
					...models,
				})
			})
			.catch((error: Error) => console.error("Failed to refresh Hicap models:", error))
	}, [])

	const refreshLiteLlmModels = useCallback(() => {
		return ModelsServiceClient.refreshLiteLlmModelsRpc(EmptyRequest.create({}))
			.then((response: OpenRouterCompatibleModelInfo) => {
				const models = fromProtobufModels(response.models)
				setLiteLlmModels(models)
			})
			.catch((error: Error) => console.error("Failed to refresh LiteLLM models:", error))
	}, [])

	const refreshBasetenModels = useCallback(() => {
		ModelsServiceClient.refreshBasetenModelsRpc(EmptyRequest.create({}))
			.then((response) => {
				// Live-fetched Baseten models. The SDK-curated catalog is
				// pulled separately by BasetenModelPicker via
				// `useProviderModels("baseten")` and merged on top of this
				// dynamic slice at render time.
				setBasetenModels(fromProtobufModels(response.models))
			})
			.catch((err) => console.error("Failed to refresh Baseten models:", err))
	}, [])

	const refreshVercelAiGatewayModels = useCallback(() => {
		ModelsServiceClient.refreshVercelAiGatewayModelsRpc(EmptyRequest.create({}))
			.then((response: OpenRouterCompatibleModelInfo) => {
				const models = fromProtobufModels(response.models)
				setVercelAiGatewayModels(models)
			})
			.catch((error: Error) => console.error("Failed to refresh Vercel AI Gateway models:", error))
	}, [])

	// Auto-refresh model lists on API key availability
	useEffect(() => {
		if (!openRouterModels || Object.keys(openRouterModels).length <= 1) {
			refreshOpenRouterModels()
		}
		if (!vercelAiGatewayModels || Object.keys(vercelAiGatewayModels).length === 0) {
			refreshVercelAiGatewayModels()
		}
		if (state.apiConfiguration?.basetenApiKey) {
			refreshBasetenModels()
		}
		if (state.apiConfiguration?.liteLlmApiKey) {
			refreshLiteLlmModels()
		}
	}, [
		refreshOpenRouterModels,
		refreshVercelAiGatewayModels,
		state?.apiConfiguration?.basetenApiKey,
		refreshBasetenModels,
		state?.apiConfiguration?.liteLlmApiKey,
		refreshLiteLlmModels,
	])

	const [hasMoreMessages, setHasMoreMessages] = useState(true)

	/**
	 * Load a batch of older messages when scrolling up past the truncation window.
	 * Calls the backend's loadHistoryBatch RPC and prepends the batch to the
	 * message replica via reducerApplyBatchPrepend.
	 */
	const loadHistoryBatch = useCallback(
		async (taskId: string, beforeTs: number) => {
			if (!taskId || taskId === "") {
				console.warn("[loadHistoryBatch] No taskId provided, skipping")
				return
			}
			try {
				const response = await TaskServiceClient.loadHistoryBatch(
					LoadHistoryBatchRequest.create({
						taskId,
						beforeTs,
						limit: 50,
					}),
				)
				if (!response.messages || response.messages.length === 0) {
					// No more messages available
					setHasMoreMessages(false)
					return
				}

				// Convert protobuf messages to ClineMessage[]
				const incoming = response.messages.map(convertProtoToClineMessage).filter(Boolean) as ClineMessage[]

				// Apply batch prepend to the replica
				replicaRef.current = reducerApplyBatchPrepend(replicaRef.current, incoming, undefined, response.totalCount)

				// Publish the merged transcript + pagination metadata through the messages context
				publishReplica()

				// Update hasMore flag from response
				if (response.hasMore !== undefined) {
					setHasMoreMessages(response.hasMore)
				}
			} catch (error) {
				console.error("[loadHistoryBatch] Error loading history batch:", error)
			}
		},
		[], // stable — no external deps; uses refs internally
	)

	const contextValue: ExtensionStateContextType = {
		...state,
		didHydrateState,
		showWelcome,
		onboardingModels,
		openRouterModels,
		vercelAiGatewayModels,
		hicapModels,
		liteLlmModels,
		openAiModels,
		requestyModels,
		groqModels: groqModelsState,
		basetenModels: basetenModelsState,
		huggingFaceModels,
		providerModelsByProvider,
		latestModelRequestIdByProvider,
		mcpServers,
		totalTasksSize,
		availableTerminalProfiles,
		showMarketplace,
		showMcp,
		mcpTab,
		showSettings,
		settingsTargetSection,
		settingsInitialModelTab,
		showHistory,
		showAccount,
		showWorktrees,
		showAnnouncement,
		globalClineRulesToggles: state.globalClineRulesToggles || {},
		localClineRulesToggles: state.localClineRulesToggles || {},
		localCursorRulesToggles: state.localCursorRulesToggles || {},
		localWindsurfRulesToggles: state.localWindsurfRulesToggles || {},
		localAgentsRulesToggles: state.localAgentsRulesToggles || {},
		localWorkflowToggles: state.localWorkflowToggles || {},
		globalWorkflowToggles: state.globalWorkflowToggles || {},
		remoteRulesToggles: state.remoteRulesToggles || {},
		remoteWorkflowToggles: state.remoteWorkflowToggles || {},
		enableCheckpointsSetting: state.enableCheckpointsSetting,

		// Navigation functions
		navigateToMarketplace,
		navigateToMcp,
		navigateToSettings,
		navigateToSettingsModelPicker,
		navigateToHistory,
		navigateToAccount,
		navigateToWorktrees,
		navigateToChat,

		// Hide functions
		hideSettings,
		hideHistory,
		hideAccount,
		hideWorktrees,
		hideAnnouncement,
		closeMarketplaceView,
		setShowAnnouncement,
		setShowWelcome,
		setOnboardingModels,
		startProviderModelsRequest,
		applyProviderModelsResponse,
		setShouldShowAnnouncement: (value) =>
			setState((prevState) => ({
				...prevState,
				shouldShowAnnouncement: value,
			})),
		setMcpServers,
		setRequestyModels,
		setGroqModels,
		setBasetenModels,
		setHuggingFaceModels,
		setShowMarketplace,
		setShowMcp,
		closeMcpView,
		setGlobalClineRulesToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				globalClineRulesToggles: toggles,
			})),
		setLocalClineRulesToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				localClineRulesToggles: toggles,
			})),
		setLocalCursorRulesToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				localCursorRulesToggles: toggles,
			})),
		setLocalWindsurfRulesToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				localWindsurfRulesToggles: toggles,
			})),
		setLocalAgentsRulesToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				localAgentsRulesToggles: toggles,
			})),
		setLocalWorkflowToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				localWorkflowToggles: toggles,
			})),
		setGlobalWorkflowToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				globalWorkflowToggles: toggles,
			})),
		setGlobalSkillsToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				globalSkillsToggles: toggles,
			})),
		setLocalSkillsToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				localSkillsToggles: toggles,
			})),
		setRemoteRulesToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				remoteRulesToggles: toggles,
			})),
		setRemoteWorkflowToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				remoteWorkflowToggles: toggles,
			})),
		setMcpTab,
		setTotalTasksSize,
		refreshOpenRouterModels,
		refreshVercelAiGatewayModels,
		refreshHicapModels,
		refreshLiteLlmModels,
		onRelinquishControl,
		setUserInfo: (userInfo?: UserInfo) => setState((prevState) => ({ ...prevState, userInfo })),
		expandTaskHeader,
		setExpandTaskHeader,
	}

	const messagesContextValue: MessagesState = {
		clineMessages: replicaMessages.clineMessages,
		turnState: replicaMessages.turnState,
		messageTruncated: replicaMessages.messageTruncated,
		totalMessageCount: replicaMessages.totalMessageCount,
		epoch: replicaMessages.epoch,
		stateVersion: replicaMessages.stateVersion,
		hasMoreMessages,
		loadHistoryBatch,
	}

	return (
		<MessagesStateContext.Provider value={messagesContextValue}>
			<ExtensionStateContext.Provider value={contextValue}>{children}</ExtensionStateContext.Provider>
		</MessagesStateContext.Provider>
	)
}

export const useExtensionState = () => {
	const context = useContext(ExtensionStateContext)
	if (context === undefined) {
		throw new Error("useExtensionState must be used within an ExtensionStateContextProvider")
	}
	return context
}

export const useMessagesState = () => {
	const context = useContext(MessagesStateContext)
	if (context === undefined) {
		throw new Error("useMessagesState must be used within an ExtensionStateContextProvider")
	}
	return context
}
