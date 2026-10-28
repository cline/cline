import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared";
import type GorhomBottomSheet from "@gorhom/bottom-sheet";
import {
	Check,
	ChevronDown,
	Cloud,
	GitBranch,
	GitFork,
	RefreshCw,
} from "lucide-react-native";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	AppState,
	Linking,
	Pressable,
	View,
	type ViewStyle,
} from "react-native";
import {
	type CloudRepository,
	CloudSetupApiError,
	CloudSetupGateway,
	cloudAuthStore,
} from "@/cloud";
import { CloudAccountGateway } from "@/cloud/rest/CloudAccountGateway";
import { CloudGitHubGateway } from "@/cloud/rest/CloudGitHubGateway";
import { cloudEnv } from "@/config/env";
import { COMPUTER_CONNECTIONS_ENABLED } from "@/config/features";
import { userErrorMessage } from "@/error-message";
import type { CloudExecutionTarget } from "@/state/execution-target-store";
import {
	BottomSheet,
	Button,
	expandBottomSheetAfterKeyboardDismiss,
	Spinner,
	Text,
	TextField,
	useTheme,
} from "@/ui";

import { CloudOnboardingCard } from "./CloudOnboardingCard";
import {
	type CloudBranchesState,
	pinnedBranchChoices,
	useCloudBranches,
} from "./useCloudBranches";

type RepositoriesState =
	| { phase: "idle" }
	| { phase: "loading" }
	| { phase: "ready"; repositories: readonly CloudRepository[] }
	| { phase: "error"; message: string; githubMissing: boolean };

export interface CloudWorkspaceControlsProps {
	target?: CloudExecutionTarget;
	setup?: boolean;
	setupScope?: string;
	onChooseLocation(): void;
	onSaveTarget(
		input: Omit<CloudExecutionTarget, "id" | "mode">,
	): Promise<unknown>;
}

export interface CloudWorkspaceControlsView {
	control: ReactNode;
	locationControl: ReactNode;
	setupContent: ReactNode;
	sheets: ReactNode;
	openRepositories(message?: string): void;
}

function sameRepositoryUrl(left: string, right: string): boolean {
	const normalize = (value: string) =>
		value
			.trim()
			.replace(/\.git$/i, "")
			.replace(/\/+$/, "");
	return normalize(left) === normalize(right);
}

/**
 * Desktop's new-Cloud-work context, with phone-sized selection sheets.
 *
 * The controls render inside Home's scrolling content, while the sheets must be
 * siblings of that content. Keeping those two surfaces separate avoids nested
 * gesture responders swallowing taps on iOS.
 */
export function useCloudWorkspaceControls({
	target,
	setup = false,
	setupScope,
	onChooseLocation,
	onSaveTarget,
}: CloudWorkspaceControlsProps): CloudWorkspaceControlsView {
	const theme = useTheme();
	const contextSheetRef = useRef<GorhomBottomSheet>(null);
	const contextSheetOpen = useRef(false);
	const afterContextClose = useRef<(() => void) | undefined>(undefined);
	const afterBranchClose = useRef<(() => void) | undefined>(undefined);
	const handoffFrame = useRef<number | undefined>(undefined);
	const repositorySheetRef = useRef<GorhomBottomSheet>(null);
	const branchSheetRef = useRef<GorhomBottomSheet>(null);
	const repositoryRequest = useRef(0);
	const [repositories, setRepositories] = useState<RepositoriesState>({
		phase: "idle",
	});
	const [checkingRepositories, setCheckingRepositories] = useState(false);
	const [repositoryQuery, setRepositoryQuery] = useState("");
	const [repositoryMessage, setRepositoryMessage] = useState<string>();
	const [branchQuery, setBranchQuery] = useState("");
	const [branchPickerOpen, setBranchPickerOpen] = useState(false);
	const [repositoryPickerOpen, setRepositoryPickerOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string>();
	const [repositoryScope, setRepositoryScope] = useState<string>();
	useEffect(
		() => () => {
			if (handoffFrame.current !== undefined)
				cancelAnimationFrame(handoffFrame.current);
			afterContextClose.current = undefined;
			afterBranchClose.current = undefined;
		},
		[],
	);
	const finishSheetHandoff = (action: (() => void) | undefined) => {
		if (!action) return;
		// Let the old sheet's closed/backdrop state commit before mounting the
		// next sheet's native hierarchy. Opening both in onChange races Fabric.
		if (handoffFrame.current !== undefined)
			cancelAnimationFrame(handoffFrame.current);
		handoffFrame.current = requestAnimationFrame(() => {
			handoffFrame.current = undefined;
			action();
		});
	};
	const finishBranchClose = () => {
		setBranchPickerOpen(false);
		const action = afterBranchClose.current;
		afterBranchClose.current = undefined;
		finishSheetHandoff(action);
	};
	const accountGateway = useMemo(
		() =>
			new CloudAccountGateway({
				apiBaseUrl: cloudEnv.apiBaseUrl,
				getAccessToken: () => cloudAuthStore.getValidAccessToken(),
			}),
		[],
	);
	const gateway = useMemo(
		() =>
			new CloudSetupGateway({
				apiBaseUrl: cloudEnv.apiBaseUrl,
				getAccessToken: () => cloudAuthStore.getValidAccessToken(),
			}),
		[],
	);

	const githubGateway = useMemo(
		() =>
			new CloudGitHubGateway({
				apiBaseUrl: cloudEnv.apiBaseUrl,
				getAccessToken: () => cloudAuthStore.getValidAccessToken(),
			}),
		[],
	);

	const loadRepositories = useCallback(
		async (keepContent = false) => {
			const request = ++repositoryRequest.current;
			setCheckingRepositories(true);
			if (!keepContent) setRepositories({ phase: "loading" });
			try {
				const availableAccounts = await accountGateway.listAccounts();
				if (request !== repositoryRequest.current) return undefined;
				const scope = availableAccounts.find(
					(account) => account.active,
				)?.organizationId;
				setRepositoryScope(scope);
				const next = await gateway.listRepositories(scope);
				if (request !== repositoryRequest.current) return undefined;
				setRepositories({ phase: "ready", repositories: next });
				return next;
			} catch (error) {
				if (request !== repositoryRequest.current) return undefined;
				setRepositories({
					phase: "error",
					message: userErrorMessage(
						error,
						"Cline Cloud repositories could not be loaded.",
					),
					githubMissing:
						error instanceof CloudSetupApiError && error.status === 404,
				});
				return undefined;
			} finally {
				if (request === repositoryRequest.current)
					setCheckingRepositories(false);
			}
		},
		[accountGateway, gateway],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: A new repository invalidates its discovery state, even within the same account.
	useEffect(() => {
		setRepositories({ phase: "idle" });
		setRepositoryScope(target?.organizationId);
		return () => {
			++repositoryRequest.current;
		};
	}, [target?.organizationId, target?.repoUrl]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: Account changes invalidate repository discovery even without a selected target.
	useEffect(() => {
		if (!setup) return;
		setSaveError(undefined);
		void loadRepositories();
		let previousState = AppState.currentState;
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active" && previousState !== "active") {
				void loadRepositories(true);
			}
			previousState = state;
		});
		return () => {
			++repositoryRequest.current;
			subscription.remove();
		};
	}, [setup, setupScope, loadRepositories]);
	useEffect(() => {
		if (setup || !repositoryPickerOpen) return;
		let previousState = AppState.currentState;
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active" && previousState !== "active")
				void loadRepositories(true);
			previousState = state;
		});
		return () => subscription.remove();
	}, [setup, repositoryPickerOpen, loadRepositories]);

	const leaveContext = (action: () => void) => {
		if (!contextSheetOpen.current) {
			action();
			return;
		}
		// Wait for the context backdrop to leave before opening another sheet.
		afterContextClose.current = action;
		contextSheetRef.current?.close();
	};
	const openRepositories = (message?: string) => {
		const show = () => {
			setSaveError(undefined);
			setRepositoryMessage(message);
			setRepositoryQuery("");
			expandBottomSheetAfterKeyboardDismiss(repositorySheetRef);
			void loadRepositories();
		};
		if (branchPickerOpen) {
			afterBranchClose.current = show;
			branchSheetRef.current?.close();
		} else leaveContext(show);
	};
	const openGitHubIntegrations = async () => {
		setSaveError(undefined);
		try {
			const url = await githubGateway.resolveInstallUrl(
				repositoryScope,
				repositories.phase === "ready" ? "add-repositories" : "connect",
			);
			await Linking.openURL(url);
		} catch (error) {
			setSaveError(
				userErrorMessage(error, "GitHub could not be opened. Try again."),
			);
		}
	};

	const selectRepository = async (repository: CloudRepository) => {
		if (saving) return;
		setSaving(true);
		setSaveError(undefined);
		try {
			const sameRepository =
				target && target.organizationId === repositoryScope
					? sameRepositoryUrl(target.repoUrl, repository.repoUrl)
					: false;
			await onSaveTarget({
				repoUrl: repository.repoUrl,
				label: repository.fullName,
				modelId: target?.modelId || CLINE_DEFAULT_MODEL_ID,
				...(target?.reasoning ? { reasoning: target.reasoning } : {}),
				...(sameRepository && target?.branch ? { branch: target.branch } : {}),
				...(repositoryScope ? { organizationId: repositoryScope } : {}),
			});
			repositorySheetRef.current?.close();
		} catch (error) {
			setSaveError(
				userErrorMessage(error, "That Cloud repository could not be selected."),
			);
		} finally {
			setSaving(false);
		}
	};

	const selectedRepository =
		repositories.phase === "ready" &&
		target &&
		target.organizationId === repositoryScope
			? repositories.repositories.find((repository) =>
					sameRepositoryUrl(repository.repoUrl, target.repoUrl),
				)
			: undefined;

	const resolveBranchRepository = useCallback(async () => {
		if (selectedRepository) return selectedRepository;
		// Branch lookup belongs to the saved target, not the account being browsed
		// in the repository sheet. Keep that sheet's discovery state separate.
		const available = await gateway.listRepositories(target?.organizationId);
		const repository = target
			? available.find((candidate) =>
					sameRepositoryUrl(candidate.repoUrl, target.repoUrl),
				)
			: undefined;
		if (!repository) {
			throw new Error("This repository is no longer available to Cline Cloud.");
		}
		return repository;
	}, [gateway, selectedRepository, target]);
	const { state: branches, reload: reloadBranches } = useCloudBranches({
		gateway,
		resolveRepository: resolveBranchRepository,
		organizationId: target?.organizationId,
		query: branchQuery,
		enabled: branchPickerOpen && target !== undefined,
	});

	const openBranches = () => {
		if (!target) return;
		leaveContext(() => {
			setSaveError(undefined);
			setBranchQuery("");
			setBranchPickerOpen(true);
			expandBottomSheetAfterKeyboardDismiss(branchSheetRef);
		});
	};

	const selectBranch = async (repository: CloudRepository, branch: string) => {
		if (!target || saving) return;
		setSaving(true);
		setSaveError(undefined);
		try {
			const defaultBranch = repository.defaultBranch?.trim() || "main";
			await onSaveTarget({
				repoUrl: target.repoUrl,
				label: target.label,
				modelId: target.modelId,
				...(target.reasoning ? { reasoning: target.reasoning } : {}),
				...(branch === defaultBranch ? {} : { branch }),
				...(target.organizationId
					? { organizationId: target.organizationId }
					: {}),
			});
			branchSheetRef.current?.close();
		} catch (error) {
			setSaveError(
				userErrorMessage(error, "That Cloud branch could not be selected."),
			);
		} finally {
			setSaving(false);
		}
	};

	const normalizedRepositoryQuery = repositoryQuery.trim().toLowerCase();
	const visibleRepositories =
		repositories.phase === "ready"
			? repositories.repositories.filter((repository) =>
					`${repository.fullName} ${repository.repoUrl}`
						.toLowerCase()
						.includes(normalizedRepositoryQuery),
				)
			: [];
	const githubMissing =
		repositories.phase === "error" && repositories.githubMissing;
	const repositoryAccessMissing =
		repositories.phase === "ready" && repositories.repositories.length === 0;
	const savedRepositoryMissing =
		repositories.phase === "ready" &&
		target &&
		target.organizationId === repositoryScope &&
		!selectedRepository;
	const locationControl = COMPUTER_CONNECTIONS_ENABLED ? (
		<ContextButton
			accessibilityLabel="Execution location: Cline Cloud"
			icon={<Cloud size={15} color={theme.color.textMuted} />}
			label="Cloud"
			onPress={onChooseLocation}
			style={{ flexShrink: 0, alignSelf: "flex-start" }}
		/>
	) : null;

	return {
		locationControl,
		openRepositories,
		setupContent:
			setup && (repositories.phase !== "ready" || repositoryAccessMissing) ? (
				<View testID="cloud-workspace-setup">
					{repositories.phase === "idle" || repositories.phase === "loading" ? (
						<LoadingLine label="Checking repositories…" />
					) : (
						<CloudOnboardingCard
							variant={
								githubMissing
									? "not_connected"
									: repositoryAccessMissing
										? "no_repositories"
										: "error"
							}
							checking={checkingRepositories}
							onConnect={() => void openGitHubIntegrations()}
							onRefresh={() => void loadRepositories(true)}
							progress={
								saveError ? (
									<Text variant="small" tone="danger">
										{saveError}
									</Text>
								) : undefined
							}
						/>
					)}
				</View>
			) : null,
		control: (
			<Pressable
				testID="cloud-workspace-controls"
				accessibilityRole="button"
				accessibilityLabel={`Work context: Cloud, ${target ? `${target.label}, ${target.branch || "default branch"}` : "Select repository"}`}
				onPress={() => {
					contextSheetOpen.current = true;
					expandBottomSheetAfterKeyboardDismiss(contextSheetRef);
				}}
				style={({ pressed }) => ({
					minHeight: 44,
					flexDirection: "row",
					alignItems: "center",
					gap: 6,
					borderRadius: theme.radius.sm,
					backgroundColor: pressed ? theme.color.surfaceHover : "transparent",
				})}
			>
				<Cloud size={14} color={theme.color.textMuted} />
				<Text
					variant="small"
					tone="muted"
					numberOfLines={1}
					style={{ flexShrink: 1 }}
				>
					{`Cloud · ${target ? `${target.label} · ${target.branch || "Default"}` : "Select repository"}`}
				</Text>
				<ChevronDown size={14} color={theme.color.textMuted} />
			</Pressable>
		),
		sheets: (
			<>
				<BottomSheet
					ref={contextSheetRef}
					index={-1}
					onChange={(index) => {
						contextSheetOpen.current = index >= 0;
						if (index !== -1) return;
						const action = afterContextClose.current;
						afterContextClose.current = undefined;
						finishSheetHandoff(action);
					}}
					enableDynamicSizing
					enablePanDownToClose
					scrollable
				>
					<View style={{ gap: 8 }}>
						<Text variant="body" weight="500">
							Work context
						</Text>
						{COMPUTER_CONNECTIONS_ENABLED ? (
							<ContextButton
								accessibilityLabel="Execution location: Cline Cloud"
								icon={<Cloud size={15} color={theme.color.textMuted} />}
								label="Location · Cline Cloud"
								onPress={() => leaveContext(onChooseLocation)}
							/>
						) : null}
						<ContextButton
							accessibilityLabel={
								target
									? `Cloud repository: ${target.label}`
									: "Select Cloud repository"
							}
							icon={<GitFork size={15} color={theme.color.textMuted} />}
							label={
								target ? `Repository · ${target.label}` : "Select repository"
							}
							onPress={() => openRepositories()}
						/>
						{target ? (
							<ContextButton
								accessibilityLabel={`Cloud branch: ${target.branch || "default"}`}
								icon={<GitBranch size={15} color={theme.color.textMuted} />}
								label={`Branch · ${target.branch || "Default"}`}
								onPress={openBranches}
							/>
						) : null}
					</View>
				</BottomSheet>
				<BottomSheet
					ref={repositorySheetRef}
					index={-1}
					enableDynamicSizing={false}
					snapPoints={["70%"]}
					keyboardBehavior="fillParent"
					enablePanDownToClose
					onChange={(index) => setRepositoryPickerOpen(index >= 0)}
					scrollable
				>
					<View style={{ gap: 12 }}>
						<Text variant="body" weight="500">
							Choose a repository
						</Text>
						{repositoryMessage ? (
							<Text variant="small" tone="muted">
								{repositoryMessage}
							</Text>
						) : null}
						<TextField
							inBottomSheet
							autoCorrect={false}
							autoCapitalize="none"
							variant="search"
							placeholder="Search repositories…"
							value={repositoryQuery}
							onChangeText={setRepositoryQuery}
							accessibilityLabel="Search Cloud repositories"
						/>
						{savedRepositoryMissing ? (
							<Text variant="small" tone="muted" accessibilityRole="alert">
								{target.label} is no longer available in this account. Choose
								another repository or manage GitHub access.
							</Text>
						) : null}
						{repositories.phase === "loading" ||
						repositories.phase === "idle" ? (
							<LoadingLine label="Loading repositories…" />
						) : repositories.phase === "error" ? (
							<View style={{ gap: 8 }}>
								<Text variant="small" tone="danger">
									{repositories.message}
								</Text>
								<Button
									{...(repositories.githubMissing
										? {
												label: "Connect GitHub",
												icon: (
													<GitFork size={15} color={theme.brand.onViolet} />
												),
												onPress: () => void openGitHubIntegrations(),
											}
										: {
												label: "Try again",
												variant: "outline" as const,
												onPress: () => void loadRepositories(),
											})}
								/>
								{repositories.githubMissing ? (
									<Button
										label="Try again"
										variant="outline"
										onPress={() => void loadRepositories()}
									/>
								) : null}
							</View>
						) : repositories.repositories.length === 0 ? (
							<View style={{ gap: 8 }}>
								<Text variant="small" tone="muted">
									No repositories are available in this account. Manage GitHub
									access or choose another account in Settings.
								</Text>
								<Button
									label="Manage repository access"
									icon={<GitFork size={15} color={theme.brand.onViolet} />}
									onPress={() => void openGitHubIntegrations()}
								/>
								<Button
									label="Refresh repositories"
									variant="outline"
									onPress={() => void loadRepositories()}
								/>
							</View>
						) : visibleRepositories.length === 0 ? (
							<View style={{ gap: 8 }}>
								<Text variant="small" tone="muted">
									No repositories match your search.
								</Text>
								<Button
									label="Clear repository search"
									variant="ghost"
									onPress={() => setRepositoryQuery("")}
								/>
							</View>
						) : (
							visibleRepositories.map((repository) => (
								<ChoiceRow
									key={repository.id}
									label={repository.fullName}
									selected={
										target
											? target.organizationId === repositoryScope &&
												sameRepositoryUrl(repository.repoUrl, target.repoUrl)
											: false
									}
									disabled={saving}
									onPress={() => void selectRepository(repository)}
								/>
							))
						)}
						{repositories.phase === "ready" &&
						repositories.repositories.length > 0 ? (
							<View style={{ gap: 8 }}>
								<Button
									label="Manage repository access"
									variant="outline"
									onPress={() => void openGitHubIntegrations()}
								/>
								<Button
									label="Refresh repositories"
									variant="ghost"
									loading={checkingRepositories}
									onPress={() => void loadRepositories(true)}
								/>
							</View>
						) : null}
						{saveError ? (
							<Text
								variant="small"
								tone="danger"
								accessibilityLiveRegion="polite"
							>
								{saveError}
							</Text>
						) : null}
					</View>
				</BottomSheet>

				<BottomSheet
					ref={branchSheetRef}
					index={-1}
					enableDynamicSizing={false}
					snapPoints={["70%"]}
					keyboardBehavior="fillParent"
					enablePanDownToClose
					onClose={finishBranchClose}
					onChange={(index) => {
						setBranchPickerOpen(index >= 0);
						if (index !== -1) return;
						finishBranchClose();
					}}
					scrollable
				>
					<View style={{ gap: 12 }}>
						<Text variant="body" weight="500">
							Choose a branch
						</Text>
						<TextField
							inBottomSheet
							autoCorrect={false}
							autoCapitalize="none"
							variant="search"
							placeholder="Search branches…"
							value={branchQuery}
							onChangeText={setBranchQuery}
							accessibilityLabel="Search Cloud branches"
						/>
						{branches.phase === "loading" || branches.phase === "idle" ? (
							<LoadingLine label="Loading branches…" />
						) : branches.phase === "error" ? (
							<View style={{ gap: 8 }}>
								<Text variant="small" tone="danger">
									{branches.message}
								</Text>
								<Button
									label="Try again"
									variant="outline"
									icon={<RefreshCw size={14} color={theme.color.text} />}
									onPress={() => void reloadBranches()}
								/>
								<Button
									label="Change repository"
									variant="ghost"
									onPress={() =>
										openRepositories(
											"Choose an available repository to continue. Your draft is unchanged.",
										)
									}
								/>
							</View>
						) : (
							<BranchChoices
								state={branches}
								selected={target?.branch}
								disabled={saving}
								onSelect={(branch) =>
									void selectBranch(branches.repository, branch)
								}
							/>
						)}
						{saveError ? (
							<Text
								variant="small"
								tone="danger"
								accessibilityLiveRegion="polite"
							>
								{saveError}
							</Text>
						) : null}
					</View>
				</BottomSheet>
			</>
		),
	};
}

function BranchChoices({
	state,
	selected,
	disabled,
	onSelect,
}: {
	state: Extract<CloudBranchesState, { phase: "ready" }>;
	selected?: string;
	disabled: boolean;
	onSelect(branch: string): void;
}) {
	const defaultBranch = state.repository.defaultBranch?.trim() || "main";
	const { rows } = pinnedBranchChoices({
		defaultBranch,
		selected,
		branches: state.branches,
	});
	return (
		<View style={{ gap: 4 }}>
			{rows.slice(0, 22).map((branch) => (
				<ChoiceRow
					key={branch}
					label={branch}
					detail={branch === defaultBranch ? "default" : undefined}
					selected={(selected || defaultBranch) === branch}
					disabled={disabled}
					onPress={() => onSelect(branch)}
				/>
			))}
			{state.hasMore ? (
				<Text variant="caption" tone="muted">
					More branches exist — search to narrow the list.
				</Text>
			) : null}
		</View>
	);
}

function ContextButton({
	accessibilityLabel,
	icon,
	label,
	onPress,
	style,
}: {
	accessibilityLabel: string;
	icon?: React.ReactNode;
	label: string;
	onPress(): void;
	style?: ViewStyle;
}) {
	const theme = useTheme();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel}
			onPress={onPress}
			style={({ pressed }) => ({
				minHeight: 44,
				minWidth: 0,
				flexShrink: 1,
				flexDirection: "row",
				alignItems: "center",
				gap: 6,
				paddingHorizontal: 10,
				paddingVertical: 7,
				borderRadius: theme.radius.sm,
				backgroundColor: pressed ? theme.color.surfaceHover : "transparent",
				...style,
			})}
		>
			{icon}
			<Text
				variant="small"
				tone="muted"
				weight="500"
				numberOfLines={1}
				style={{ flexShrink: 1 }}
			>
				{label}
			</Text>
		</Pressable>
	);
}

function ChoiceRow({
	label,
	detail,
	selected,
	disabled,
	onPress,
}: {
	label: string;
	detail?: string;
	selected: boolean;
	disabled: boolean;
	onPress(): void;
}) {
	const theme = useTheme();
	return (
		<Pressable
			accessibilityRole="radio"
			accessibilityLabel={label}
			accessibilityState={{ checked: selected, disabled }}
			disabled={disabled}
			onPress={onPress}
			style={({ pressed }) => ({
				minHeight: 46,
				flexDirection: "row",
				alignItems: "center",
				gap: 8,
				paddingHorizontal: 10,
				paddingVertical: 7,
				borderRadius: theme.radius.sm,
				backgroundColor:
					pressed || selected ? theme.color.surfaceMuted : "transparent",
				opacity: disabled ? 0.6 : 1,
			})}
		>
			<View style={{ flex: 1, gap: 1 }}>
				<Text variant="small" weight="500" numberOfLines={1}>
					{label}
				</Text>
				{detail ? (
					<Text variant="caption" tone="muted">
						{detail}
					</Text>
				) : null}
			</View>
			{selected ? <Check size={15} color={theme.brand.violet} /> : null}
		</Pressable>
	);
}

function LoadingLine({ label }: { label: string }) {
	return (
		<View
			accessible
			accessibilityRole="progressbar"
			accessibilityLabel={label}
			style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
		>
			<Spinner size={14} />
			<Text variant="small" tone="muted">
				{label}
			</Text>
		</View>
	);
}
