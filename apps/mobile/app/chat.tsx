import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared";
import {
	Redirect,
	useLocalSearchParams,
	useNavigation,
	useRouter,
} from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Keyboard, Linking, View } from "react-native";
import {
	type CloudModelOption,
	CloudSetupGateway,
	cloudAuthStore,
} from "@/cloud";
import { cloudEnv } from "@/config/env";
import { COMPUTER_CONNECTIONS_ENABLED } from "@/config/features";
import {
	type ConnectionDescriptor,
	chatRouteParams,
	descriptorKey,
	useSessionConnection,
} from "@/connection";
import { userErrorMessage } from "@/error-message";
import { ChatScreen } from "@/screens";
import { CloudArchiveRoute } from "@/screens/CloudArchiveRoute";
import { CloudProvisioningScreen } from "@/screens/CloudProvisioningScreen";
import { repositoryReviewUrl } from "@/screens/chat/repository-review";
import {
	AdaptiveSessionLayout,
	useAdaptiveSessionLayout,
} from "@/screens/home/AdaptiveSessionLayout";
import { localModelOptions } from "@/screens/home/local-models";
import { SessionSidebar } from "@/screens/home/SessionSidebar";
import {
	cloudSessionContext,
	type SessionRow,
} from "@/screens/home/session-rows";
import { useCloudSessionActions } from "@/screens/home/useCloudSessionActions";
import { useSessionHistory } from "@/screens/home/useSessionHistory";
import type { ApprovalPolicy, RunStatus } from "@/session";
import { RemoteSessionExpiredError } from "@/session/cloud-resolver";
import type { ReasoningChoice } from "@/session/reasoning";
import { cloudStartStore, useCloudStarts } from "@/state/cloud-starts";
import { useEndpoints } from "@/state/endpoints";
import { useExecutionTargets } from "@/state/execution-targets";
import { useLastOpened } from "@/state/last-opened";
import {
	clearPendingHomeMessage,
	descriptorAfterHomeSubmission,
	descriptorWithResolvedSession,
	readPendingHomeSubmission,
	updatePendingHomeAttachments,
} from "@/state/pending-home-message";
import { useApprovalPolicy } from "@/state/settings";
import { Button, Text, useTheme } from "@/ui";

/** Resolves a credential-free route key back to its SecureStore-backed endpoint. */
export default function ChatRoute() {
	const router = useRouter();
	const sidebar = useAdaptiveSessionLayout();
	const [live, setLive] = useState<{
		routeKey: string;
		activeKey: string;
		status?: RunStatus;
		busy: boolean;
	}>();
	const params = useLocalSearchParams<{
		endpointKey?: string;
		newSession?: string;
		launchMessageId?: string;
	}>();
	const { endpoints, hydrated, store } = useEndpoints();
	useCloudStarts();
	const endpointKey = params.endpointKey ?? "";
	const routeKey = `${endpointKey}:${params.newSession === "1" ? "new" : "latest"}:${params.launchMessageId ?? "open"}`;
	const reportLive = useCallback(
		(activeKey: string, status: RunStatus | undefined, busy: boolean) => {
			setLive({ routeKey, activeKey, status, busy });
		},
		[routeKey],
	);
	const currentLive = live?.routeKey === routeKey ? live : undefined;
	const sidebarVisible = sidebar.visible && !currentLive?.busy;
	const openSidebar = useCallback(() => {
		if (currentLive?.busy) return;
		if (!sidebar.wide) Keyboard.dismiss();
		sidebar.open();
	}, [currentLive?.busy, sidebar.wide, sidebar.open]);
	// Reading the store covers an immediate connect; `endpoints` makes this route
	// re-render when an app-launch hydration finishes.
	const descriptor = store.get(endpointKey);
	void endpoints;

	if (!descriptor && !hydrated) {
		return <ResolvingEndpoint />;
	}
	if (descriptor?.mode === "local" && !COMPUTER_CONNECTIONS_ENABLED) {
		return <Redirect href="/" />;
	}

	if (!descriptor) {
		return (
			<MissingEndpoint
				onBack={() =>
					router.dismissTo({ pathname: "/", params: { sessions: "1" } })
				}
			/>
		);
	}

	// A receipt can appear in history before setup finishes. Its launch owns the
	// first prompt; revisiting that row must not create a competing sender.
	const pendingStart = cloudStartStore.jobForDescriptor(descriptor);
	if (pendingStart && pendingStart.phase !== "ready") {
		return (
			<CloudProvisioningScreen
				jobId={pendingStart.id}
				onBack={() =>
					router.dismissTo({ pathname: "/", params: { sessions: "1" } })
				}
				onReady={() => {}}
			/>
		);
	}

	return (
		<AdaptiveSessionLayout
			onOpenSidebar={openSidebar}
			inlineSidebar={sidebar.wide && sidebarVisible}
			sidebar={
				<ChatSessionSidebar
					open={sidebarVisible}
					presentation={sidebar.wide ? "inline" : "drawer"}
					activeKey={currentLive?.activeKey ?? descriptorKey(descriptor)}
					activeStatus={currentLive?.status}
					onClose={sidebar.close}
				/>
			}
		>
			<ConnectedChatRoute
				key={routeKey}
				descriptor={descriptor}
				createNewSession={params.newSession === "1"}
				launchMessageId={params.launchMessageId}
				onLiveChange={reportLive}
				onOpenSidebar={openSidebar}
				inlineSidebar={sidebar.wide && sidebarVisible}
			/>
		</AdaptiveSessionLayout>
	);
}

function ResolvingEndpoint() {
	const theme = useTheme();
	return (
		<View
			style={{
				flex: 1,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: theme.color.canvas,
			}}
		>
			<Text variant="body" tone="muted">
				Loading connection…
			</Text>
		</View>
	);
}

function ConnectedChatRoute({
	descriptor,
	createNewSession,
	launchMessageId,
	onLiveChange,
	onOpenSidebar,
	inlineSidebar,
}: {
	descriptor: ConnectionDescriptor;
	createNewSession: boolean;
	launchMessageId?: string;
	onLiveChange(
		activeKey: string,
		status: RunStatus | undefined,
		busy: boolean,
	): void;
	onOpenSidebar(): void;
	inlineSidebar: boolean;
}) {
	const { save } = useEndpoints();
	const { saveCloudModel } = useExecutionTargets();
	const router = useRouter();
	const { policy, store: approvalPolicyStore } = useApprovalPolicy();
	const [initialSubmissionBusy, setInitialSubmissionBusy] = useState(false);
	const navigation = useNavigation();
	useEffect(() => {
		if (!initialSubmissionBusy) return;
		return navigation.addListener("beforeRemove", (event) => {
			event.preventDefault();
		});
	}, [initialSubmissionBusy, navigation]);
	// Saving metadata (the resolved inner-session pin or a model choice) replaces
	// the descriptor object in the endpoint store. That must not tear down the
	// live socket—or let a `newSession=1` route create a second session. A route
	// key change still remounts this component for an intentional destination
	// change, while incidental store writes keep this connection descriptor.
	const connectionDescriptorRef = useRef(descriptor);
	const connectionDescriptor = connectionDescriptorRef.current;
	const providerId =
		descriptor.providerId ??
		(descriptor.mode === "cloud" || createNewSession ? "cline" : undefined);
	const [modelId, setModelId] = useState(
		descriptor.modelId ??
			(descriptor.mode === "local" && createNewSession
				? CLINE_DEFAULT_MODEL_ID
				: undefined),
	);
	const [cloudModels, setCloudModels] = useState<readonly CloudModelOption[]>(
		[],
	);
	const [checkingImageSupport, setCheckingImageSupport] = useState(true);
	const [reasoningDraft, setReasoningDraft] = useState<
		ReasoningChoice | undefined
	>(descriptor.reasoning);
	const loadCloudModels = useCallback(async () => {
		try {
			const models = await new CloudSetupGateway({
				apiBaseUrl: cloudEnv.apiBaseUrl,
				getAccessToken: () => cloudAuthStore.getValidAccessToken(),
			}).listRecommendedModels();
			setCloudModels(models);
			return models;
		} finally {
			setCheckingImageSupport(false);
		}
	}, []);
	useEffect(() => {
		if (descriptor.mode !== "cloud") return;
		// Capability validation must not depend on first opening the picker.
		void loadCloudModels().catch(() => {});
	}, [descriptor.mode, loadCloudModels]);
	// `deps` identity rebuilds the controller, so the policy is passed as the
	// *seed* only (from a ref, read once per controller) and later changes are
	// pushed at the live session below. Putting `policy` in this memo would drop
	// and rebuild the socket on every settings toggle.
	const policyRef = useRef(policy);
	policyRef.current = policy;
	const connectionDeps = useMemo(
		() => ({
			createNewSession,
			approvalPolicy: policyRef.current,
			subscribeApprovalPolicy: (listener: (policy: ApprovalPolicy) => void) =>
				approvalPolicyStore.subscribe(listener),
			getAccessToken: () => cloudAuthStore.getValidAccessToken(),
		}),
		[createNewSession, approvalPolicyStore],
	);
	const connection = useSessionConnection(connectionDescriptor, connectionDeps);
	const selectedModel = cloudModels.find(
		(model) =>
			model.id === (connection.view.model?.modelId ?? modelId) &&
			(descriptor.mode === "cloud" ||
				model.providerId === (connection.view.model?.providerId ?? providerId)),
	);
	const supportsReasoning = selectedModel?.supportsReasoning;
	useEffect(() => {
		if (!checkingImageSupport)
			connection.setReasoningChoice?.(
				supportsReasoning === true ? reasoningDraft : undefined,
			);
	}, [
		checkingImageSupport,
		supportsReasoning,
		reasoningDraft,
		connection.setReasoningChoice,
	]);
	const changeReasoning = (choice: ReasoningChoice) => {
		setReasoningDraft(choice);
		connection.setReasoningChoice?.(choice);
		void save({ ...descriptor, reasoning: choice }).catch(() => {});
	};
	const initialMessageConsumed = useRef(false);
	// Once the Hub resolves the exact inner conversation, retain it. Cloud replaces
	// its outer-workspace descriptor (same key); local adds an exact-session row next
	// to the machine entry point (different key), so the computer remains available
	// for starting more work even while it is offline.
	const lastPinnedSessionId = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (
			!connection.sessionId ||
			descriptor.hubSessionId === connection.sessionId ||
			lastPinnedSessionId.current === connection.sessionId
		) {
			return;
		}
		lastPinnedSessionId.current = connection.sessionId;
		const pinned = descriptorWithResolvedSession(
			descriptor,
			connection.sessionId,
			initialMessageConsumed.current,
		);
		void save(pinned).catch(() => {
			lastPinnedSessionId.current = undefined;
		});
	}, [connection.sessionId, descriptor, save]);
	const loadModels = useCallback(async () => {
		if (descriptor.mode !== "local") {
			return loadCloudModels();
		}
		// The machine's own catalog (`catalog.list`), not Cloud's: a paired
		// computer offers whatever providers are configured on it, and Cloud's
		// list would offer models the machine cannot run.
		const catalog = await connection.listModelCatalog();
		const options = localModelOptions(catalog);
		setCloudModels(options);
		setCheckingImageSupport(false);
		return options;
	}, [connection.listModelCatalog, descriptor.mode, loadCloudModels]);
	useEffect(() => {
		if (descriptor.mode === "local" && connection.status.phase === "ready") {
			void loadModels().catch(() => setCheckingImageSupport(false));
		}
	}, [descriptor.mode, connection.status.phase, loadModels]);
	const changeModel = useCallback(
		async (nextModelId: string, option?: CloudModelOption) => {
			const nextProviderId =
				descriptor.mode === "cloud"
					? "cline"
					: (option?.providerId ??
						connection.view.model?.providerId ??
						descriptor.providerId);
			await connection.updateModel(
				nextModelId,
				nextProviderId ? { providerId: nextProviderId } : {},
			);
			setModelId(nextModelId);
			if (descriptor.mode === "cloud") {
				await saveCloudModel(nextModelId, descriptor.organizationId);
			}
			await save({
				...descriptor,
				...(nextProviderId
					? { providerId: nextProviderId }
					: descriptor.mode === "cloud"
						? { providerId: "cline" }
						: {}),
				modelId: nextModelId,
			});
		},
		[
			saveCloudModel,
			connection.updateModel,
			connection.view.model?.providerId,
			descriptor,
			save,
		],
	);
	const pendingSubmission = launchMessageId
		? readPendingHomeSubmission(launchMessageId)
		: undefined;
	const initialMessage =
		pendingSubmission?.text ?? descriptor.pendingInitialMessage;
	const initialAttachments = pendingSubmission?.attachments;
	const requiresDurableInitialClear = useRef(
		Boolean(connectionDescriptor.pendingInitialMessage),
	);
	const clearInitialMessage = useCallback(async () => {
		initialMessageConsumed.current = true;
		// `save` updates memory before persistence. After a failed durable clear,
		// the rerendered descriptor already looks clear; retry must still write it.
		const next = descriptorAfterHomeSubmission(
			descriptor,
			connection.sessionId,
			requiresDurableInitialClear.current,
		);
		if (next) {
			if (connection.sessionId) {
				lastPinnedSessionId.current = connection.sessionId;
			}
			try {
				await save(next);
			} catch (error) {
				if (lastPinnedSessionId.current === connection.sessionId) {
					lastPinnedSessionId.current = undefined;
				}
				initialMessageConsumed.current = false;
				// A durable prompt must not run until its consumed state is durable too.
				// A process-local launch is safe once its in-memory record is cleared.
				if (requiresDurableInitialClear.current) throw error;
			}
		}
		requiresDurableInitialClear.current = false;
		if (launchMessageId) {
			clearPendingHomeMessage(launchMessageId);
		}
	}, [connection.sessionId, descriptor, launchMessageId, save]);
	const updateInitialAttachments = useCallback(
		(userImages: string[]) => {
			if (launchMessageId) {
				updatePendingHomeAttachments(launchMessageId, userImages);
			}
		},
		[launchMessageId],
	);

	// Later toggles (and the startup hydration) reach the live session here.
	const { setApprovalPolicy } = connection;
	useEffect(() => {
		setApprovalPolicy(policy);
	}, [setApprovalPolicy, policy]);

	const activeKey = descriptorKey(
		connection.sessionId
			? { ...descriptor, hubSessionId: connection.sessionId }
			: descriptor,
	);
	useEffect(() => {
		onLiveChange(
			activeKey,
			connection.status.phase === "ready" &&
				connection.view.connectionStatus === "live"
				? connection.view.runStatus
				: undefined,
			initialSubmissionBusy,
		);
	}, [
		activeKey,
		connection.status.phase,
		connection.view.connectionStatus,
		connection.view.runStatus,
		initialSubmissionBusy,
		onLiveChange,
	]);
	const newChat = () => router.dismissTo("/");
	const signIn = () =>
		router.dismissTo({ pathname: "/", params: { cloud: "1" } });
	if (
		descriptor.mode === "cloud" &&
		descriptor.remoteSessionId &&
		connection.status.error?.name === "RemoteSessionExpiredError"
	) {
		return (
			<CloudArchiveRoute
				descriptor={descriptor}
				notice={
					connection.status.error instanceof RemoteSessionExpiredError &&
					connection.status.error.status === "failed"
						? `This Cloud workspace failed. ${userErrorMessage(connection.status.error.statusReason, "Start a new chat to try again.")}`
						: undefined
				}
				onBack={() =>
					router.dismissTo({ pathname: "/", params: { sessions: "1" } })
				}
				onNewChat={newChat}
				onSignIn={signIn}
			/>
		);
	}
	const reviewUrl = repositoryReviewUrl(descriptor.repoUrl, descriptor.branch);
	return (
		<ChatScreen
			extendIntoSideInsets={!inlineSidebar}
			onReviewBranch={
				reviewUrl
					? () => {
							void Linking.openURL(reviewUrl).catch(() =>
								Alert.alert(
									"Could not open GitHub",
									"Try opening the branch again.",
								),
							);
						}
					: undefined
			}
			onFork={
				descriptor.mode === "local"
					? async (sessionId) => {
							const fork = {
								...descriptor,
								hubSessionId: sessionId,
								sessionTitle: `Fork of ${descriptor.sessionTitle || descriptor.label || "conversation"}`,
							};
							delete fork.pendingInitialMessage;
							delete fork.allowInitialCreate;
							delete fork.reasoning;
							await save(fork);
							router.replace({
								pathname: "/chat",
								params: chatRouteParams(fork),
							});
						}
					: undefined
			}
			connectionKind={descriptor.mode}
			onSignIn={signIn}
			onNewChat={newChat}
			onConnectGitHub={() =>
				Linking.openURL(`${cloudEnv.appBaseUrl}/dashboard/integrations`)
			}
			connection={connection}
			onInitialSubmissionBusyChange={setInitialSubmissionBusy}
			initialMessage={initialMessage}
			{...(initialAttachments ? { initialAttachments } : {})}
			draftKey={`${activeKey}:${createNewSession ? "new" : (descriptor.hubSessionId ?? "latest")}`}
			{...(initialMessage || initialAttachments?.userImages?.length
				? {
						onInitialMessageConsumed: clearInitialMessage,
					}
				: {})}
			onInitialAttachmentsChange={updateInitialAttachments}
			title={
				descriptor.sessionTitle?.trim() ||
				descriptor.label?.trim() ||
				(descriptor.mode === "cloud" ? "Cloud session" : "Cline session")
			}
			modelLabel={connection.view.model?.modelId ?? modelId}
			modelName={selectedModel?.name}
			checkingImageSupport={descriptor.mode === "cloud" && checkingImageSupport}
			supportsImages={selectedModel?.supportsImages}
			providerId={connection.view.model?.providerId ?? providerId}
			reasoning={reasoningDraft ?? connection.view.model?.reasoning}
			supportsReasoning={supportsReasoning}
			onReasoningChange={changeReasoning}
			canChangeModel
			modelLockedMessage={
				"Wait for the current turn to finish, then choose another model."
			}
			connectingMessage={
				descriptor.mode === "cloud"
					? (connection.status.progress ?? "Opening Cloud workspace…")
					: `Opening session from ${descriptor.label?.trim() || "your computer"}…`
			}
			loadModels={loadModels}
			cachedModels={cloudModels}
			onModelChange={changeModel}
			subtitle={
				descriptor.mode === "cloud"
					? cloudSessionContext(descriptor)
					: descriptor.sessionTitle
						? (descriptor.label ?? "Paired computer")
						: "Paired computer"
			}
			onSwitchSession={inlineSidebar ? undefined : onOpenSidebar}
			onBack={inlineSidebar ? undefined : onOpenSidebar}
			onChooseAnotherSession={onOpenSidebar}
		/>
	);
}

function ChatSessionSidebar({
	open,
	presentation,
	activeKey,
	activeStatus,
	onClose,
}: {
	open: boolean;
	presentation: "drawer" | "inline";
	activeKey: string;
	activeStatus?: RunStatus;
	onClose(): void;
}) {
	const router = useRouter();
	const { save } = useEndpoints();
	const { touch } = useLastOpened();
	const {
		cloud,
		local,
		rows: historyRows,
	} = useSessionHistory({
		openVerificationUrl: () => false,
		refreshIntervalMs: open ? 30_000 : undefined,
		activeKey,
		activeStatus,
	});
	const sessionActions = useCloudSessionActions(cloud.refresh, (key) => {
		if (key === activeKey) {
			onClose();
			router.dismissTo("/");
		}
	});
	const rows = useMemo(
		() => historyRows.filter((row) => row.kind === "session"),
		[historyRows],
	);
	const openSession = useCallback(
		(row: SessionRow) => {
			if (presentation === "drawer") onClose();
			if (row.key === activeKey) return;
			// Both stores update memory before persistence. A Keychain failure should
			// not turn a visible, connectable session row into a dead button.
			void save(row.descriptor).catch(() => {});
			void touch(row.key).catch(() => {});
			// Update the existing route, not the native screen containing the sidebar.
			router.setParams({
				...chatRouteParams(row.descriptor),
				newSession: undefined,
				launchMessageId: undefined,
			});
		},
		[activeKey, onClose, presentation, router, save, touch],
	);
	return (
		<SessionSidebar
			{...sessionActions}
			presentation={presentation}
			activeKey={activeKey}
			error={
				cloud.state.phase === "error"
					? cloud.state.message
					: local.unavailableMachineIds.length > 0
						? "Some paired computers could not be refreshed."
						: undefined
			}
			loading={
				rows.length === 0 && (local.loading || cloud.state.phase === "loading")
			}
			now={Date.now()}
			onClose={onClose}
			onNew={() => {
				if (presentation === "drawer") onClose();
				router.dismissTo("/");
			}}
			onOpen={openSession}
			onOpenSettings={() => {
				if (presentation === "drawer") onClose();
				router.push("/settings");
			}}
			open={open}
			rows={rows}
			onRefresh={() => {
				local.refresh();
				cloud.refresh();
			}}
			refreshing={local.loading || cloud.state.phase === "loading"}
		/>
	);
}

function MissingEndpoint({ onBack }: { onBack: () => void }) {
	const theme = useTheme();
	return (
		<View
			style={{
				flex: 1,
				alignItems: "center",
				justifyContent: "center",
				gap: 12,
				padding: 24,
				backgroundColor: theme.color.canvas,
			}}
		>
			<Text variant="heading">Session unavailable</Text>
			<Text variant="body" tone="muted" style={{ textAlign: "center" }}>
				This session is no longer saved on this device. Pick it from your
				session list again.
			</Text>
			<Button label="Back to sessions" onPress={onBack} />
		</View>
	);
}
