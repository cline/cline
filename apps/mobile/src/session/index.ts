/**
 * Session core for the mobile client: resolve a cloud session, then drive it.
 *
 * ```ts
 * const handle = await resolveCloudSession({
 *   gateway,                       // REST session discovery
 *   remoteSessionId,
 *   clientFactory: ({ url }) =>    // owns the auth decision
 *     new HubClient({ url, authMode: "bearer-header", credential: token }),
 * });
 * const connection = new SessionConnection({ handle });
 * connection.subscribe(render);
 * await connection.start();        // subscribe -> buffer -> hydrate -> merge -> live
 * await connection.sendInput("hi");
 * ```
 *
 * Everything here is pure TypeScript; the React bindings live above it.
 */

export {
	APPROVAL_TIERS,
	type ApprovalPolicy,
	type ApprovalTier,
	type ApprovalTierSetting,
	classifyTool,
	DEFAULT_APPROVAL_POLICY,
	shouldAutoApprove,
} from "./approval-policy";
export {
	ExactSessionNotFoundError,
	FakeRemoteSessionGateway,
	type HubClientFactory,
	hubUrlForSandbox,
	type RemoteSession,
	RemoteSessionExpiredError,
	type RemoteSessionGateway,
	RemoteSessionNotFoundError,
	type RemoteSessionStatus,
	type ResolveCloudSessionOptions,
	resolveCloudSession,
	type SessionHandle,
	SessionListUnavailableError,
} from "./cloud-resolver";
export {
	asHubSessionId,
	asRemoteSessionId,
	type HubSessionId,
	type RemoteSessionId,
} from "./ids";
export {
	type ConnectionStatus,
	createSessionState,
	type LastRunView,
	type MessageBlock,
	optimisticMessageId,
	type RunStatus,
	reduceSession,
	type SessionAction,
	type SessionCounters,
	type SessionDiagnostic,
	type SessionMessageView,
	type SessionState,
	type SessionViewModel,
	selectOptimisticInput,
	selectOptimisticSend,
	selectViewModel,
	type TokenUsageView,
	type ToolActivityState,
} from "./reducer";
export {
	ASK_QUESTION_CAPABILITY,
	type AskQuestionCapabilityParseResult,
	CONSUMED_HUB_EVENTS,
	type ConsumedHubEvent,
	type HydratedMessage,
	IGNORED_HUB_EVENTS,
	type ModelCatalogView,
	type PendingPromptView,
	parseAskQuestionCapabilityRequest,
	parseAskQuestionCapabilityResolution,
	parseHubEvent,
	parseModelCatalogReply,
	parsePendingApprovals,
	parseSessionCreateReply,
	parseSessionListReply,
	parseSessionMessagesReply,
	parseSessionRecordReply,
	readSessionModel,
	type SessionModelView,
	type SessionQuestionView,
} from "./schemas";
export {
	SessionAttachError,
	SessionConnection,
	type SessionConnectionOptions,
	type SessionInputAttachments,
} from "./session-connection";

export type { SessionCheckpoint } from "./checkpoints";
