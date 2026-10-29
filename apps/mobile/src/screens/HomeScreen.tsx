/**
 * Configured Home follows Cline's welcome hierarchy: a centered hero,
 * execution context and composer. Session history lives in a leading-edge
 * drawer—the phone-sized counterpart to desktop's sidebar—instead of competing
 * with the primary new-conversation surface.
 */

import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared";
import type GorhomBottomSheet from "@gorhom/bottom-sheet";
import { PanelLeft, Settings } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Keyboard, Linking, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
	type CloudModelOption,
	CloudSessionGateway,
	CloudSetupGateway,
	type CreatedRemoteSession,
	cloudAuthStore,
	isAllowedVerificationUrl,
} from "@/cloud";
import { cloudEnv } from "@/config/env";
import { COMPUTER_CONNECTIONS_ENABLED } from "@/config/features";
import { type ConnectionDescriptor, descriptorKey } from "@/connection";
import { cloudLaunches } from "@/connection/cloud-launches";
import type { RunStatus, SessionInputAttachments } from "@/session";
import { useCloudAccountScope } from "@/state/cloud-auth";
import {
	type CloudStartJob,
	cloudStartStore,
	isCloudStartAuthenticationError,
	useCloudStarts,
} from "@/state/cloud-starts";
import { useEndpoints } from "@/state/endpoints";
import { useExecutionTargets } from "@/state/execution-targets";
import { useLastOpened } from "@/state/last-opened";
import { useSessionDraftEpoch } from "@/state/session-drafts";
import { useApprovalPolicy } from "@/state/settings";
import {
	Button,
	Card,
	expandBottomSheetAfterKeyboardDismiss,
	IconButton,
	ScreenHeader,
	Spinner,
	StartupScreen,
	Text,
	useTheme,
} from "@/ui";
import { AutoApprovePill, AutoApproveSheet } from "./chat/AutoApproveControl";
import { ModelSheet } from "./chat/ModelControl";
import { ReasoningPill, ReasoningSheet } from "./chat/ReasoningControl";
import {
	AdaptiveSessionLayout,
	useAdaptiveSessionLayout,
} from "./home/AdaptiveSessionLayout";
import { CloudAccountCard, CloudSignInProgress } from "./home/CloudAccountCard";
import { CloudOnboardingCard } from "./home/CloudOnboardingCard";
import { useCloudWorkspaceControls } from "./home/CloudWorkspaceControls";
import type { CloudSessionsState } from "./home/cloud-sessions";
import { isCloudStartRecoveryCandidate } from "./home/cloud-start-recovery";
import {
	buildHomeExecutionTargets,
	targetCreatesNewSession,
} from "./home/execution-targets";
import {
	HomeComposer,
	HomeTargetControl,
	HomeTargetSheet,
} from "./home/HomeComposer";
import { HANDOFF_INSTRUCTION, IntroScreen } from "./home/IntroScreen";
import { listLocalMachineModels } from "./home/local-sessions";
import { SessionSidebar } from "./home/SessionSidebar";
import type { SessionRow } from "./home/session-rows";
import { useCloudSessionActions } from "./home/useCloudSessionActions";
import { useSessionHistory } from "./home/useSessionHistory";
import { OnboardingScreen } from "./OnboardingScreen";

export { HANDOFF_INSTRUCTION };

/** Match Cline Desktop's concise first-prompt title. */
export function deriveCloudSessionTitle(prompt: string): string {
	return (prompt.trim().split("\n")[0] ?? "").trim().slice(0, 72);
}

export interface HomeScreenProps {
	forceSetup?: boolean;
	/** Open Home focused on configuring a Cloud destination. */
	preferCloudOnMount?: boolean;
	openSessionsOnMount?: boolean;
	onSessionsOpened?(): void;
	/** Failed unknown-create job whose retained submission may be explicitly recovered. */
	recoveryJobId?: string;
	activeKey?: string;
	activeStatus?: RunStatus;
	now?: number;
	onOpenSession(
		descriptor: ConnectionDescriptor,
		initialMessage?: string,
		createNewSession?: boolean,
		attachments?: SessionInputAttachments,
	): void;
	onOpenSettings?(): void;
	onConfigureCloud?(): void;
	onOpenCloudStart?(jobId: string): void;
	onScanHandoff?(): void;
	onFinishSetup?(): void;
}

export function HomeScreen(props: HomeScreenProps) {
	const epoch = useSessionDraftEpoch();
	return <HomeScreenBody key={epoch} {...props} />;
}

function HomeScreenBody({
	forceSetup = false,
	preferCloudOnMount = false,
	openSessionsOnMount = false,
	onSessionsOpened,
	recoveryJobId,
	activeKey,
	activeStatus,
	now,
	onOpenSession,
	onOpenSettings,
	onConfigureCloud,
	onOpenCloudStart,
	onFinishSetup,
}: HomeScreenProps) {
	const theme = useTheme();
	const { scope: accountScope } = useCloudAccountScope();
	const insets = useSafeAreaInsets();
	const { endpoints, hydrated: endpointsHydrated, save } = useEndpoints();
	const {
		cloudTargets,
		cloudModelPreferences,
		saveCloudModel,
		lastTargetId,
		hydrated: targetsHydrated,
		saveCloudTarget,
		select,
	} = useExecutionTargets();
	const { touch } = useLastOpened();
	const { policy, setTier, store: approvalPolicyStore } = useApprovalPolicy();
	const [draft, setDraft] = useState("");
	const [selectedKey, setSelectedKey] = useState<string>();
	const [modelSection, setModelSection] = useState<"providers" | "models">(
		"models",
	);
	const [choosingCloud, setChoosingCloud] = useState(preferCloudOnMount);
	const pendingCloudModelId =
		cloudModelPreferences.find(
			(row) => row.organizationId === accountScope?.organizationId,
		)?.modelId ?? CLINE_DEFAULT_MODEL_ID;
	const [localModelOverrides, setLocalModelOverrides] = useState<
		Record<string, { providerId: string; modelId: string }>
	>({});
	const [cloudModels, setCloudModels] = useState<readonly CloudModelOption[]>(
		[],
	);
	const [checkingImageSupport, setCheckingImageSupport] = useState(true);
	const loadCloudModels = useCallback(async () => {
		setCheckingImageSupport(true);
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
	const cloudStarts = useCloudStarts();
	const [selectedRecoveryJobId, setSelectedRecoveryJobId] = useState<string>();
	const [dismissedRecoveryJobId, setDismissedRecoveryJobId] =
		useState<string>();
	const activeRecoveryJobId = selectedRecoveryJobId ?? recoveryJobId;
	const recoveryJob =
		activeRecoveryJobId !== dismissedRecoveryJobId && activeRecoveryJobId
			? cloudStarts.find((job) => job.id === activeRecoveryJobId)
			: undefined;
	const targetSheetRef = useRef<GorhomBottomSheet>(null);
	const autoApproveSheetRef = useRef<GorhomBottomSheet>(null);
	const reasoningSheetRef = useRef<GorhomBottomSheet>(null);
	const modelSheetRef = useRef<GorhomBottomSheet>(null);
	const sidebar = useAdaptiveSessionLayout();
	const { setDrawerOpen: setHistoryOpen } = sidebar;
	const cloudPreferenceHandled = useRef(preferCloudOnMount);
	const renderedAt = now ?? Date.now();
	useEffect(() => {
		if (!preferCloudOnMount || cloudPreferenceHandled.current) return;
		cloudPreferenceHandled.current = true;
		setSelectedKey(undefined);
		setChoosingCloud(true);
	}, [preferCloudOnMount]);

	const openVerificationUrl = useCallback((url: string) => {
		if (!isAllowedVerificationUrl(url)) return false;
		void Linking.openURL(url).catch(() => {});
		return true;
	}, []);
	const { cloud, local, rows } = useSessionHistory({
		openVerificationUrl,
		refreshIntervalMs: sidebar.visible ? 30_000 : undefined,
		activeKey,
		activeStatus,
	});
	const sessionActions = useCloudSessionActions(cloud.refresh);
	const sessionsRequestHandled = useRef(false);
	useEffect(() => {
		if (!openSessionsOnMount) sessionsRequestHandled.current = false;
		if (
			!openSessionsOnMount ||
			sessionsRequestHandled.current ||
			!endpointsHydrated ||
			!targetsHydrated
		) {
			return;
		}
		const timer = setTimeout(() => {
			sessionsRequestHandled.current = true;
			local.refresh();
			cloud.refresh();
			sidebar.open();
			onSessionsOpened?.();
		}, 0);
		return () => clearTimeout(timer);
	}, [
		openSessionsOnMount,
		onSessionsOpened,
		endpointsHydrated,
		targetsHydrated,
		local.refresh,
		cloud.refresh,
		sidebar.open,
	]);

	const sessionRows = useMemo(
		() => rows.filter((row) => row.kind === "session"),
		[rows],
	);
	const cloudAuthenticated =
		cloud.state.phase === "ready" ||
		((cloud.state.phase === "loading" || cloud.state.phase === "error") &&
			cloud.state.authenticated === true);
	const cloudCanStart = cloudAuthenticated && accountScope !== undefined;
	const targets = useMemo(
		() =>
			buildHomeExecutionTargets({
				endpoints,
				cloudTargets: accountScope
					? cloudTargets.filter(
							(target) => target.organizationId === accountScope.organizationId,
						)
					: cloudAuthenticated
						? []
						: cloudTargets,
				unavailableLocalMachineIds: local.unavailableMachineIds,
			}),
		[
			endpoints,
			cloudTargets,
			local.unavailableMachineIds,
			accountScope,
			cloudAuthenticated,
		],
	);
	const rememberedTarget =
		targets.find((candidate) => candidate.id === selectedKey) ??
		targets.find((candidate) => candidate.id === lastTargetId) ??
		targets[0];
	const target = choosingCloud
		? rememberedTarget?.mode === "cloud"
			? rememberedTarget
			: targets.find((candidate) => candidate.mode === "cloud")
		: rememberedTarget;
	const showAutoApprove =
		COMPUTER_CONNECTIONS_ENABLED &&
		(target?.mode === "local" || target?.mode === "local-session");
	const cloudMode = !target || target.mode === "cloud";
	const localModelOverride = target
		? localModelOverrides[target.id]
		: undefined;
	const selectedProviderId =
		localModelOverride?.providerId ??
		(target?.mode === "local" ? target.descriptor.providerId : "cline");
	const selectedModelId =
		localModelOverride?.modelId ??
		(target?.mode === "local"
			? target.descriptor.modelId
			: target?.mode === "cloud"
				? target.cloud.modelId
				: !target
					? pendingCloudModelId
					: undefined);
	const canChooseNewModel =
		target?.mode === "local" || (cloudMode && cloudAuthenticated);
	const supportsReasoning = cloudModels.find(
		(model) => model.id === selectedModelId,
	)?.supportsReasoning;
	useEffect(() => {
		if (!cloudMode || !cloudAuthenticated) return;
		void loadCloudModels().catch(() => {});
	}, [cloudMode, cloudAuthenticated, loadCloudModels]);
	const loadTargetModels = useCallback(async () => {
		if (cloudMode) {
			return loadCloudModels();
		}
		if (target?.mode === "local") {
			const models = await listLocalMachineModels(target.descriptor, {
				getAccessToken: () => cloudAuthStore.getValidAccessToken(),
			});
			return models;
		}
		return [];
	}, [target, cloudMode, loadCloudModels]);
	const changeTargetModel = useCallback(
		async (modelId: string, option?: CloudModelOption) => {
			if (!target) {
				await saveCloudModel(modelId, accountScope?.organizationId);
				return;
			}
			const providerId = option?.providerId ?? selectedProviderId ?? "cline";
			if (target.mode === "cloud") {
				await saveCloudTarget({ ...target.cloud, modelId });
				return;
			}
			if (target.mode === "local") {
				setLocalModelOverrides((current) => ({
					...current,
					[target.id]: { providerId, modelId },
				}));
			}
		},
		[
			saveCloudTarget,
			saveCloudModel,
			accountScope?.organizationId,
			target,
			selectedProviderId,
		],
	);
	const needsCloudSetup =
		!target || (target.mode === "cloud" && !cloudAuthenticated);
	const cloudWorkspace = useCloudWorkspaceControls({
		setup: needsCloudSetup && cloudCanStart,
		setupScope: accountScope,
		target: target?.mode === "cloud" ? target.cloud : undefined,
		onChooseLocation: () => {
			expandBottomSheetAfterKeyboardDismiss(targetSheetRef);
		},
		onSaveTarget: async (input) => {
			const saved = await saveCloudTarget({
				...input,
				...(!target ? { modelId: pendingCloudModelId } : {}),
			});
			// `selectedKey` intentionally outranks the persisted last target. Update
			// both in the same transition so choosing a new repository cannot snap
			// Home back to the previously selected one.
			setSelectedKey(saved.id);
			setChoosingCloud(false);
		},
	});

	const open = (
		descriptor: ConnectionDescriptor,
		initialMessage?: string,
		createNewSession = false,
		attachments?: SessionInputAttachments,
	) => {
		const key = descriptorKey(descriptor);
		void save(descriptor).catch(() => {});
		void touch(key).catch(() => {});
		onOpenSession(descriptor, initialMessage, createNewSession, attachments);
	};

	const sendMessage = (
		input: string,
		attachments?: SessionInputAttachments,
	) => {
		const message = input.trim();
		if (!target || !message) return;
		// A persisted Cloud target can outlive the account credential that created
		// it. Keep the person's draft on Home until Cloud is authenticated instead
		// of creating a provisioning job that can only fail on the next screen.
		if (target.mode === "cloud" && !cloudCanStart) return;
		void select(target.id).catch(() => {});
		if (
			target.mode === "local" ||
			target.mode === "local-session" ||
			target.mode === "cloud-session"
		) {
			const descriptor =
				target.mode === "local" && localModelOverride
					? { ...target.descriptor, ...localModelOverride }
					: target.descriptor;
			open(descriptor, message, targetCreatesNewSession(target), attachments);
			setDraft("");
			return;
		}

		const cloudTarget = target.cloud;
		setDraft("");
		const gateway = new CloudSessionGateway({
			apiBaseUrl: cloudEnv.apiBaseUrl,
			getAccessToken: () => cloudAuthStore.getValidAccessToken(),
			...(cloudTarget.organizationId
				? { organizationId: cloudTarget.organizationId }
				: {}),
		});
		let createdSession: CreatedRemoteSession | undefined;
		const title = deriveCloudSessionTitle(message);
		const descriptorFor = (
			created: Pick<CreatedRemoteSession, "sessionId" | "sandboxUrl">,
			pendingInitialMessage?: string,
		): ConnectionDescriptor => ({
			mode: "cloud",
			url: created.sandboxUrl,
			apiBaseUrl: cloudEnv.apiBaseUrl,
			remoteSessionId: created.sessionId,
			label: title || cloudTarget.label,
			providerId: "cline",
			modelId: cloudTarget.modelId,
			repoUrl: cloudTarget.repoUrl,
			...(cloudModels.find((model) => model.id === cloudTarget.modelId)
				?.supportsReasoning === true && cloudTarget.reasoning
				? { reasoning: cloudTarget.reasoning }
				: {}),
			...(cloudTarget.branch ? { branch: cloudTarget.branch } : {}),
			allowInitialCreate: true,
			...(cloudTarget.organizationId
				? { organizationId: cloudTarget.organizationId }
				: {}),
			...(pendingInitialMessage ? { pendingInitialMessage } : {}),
		});
		// Multi-megabyte images do not belong in SecureStore. While this process is
		// alive, the launch job carries the complete submission. After an eviction,
		// never auto-send a caption without the image that gave it meaning.
		const recoverableMessage = attachments?.userImages?.length
			? undefined
			: message;
		const jobId = cloudStartStore.start({
			target: cloudTarget,
			message,
			...(attachments?.userImages?.length ? { attachments } : {}),
			provision: async (onProgress) => {
				const created = createdSession
					? await gateway.resumeRemoteSession(createdSession, { onProgress })
					: await gateway.createRemoteSession(
							{
								modelId: cloudTarget.modelId,
								repoUrl: cloudTarget.repoUrl,
								...(title ? { title } : {}),
								...(cloudTarget.branch ? { branch: cloudTarget.branch } : {}),
								...(cloudTarget.organizationId
									? { organizationId: cloudTarget.organizationId }
									: {}),
							},
							{
								onProgress,
								onCreated: async (session) => {
									createdSession = session;
									cloudStartStore.bindDescriptor(jobId, descriptorFor(session));
									// Once Cloud API gives us an id, retain the prompt with that
									// workspace. If iOS evicts the process during polling, opening the
									// eventual session can still deliver the original ask.
									await save(descriptorFor(session, recoverableMessage)).catch(
										() => {
											// Persistence is recovery insurance, not a reason to fail a
											// workspace Cloud API already accepted.
										},
									);
								},
							},
						);
				// Retain the prompt until the background launch clears it before dispatch.
				// The process-local job can disappear if iOS evicts the app.
				const descriptor = descriptorFor(created, recoverableMessage);
				cloudStartStore.bindDescriptor(jobId, descriptor);
				// Keep the receipt visible even if persisting it fails. The launch below
				// requires a successful durable clear before sending the first prompt.
				await save(descriptor).catch(() => {});
				return descriptor;
			},
			launch: (descriptor) =>
				cloudLaunches.start({
					descriptor,
					message,
					attachments,
					deps: {
						getAccessToken: () => cloudAuthStore.getValidAccessToken(),
						approvalPolicy: approvalPolicyStore.get(),
					},
					save,
					subscribePolicy: (listener) =>
						approvalPolicyStore.subscribe(listener),
				}),
		});
		onOpenCloudStart?.(jobId);
	};

	const cloudResolving =
		cloud.state.phase === "loading" || cloud.state.phase === "starting";
	// Only the mount-time credential/session lookup owns the full-screen loader.
	// Once Cloud has answered, later sign-in/loading states must keep onboarding
	// mounted so browser progress and the user's current step are not lost.
	const cloudInitiallyResolved = useRef(false);
	if (!cloudResolving || cloudAuthenticated)
		cloudInitiallyResolved.current = true;
	const hasSessions = sessionRows.length > 0;
	const cloudTargetBlocked = cloudMode && !cloudCanStart;
	if (
		!endpointsHydrated ||
		!targetsHydrated ||
		(cloudMode &&
			!forceSetup &&
			cloudResolving &&
			!cloudInitiallyResolved.current)
	) {
		return <StartupScreen />;
	}

	if (
		forceSetup ||
		(targets.length === 0 && !hasSessions && !cloudAuthenticated)
	) {
		return (
			<OnboardingScreen
				cloudState={cloud.state}
				onSignIn={cloud.signIn}
				onRetryCloud={cloud.refresh}
				onOpenCloudSignIn={() => {
					if (cloud.state.phase === "authorizing") {
						openVerificationUrl(cloud.state.verificationUrl);
					}
				}}
				onSaveCloudTarget={saveCloudTarget}
				{...(forceSetup && onFinishSetup ? { onFinish: onFinishSetup } : {})}
				{...(onOpenSettings ? { onOpenSettings } : {})}
			/>
		);
	}

	const cloudNotice = (
		<CloudNotice
			state={cloud.state}
			accountScopeKnown={accountScope !== undefined}
			cloudTargetSelected={needsCloudSetup || target?.mode === "cloud"}
			onboarding={needsCloudSetup}
			onRetry={cloud.refresh}
			onSignIn={cloud.signIn}
			onOpenBrowser={() => {
				if (cloud.state.phase === "authorizing") {
					openVerificationUrl(cloud.state.verificationUrl);
				}
			}}
		/>
	);
	const contextControl =
		needsCloudSetup && (!cloudAuthenticated || cloudWorkspace.setupContent) ? (
			cloudWorkspace.locationControl
		) : cloudAuthenticated &&
			(choosingCloud || !target || target.mode === "cloud") ? (
			cloudWorkspace.control
		) : (
			<HomeTargetControl
				target={target}
				onChooseTarget={() =>
					expandBottomSheetAfterKeyboardDismiss(targetSheetRef)
				}
			/>
		);

	const composer = (
		<HomeComposer
			cloud={cloudMode}
			draft={draft}
			target={target}
			busy={cloudTargetBlocked}
			onChooseTarget={
				cloudCanStart && !target
					? () =>
							cloudWorkspace.openRepositories(
								"Choose a repository before starting your task.",
							)
					: undefined
			}
			onDraftChange={setDraft}
			onSend={(text, attachments) => sendMessage(text, attachments)}
			providerId={selectedProviderId}
			modelId={selectedModelId}
			modelName={
				cloudModels.find((model) => model.id === selectedModelId)?.name
			}
			checkingImageSupport={cloudMode && checkingImageSupport}
			supportsImages={
				cloudMode
					? cloudModels.find((model) => model.id === selectedModelId)
							?.supportsImages
					: undefined
			}
			{...(canChooseNewModel || showAutoApprove
				? {
						onOpenModel: (section: "providers" | "models" = "models") => {
							setModelSection(section);
							expandBottomSheetAfterKeyboardDismiss(modelSheetRef);
						},
					}
				: {})}
		/>
	);
	const openHistory = () => {
		if (!sidebar.wide) Keyboard.dismiss();
		local.refresh();
		cloud.refresh();
		sidebar.open();
	};
	const openRecoveryHistory = (job: CloudStartJob) => {
		setSelectedRecoveryJobId(job.id);
		setDismissedRecoveryJobId(undefined);
		openHistory();
	};
	const openHistoryRow = (row: SessionRow) => {
		if (!recoveryJob) {
			setHistoryOpen(false);
			open(row.descriptor);
			return;
		}
		if (!isCloudStartRecoveryCandidate(recoveryJob, row)) {
			Alert.alert(
				"Choose the matching workspace",
				`This request started in ${recoveryJob.target.label}. Select a Cloud workspace from the same account and repository.`,
				[
					{ text: "Keep looking", style: "cancel" },
					{
						text: "Cancel recovery",
						style: "destructive",
						onPress: () => {
							setDismissedRecoveryJobId(recoveryJob.id);
							setSelectedRecoveryJobId(undefined);
						},
					},
				],
			);
			return;
		}
		Alert.alert(
			"Resume this request here?",
			`Only continue if “${row.title}” is the workspace created for this request. Cline will send the retained request and attachments there.`,
			[
				{ text: "Keep looking", style: "cancel" },
				{
					text: "Cancel recovery",
					style: "destructive",
					onPress: () => {
						setDismissedRecoveryJobId(recoveryJob.id);
						setSelectedRecoveryJobId(undefined);
					},
				},
				{
					text: "Resume request",
					onPress: () => {
						// Re-read the job at confirmation time. A background transition or
						// dismissal must retire this one-time creation authority.
						const current = cloudStartStore
							.getSnapshot()
							.find((job) => job.id === recoveryJob.id);
						if (!current || !isCloudStartRecoveryCandidate(current, row))
							return;
						setHistoryOpen(false);
						open(
							{ ...row.descriptor, allowInitialCreate: true },
							current.message,
							true,
							current.attachments,
						);
						cloudStartStore.remove(current.id);
						setSelectedRecoveryJobId(undefined);
					},
				},
			],
		);
	};
	return (
		<AdaptiveSessionLayout
			onOpenSidebar={openHistory}
			inlineSidebar={sidebar.wide && sidebar.visible}
			sidebar={
				<SessionSidebar
					{...sessionActions}
					presentation={sidebar.wide ? "inline" : "drawer"}
					open={sidebar.visible}
					rows={sessionRows}
					onRefresh={() => {
						local.refresh();
						cloud.refresh();
					}}
					refreshing={local.loading || cloud.state.phase === "loading"}
					loading={
						rows.length === 0 &&
						(local.loading || cloud.state.phase === "loading")
					}
					error={
						cloud.state.phase === "error"
							? cloud.state.message
							: local.unavailableMachineIds.length > 0
								? "Some paired computers could not be refreshed."
								: undefined
					}
					now={renderedAt}
					{...(activeKey ? { activeKey } : {})}
					onClose={sidebar.close}
					onNew={() => setHistoryOpen(false)}
					onOpen={openHistoryRow}
					{...(onOpenSettings
						? {
								onOpenSettings: () => {
									setHistoryOpen(false);
									onOpenSettings();
								},
							}
						: {})}
				/>
			}
		>
			<View
				style={{
					flex: 1,
					backgroundColor: theme.color.canvas,
					paddingTop: insets.top,
				}}
			>
				<ScreenHeader
					transparent
					leading={
						sidebar.wide && sidebar.visible ? undefined : (
							<IconButton
								accessibilityLabel="All sessions"
								onPress={openHistory}
							>
								<PanelLeft size={21} color={theme.color.text} />
							</IconButton>
						)
					}
					trailing={
						<HomeActions {...(onOpenSettings ? { onOpenSettings } : {})} />
					}
				/>

				<IntroScreen
					contextControl={contextControl}
					composer={composer}
					setup={
						needsCloudSetup
							? cloudCanStart
								? cloudWorkspace.setupContent
								: cloudNotice
							: undefined
					}
					notice={needsCloudSetup ? undefined : cloudNotice}
					{...(cloudStarts.length > 0
						? {
								progress: (
									<CloudStartJobs
										jobs={cloudStarts}
										cloudState={cloud.state}
										onCheckSessions={openRecoveryHistory}
										onSignIn={cloud.signIn}
										onOpen={(job) => {
											if (job.phase !== "ready") return;
											cloudStartStore.remove(job.id);
											open(
												job.descriptor,
												job.submitted ? undefined : job.message,
												!job.submitted,
												job.submitted ? undefined : job.attachments,
											);
										}}
									/>
								),
							}
						: {})}
				/>

				{cloudWorkspace.sheets}
				<HomeTargetSheet
					targets={targets}
					selectedKey={target?.id}
					sheetRef={targetSheetRef}
					onSelect={(nextTarget) => {
						setChoosingCloud(false);
						void select(nextTarget.id).catch(() => {});
						targetSheetRef.current?.close();
						if (
							nextTarget.mode === "local-session" ||
							nextTarget.mode === "cloud-session"
						) {
							open(nextTarget.descriptor);
							return;
						}
						setSelectedKey(nextTarget.id);
					}}
					{...(cloudAuthenticated || onConfigureCloud
						? {
								onConfigureCloud: () => {
									targetSheetRef.current?.close();
									if (cloudAuthenticated) {
										setChoosingCloud(true);
										return;
									}
									onConfigureCloud?.();
								},
							}
						: {})}
				/>
				{showAutoApprove && (
					<AutoApproveSheet
						sheetRef={autoApproveSheetRef}
						policy={policy}
						onSetTier={(tier, value) => void setTier(tier, value)}
						onSetPolicy={(next) => void approvalPolicyStore.setPolicy(next)}
					/>
				)}
				<ModelSheet
					settings={(dismiss) =>
						target?.mode === "cloud" ? (
							<ReasoningPill
								value={target.cloud.reasoning}
								supported={supportsReasoning}
								loading={checkingImageSupport}
								onPress={() => {
									dismiss(() =>
										expandBottomSheetAfterKeyboardDismiss(reasoningSheetRef),
									);
								}}
							/>
						) : showAutoApprove ? (
							<AutoApprovePill
								policy={policy}
								onPress={() => {
									dismiss(() =>
										expandBottomSheetAfterKeyboardDismiss(autoApproveSheetRef),
									);
								}}
							/>
						) : null
					}
					cloud={cloudMode}
					cachedModels={cloudMode ? cloudModels : undefined}
					initialSection={modelSection}
					sheetRef={modelSheetRef}
					providerId={selectedProviderId}
					modelId={selectedModelId}
					canChange={canChooseNewModel}
					loadModels={loadTargetModels}
					onChange={changeTargetModel}
				/>
				{target?.mode === "cloud" ? (
					<ReasoningSheet
						sheetRef={reasoningSheetRef}
						value={target.cloud.reasoning}
						supported={supportsReasoning}
						onChange={(choice) => {
							void saveCloudTarget({ ...target.cloud, reasoning: choice });
						}}
					/>
				) : null}
			</View>
		</AdaptiveSessionLayout>
	);
}

function CloudStartJobs({
	jobs,
	cloudState,
	onCheckSessions,
	onSignIn,
	onOpen,
}: {
	jobs: readonly CloudStartJob[];
	cloudState: CloudSessionsState;
	onCheckSessions(job: CloudStartJob): void;
	onSignIn(): void;
	onOpen(job: CloudStartJob): void;
}) {
	return (
		<View style={{ gap: 8 }}>
			{jobs.map((job) => (
				<Card key={job.id} padding={16} radius={undefined} style={{ gap: 8 }}>
					<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
						{job.phase === "provisioning" ? <Spinner size={14} /> : null}
						<Text
							variant="body"
							weight="500"
							tone={job.phase === "error" ? "danger" : "default"}
						>
							{job.phase === "provisioning"
								? `Setting up ${job.target.label}…`
								: job.phase === "ready"
									? `${job.target.label} is ready`
									: `${job.target.label} could not start`}
						</Text>
					</View>
					<Text variant="small" tone="muted" numberOfLines={2}>
						{job.phase === "provisioning"
							? "You can use other sessions while this starts."
							: job.phase === "ready"
								? `${job.submitted ? "Open conversation" : "Open to send"}: ${cloudStartSubmissionLabel(job)}`
								: `Failed to start ${cloudStartSubmissionLabel(job)}: ${job.error}`}
					</Text>
					{job.phase === "ready" ? (
						<Button
							label={`Open ${job.target.label}`}
							variant="outline"
							fullWidth
							onPress={() => onOpen(job)}
						/>
					) : job.phase === "error" ? (
						<View style={{ flexDirection: "row", gap: 8 }}>
							{job.recovery === "check-sessions" ? (
								<Button
									label="Check sessions"
									variant="outline"
									onPress={() => onCheckSessions(job)}
								/>
							) : isCloudStartAuthenticationError(job.error) &&
								cloudState.phase !== "ready" ? (
								<Button
									label="Sign in to retry"
									variant="outline"
									onPress={onSignIn}
								/>
							) : (
								<Button
									label={`Retry ${job.target.label}`}
									variant="outline"
									onPress={() => cloudStartStore.retry(job.id)}
								/>
							)}
							<Button
								label="Dismiss"
								variant="ghost"
								onPress={() => cloudStartStore.remove(job.id)}
							/>
						</View>
					) : null}
				</Card>
			))}
		</View>
	);
}

function cloudStartSubmissionLabel(job: CloudStartJob): string {
	const message = job.message.trim();
	if (message) return `“${message}”`;
	const count = job.attachments?.userImages?.length ?? 0;
	return count === 1 ? "1 image" : `${count} images`;
}

function HomeActions({ onOpenSettings }: { onOpenSettings?: () => void }) {
	const theme = useTheme();
	return (
		<View
			style={{ flexDirection: "row", alignItems: "center", paddingRight: 6 }}
		>
			{onOpenSettings ? (
				<IconButton accessibilityLabel="Settings" onPress={onOpenSettings}>
					<Settings size={18} color={theme.color.textMuted} />
				</IconButton>
			) : null}
		</View>
	);
}

function CloudNotice({
	state,
	onboarding = false,
	cloudTargetSelected,
	accountScopeKnown,
	onRetry,
	onSignIn,
	onOpenBrowser,
}: {
	state: CloudSessionsState;
	onboarding?: boolean;
	cloudTargetSelected: boolean;
	accountScopeKnown: boolean;
	onRetry: () => void;
	onSignIn: () => void;
	onOpenBrowser: () => void;
}) {
	const accountReadyDespiteListState =
		accountScopeKnown &&
		(state.phase === "loading" || state.phase === "error") &&
		state.authenticated === true;
	if (
		state.phase === "ready" ||
		!cloudTargetSelected ||
		accountReadyDespiteListState
	)
		return null;
	if (state.phase === "loading")
		return (
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Spinner size={14} />
				<Text variant="small" tone="muted" accessibilityLiveRegion="polite">
					Checking your Cline account…
				</Text>
			</View>
		);
	const progress =
		state.phase === "starting" || state.phase === "authorizing" ? (
			<CloudSignInProgress state={state} onOpenBrowser={onOpenBrowser} />
		) : state.phase === "error" && state.detail ? (
			<Text variant="caption" tone="muted" numberOfLines={2} selectable>
				{`Details: ${state.detail}`}
			</Text>
		) : undefined;
	if (onboarding)
		return (
			<CloudOnboardingCard
				variant={
					state.phase === "error" && state.recovery !== "sign-in"
						? "error"
						: "signed_out"
				}
				signingIn={state.phase === "starting" || state.phase === "authorizing"}
				onSignIn={onSignIn}
				onRefresh={onRetry}
				progress={progress}
			/>
		);

	return (
		<CloudAccountCard
			state={state}
			onSignIn={onSignIn}
			onRefresh={onRetry}
			progress={
				<View style={{ gap: 8 }}>
					{progress}
					{COMPUTER_CONNECTIONS_ENABLED && state.phase === "error" ? (
						<Text variant="caption" tone="muted">
							Computer sessions remain available in Session history.
						</Text>
					) : null}
					<Text variant="caption" tone="muted">
						Your draft will stay here.
					</Text>
				</View>
			}
		/>
	);
}
