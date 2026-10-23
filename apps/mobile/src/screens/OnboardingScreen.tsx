import { ArrowLeft, Check, Cloud, GitFork } from "lucide-react-native";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	AccessibilityInfo,
	AppState,
	Linking,
	Platform,
	Pressable,
	ScrollView,
	useWindowDimensions,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
	type CloudModelOption,
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
import { useCloudAccountScope } from "@/state/cloud-auth";
import type { CloudExecutionTarget } from "@/state/execution-target-store";
import {
	AgentWelcomeHero,
	Button,
	Card,
	Disclosure,
	IconButton,
	Spinner,
	Text,
	TextField,
	useTheme,
} from "@/ui";
import { CloudSignInProgress } from "./home/CloudAccountCard";
import type { CloudSessionsState } from "./home/cloud-sessions";
import { pinnedBranchChoices, useCloudBranches } from "./home/useCloudBranches";

export interface OnboardingScreenProps {
	cloudState: CloudSessionsState;
	onSignIn(): void;
	onRetryCloud(): void;
	onOpenCloudSignIn?(): void;
	onOpenSettings?(): void;
	onFinish?(): void;
	onSaveCloudTarget(
		input: Omit<CloudExecutionTarget, "id" | "mode">,
	): Promise<unknown>;
}

type OptionsState =
	| { phase: "idle" }
	| { phase: "loading" }
	| {
			phase: "ready";
			repositories: CloudRepository[];
			models: CloudModelOption[];
	  }
	| { phase: "error"; message: string; githubMissing: boolean };

type OnboardingStep = "welcome" | "connect";

export function isCompactOnboardingLayout(width: number): boolean {
	return width <= 720;
}

export function OnboardingScreen({
	cloudState,
	onSignIn,
	onRetryCloud,
	onOpenCloudSignIn,
	onOpenSettings,
	onFinish,
	onSaveCloudTarget,
}: OnboardingScreenProps) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const { height } = useWindowDimensions();
	const shortHeight = height < 500;
	// Opening setup from Settings should go straight to the choices. A genuine
	// first run follows Desktop's welcome -> connect progression.
	const [step, setStep] = useState<OnboardingStep>(
		onFinish ? "connect" : "welcome",
	);
	const [options, setOptions] = useState<OptionsState>({ phase: "idle" });
	const [optionsRequest, setOptionsRequest] = useState(0);
	const { scope } = useCloudAccountScope();
	const [repositoryScope, setRepositoryScope] = useState<string>();
	const accountGateway = useMemo(
		() =>
			new CloudAccountGateway({
				apiBaseUrl: cloudEnv.apiBaseUrl,
				getAccessToken: () => cloudAuthStore.getValidAccessToken(),
			}),
		[],
	);
	const [selectedRepo, setSelectedRepo] = useState<CloudRepository>();
	const [selectedModel, setSelectedModel] = useState<CloudModelOption>();
	/** Branch for new sessions. `undefined` = the repository's default. */
	const [selectedBranch, setSelectedBranch] = useState<string>();
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string>();
	const gateway = useMemo(
		() =>
			new CloudSetupGateway({
				apiBaseUrl: cloudEnv.apiBaseUrl,
				getAccessToken: () => cloudAuthStore.getValidAccessToken(),
			}),
		[],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: optionsRequest retries discovery after the user returns from GitHub or taps Reload.
	useEffect(() => {
		if (cloudState.phase !== "ready") return;
		let active = true;
		setOptions({ phase: "loading" });
		setSelectedRepo(undefined);
		setSelectedBranch(undefined);
		void (async () => {
			const organizationId = scope
				? scope.organizationId
				: (await accountGateway.listAccounts()).find(
						(account) => account.active,
					)?.organizationId;
			if (!active) return undefined;
			setRepositoryScope(organizationId);
			return Promise.all([
				gateway.listRepositories(organizationId),
				gateway.listRecommendedModels(),
			]);
		})()
			.then((result) => {
				if (!active || !result) return;
				const [repositories, models] = result;
				setOptions({ phase: "ready", repositories, models });
				setSelectedRepo(repositories[0]);
				setSelectedModel(
					(current) =>
						models.find((model) => model.id === current?.id) ?? models[0],
				);
			})
			.catch((error) => {
				if (!active) return;
				setOptions({
					phase: "error",
					message: userErrorMessage(
						error,
						"Cline Cloud setup could not be loaded.",
					),
					githubMissing:
						error instanceof CloudSetupApiError && error.status === 404,
				});
			});
		return () => {
			active = false;
		};
	}, [cloudState.phase, gateway, accountGateway, optionsRequest, scope]);

	const saveCloud = () => {
		if (options.phase !== "ready" || !selectedRepo || !selectedModel || saving)
			return;
		setSaveError(undefined);
		setSaving(true);
		void onSaveCloudTarget({
			repoUrl: selectedRepo.repoUrl,
			label: selectedRepo.fullName,
			modelId: selectedModel.id,
			...(repositoryScope ? { organizationId: repositoryScope } : {}),
			// Only an explicit choice is persisted; absent means the repository's
			// default, which Cloud API resolves at session start.
			...(selectedBranch ? { branch: selectedBranch } : {}),
		})
			.then(() => onFinish?.())
			.catch((error) => {
				setSaveError(
					userErrorMessage(error, "Cline Cloud setup could not be saved."),
				);
			})
			.finally(() => setSaving(false));
	};

	const cloudBody = (
		<CloudSetupBody
			cloudState={cloudState}
			options={options}
			selectedRepo={selectedRepo}
			selectedModel={selectedModel}
			selectedBranch={selectedBranch}
			gateway={gateway}
			organizationId={repositoryScope}
			saving={saving}
			saveError={saveError}
			onSignIn={onSignIn}
			onRetryCloud={onRetryCloud}
			onOpenCloudSignIn={onOpenCloudSignIn}
			onReloadOptions={() => setOptionsRequest((value) => value + 1)}
			onSelectRepo={(repo) => {
				setSelectedRepo(repo);
				// A branch belongs to one repository; carrying it across would
				// silently target a branch the new repository may not have.
				setSelectedBranch(undefined);
			}}
			onSelectBranch={setSelectedBranch}
			onSelectModel={setSelectedModel}
			onSave={saveCloud}
		/>
	);

	return (
		<View
			testID="onboarding-root"
			style={{ flex: 1, backgroundColor: theme.color.canvas }}
		>
			<View
				pointerEvents="none"
				testID="onboarding-grid"
				style={{
					position: "absolute",
					left: 0,
					right: 0,
					top: 0,
					bottom: 0,
				}}
			>
				<AgentWelcomeHero layout="full-bleed" variant="grid-only" />
			</View>

			{step === "welcome" ? (
				<ScrollView
					style={{ flex: 1 }}
					contentContainerStyle={{
						flexGrow: 1,
						justifyContent: "center",
						paddingTop: insets.top + (shortHeight ? 12 : 24),
						paddingLeft: insets.left + 24,
						paddingRight: insets.right + 24,
						paddingBottom: insets.bottom + (shortHeight ? 12 : 24),
					}}
				>
					<View
						testID="onboarding-welcome-content"
						style={{
							width: "100%",
							maxWidth: 592,
							alignSelf: "center",
							alignItems: "center",
							paddingVertical: shortHeight ? 0 : 16,
						}}
					>
						<AgentWelcomeHero
							variant="bot-only"
							height={shortHeight ? 96 : 220}
						/>
						<Text
							variant="hero"
							weight="600"
							accessibilityRole="header"
							style={{ marginTop: shortHeight ? 8 : 20, textAlign: "center" }}
						>
							Cline
						</Text>
						<Text
							variant="heading"
							weight="400"
							style={{ marginTop: 8, textAlign: "center" }}
						>
							Build software your way
						</Text>
						<Text
							variant="body"
							tone="muted"
							style={{
								marginTop: shortHeight ? 12 : 24,
								textAlign: "center",
								lineHeight: 21,
							}}
						>
							Cline is an AI coding agent. It reads your code, edits files, runs
							commands, and works through tasks with you in Cline Cloud.
						</Text>
						<View
							testID="onboarding-primary-action"
							style={{
								marginTop: shortHeight ? 16 : 32,
								width: "100%",
								maxWidth: 256,
								alignSelf: "center",
							}}
						>
							<Button
								label="Get started"
								fullWidth
								onPress={() => setStep("connect")}
							/>
						</View>
						<Text
							variant="caption"
							tone="muted"
							style={{ marginTop: shortHeight ? 12 : 32, textAlign: "center" }}
						>
							Takes less than a minute. Everything can be changed later in
							Settings.
						</Text>
					</View>
				</ScrollView>
			) : (
				<ScrollView
					style={{ flex: 1 }}
					automaticallyAdjustKeyboardInsets
					keyboardDismissMode="interactive"
					keyboardShouldPersistTaps="handled"
					contentContainerStyle={{
						flexGrow: 1,
						justifyContent: "center",
						paddingTop: insets.top + 24,
						paddingLeft: insets.left + 20,
						paddingRight: insets.right + 20,
						paddingBottom: insets.bottom + 24,
					}}
				>
					<Card
						padding={20}
						style={{ width: "100%", maxWidth: 592, alignSelf: "center" }}
					>
						<View
							testID="onboarding-setup-header"
							style={{
								flexDirection: "row",
								alignItems: "center",
								marginLeft: -10,
							}}
						>
							<IconButton
								accessibilityLabel="Back"
								onPress={() => (onFinish ? onFinish() : setStep("welcome"))}
							>
								<ArrowLeft size={18} color={theme.color.text} />
							</IconButton>
							<Text
								variant="title"
								weight="600"
								accessibilityRole="header"
								style={{ flex: 1, marginLeft: 4 }}
							>
								Set up Cline
							</Text>
						</View>
						<Text variant="body" tone="muted" style={{ marginTop: 16 }}>
							Connect Cline Cloud to start working from your phone.
						</Text>

						<View style={{ marginTop: 32, gap: 12 }}>
							<SetupOptionCard
								heading={
									<SetupHeading
										icon={<Cloud size={18} color={theme.color.textMuted} />}
										title="Cline Cloud"
										body="Sign in, choose a GitHub repository and model, then start from this phone."
									/>
								}
							>
								{cloudBody}
							</SetupOptionCard>
						</View>

						{COMPUTER_CONNECTIONS_ENABLED && onOpenSettings ? (
							<Button
								label="Advanced connection"
								variant="ghost"
								fullWidth
								style={{ marginTop: 16 }}
								onPress={onOpenSettings}
							/>
						) : null}
						{onFinish ? (
							<Button
								label="Done"
								fullWidth
								style={{ marginTop: 12 }}
								onPress={onFinish}
							/>
						) : null}
					</Card>
				</ScrollView>
			)}
		</View>
	);
}

function useAccessibilityAnnouncement(message?: string) {
	useEffect(() => {
		if (Platform.OS === "ios" && message) {
			AccessibilityInfo.announceForAccessibility(message);
		}
	}, [message]);
}

function SetupHeading({
	icon,
	title,
	body,
	accessory,
}: {
	icon: ReactNode;
	title: string;
	body: string;
	accessory?: string;
}) {
	const { width } = useWindowDimensions();
	const compact = isCompactOnboardingLayout(width);
	const iconBox = (
		<View
			style={{
				width: 32,
				height: 32,
				alignItems: "center",
				justifyContent: "center",
				borderRadius: 8,
			}}
		>
			{icon}
		</View>
	);
	const badge = accessory ? (
		<View
			style={{
				borderWidth: 1,
				borderColor: "rgba(159, 122, 234, 0.35)",
				backgroundColor: "rgba(159, 122, 234, 0.10)",
				borderRadius: 4,
				paddingHorizontal: 6,
				paddingVertical: 3,
			}}
		>
			<Text variant="caption" tone="accent">
				{accessory}
			</Text>
		</View>
	) : null;
	if (!compact) {
		return (
			<View
				testID="setup-option-heading-wide"
				style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}
			>
				{iconBox}
				<View style={{ flex: 1, gap: 6 }}>
					<Text variant="heading">{title}</Text>
					<Text variant="small" tone="muted" style={{ lineHeight: 19 }}>
						{body}
					</Text>
				</View>
				{badge}
			</View>
		);
	}
	return (
		<View style={{ gap: 10 }}>
			<View
				testID="setup-option-heading-row"
				style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
			>
				{iconBox}
				<View style={{ flex: 1 }} />
				{badge}
			</View>
			<Text variant="heading">{title}</Text>
			<Text variant="small" tone="muted" style={{ lineHeight: 19 }}>
				{body}
			</Text>
		</View>
	);
}

function SetupOptionCard({
	heading,
	children,
}: {
	heading: ReactNode;
	children: ReactNode;
}) {
	const theme = useTheme();
	return (
		<View
			style={{
				borderWidth: 1,
				borderColor: theme.brand.violetBorder,
				borderRadius: 12,
				backgroundColor: theme.color.surfaceMuted,
				padding: 16,
			}}
		>
			<View style={{ minHeight: 44, justifyContent: "center" }}>{heading}</View>
			<View style={{ marginTop: 24 }}>{children}</View>
		</View>
	);
}

function CloudSetupBody({
	cloudState,
	options,
	selectedRepo,
	selectedModel,
	selectedBranch,
	gateway,
	organizationId,
	saving,
	saveError,
	onSignIn,
	onRetryCloud,
	onOpenCloudSignIn,
	onReloadOptions,
	onSelectRepo,
	onSelectBranch,
	onSelectModel,
	onSave,
}: {
	cloudState: CloudSessionsState;
	options: OptionsState;
	selectedRepo?: CloudRepository;
	selectedModel?: CloudModelOption;
	selectedBranch?: string;
	gateway: CloudSetupGateway;
	organizationId?: string;
	saving: boolean;
	saveError?: string;
	onSignIn(): void;
	onRetryCloud(): void;
	onOpenCloudSignIn?(): void;
	onReloadOptions(): void;
	onSelectRepo(repo: CloudRepository): void;
	onSelectBranch(branch: string | undefined): void;
	onSelectModel(model: CloudModelOption): void;
	onSave(): void;
}) {
	const [repoQuery, setRepoQuery] = useState("");
	const [modelQuery, setModelQuery] = useState("");
	const [githubOpenError, setGitHubOpenError] = useState<string>();
	const githubGateway = useMemo(
		() =>
			new CloudGitHubGateway({
				apiBaseUrl: cloudEnv.apiBaseUrl,
				getAccessToken: () => cloudAuthStore.getValidAccessToken(),
			}),
		[],
	);
	const githubNeedsAttention =
		(options.phase === "error" && options.githubMissing) ||
		(options.phase === "ready" && options.repositories.length === 0);
	useAccessibilityAnnouncement(
		cloudState.phase === "error"
			? cloudState.message
			: options.phase === "error"
				? options.message
				: (githubOpenError ??
					saveError ??
					(options.phase === "ready" && options.repositories.length === 0
						? "No repositories are available. Connect GitHub or update repository access, then try again."
						: undefined)),
	);

	// GitHub setup completes in the browser. Refresh once when the person returns
	// instead of leaving them on a stale error until they discover "Try again".
	useEffect(() => {
		if (!githubNeedsAttention) return;
		let leftApp = AppState.currentState !== "active";
		const subscription = AppState.addEventListener("change", (nextState) => {
			if (nextState !== "active") {
				leftApp = true;
				return;
			}
			if (leftApp) {
				leftApp = false;
				onReloadOptions();
			}
		});
		return () => subscription.remove();
	}, [githubNeedsAttention, onReloadOptions]);

	const openGitHubSettings = async () => {
		setGitHubOpenError(undefined);
		try {
			const url = await githubGateway.resolveInstallUrl(
				organizationId,
				options.phase === "ready" ? "add-repositories" : "connect",
			);
			await Linking.openURL(url);
		} catch (error) {
			setGitHubOpenError(
				userErrorMessage(error, "GitHub could not be opened. Try again."),
			);
		}
	};

	if (cloudState.phase === "signed-out") {
		return (
			<Button
				label="Sign in"
				accessibilityLabel="Sign in to Cline"
				fullWidth
				onPress={onSignIn}
			/>
		);
	}
	if (cloudState.phase === "starting") {
		return <LoadingLine label="Starting secure sign-in…" />;
	}
	if (cloudState.phase === "loading") {
		return <LoadingLine label="Checking your Cline account…" />;
	}
	if (cloudState.phase === "authorizing") {
		return (
			<View style={{ gap: 10 }}>
				<CloudSignInProgress
					state={cloudState}
					onOpenBrowser={onOpenCloudSignIn}
				/>
				<Button
					label="Cancel sign-in"
					accessibilityLabel="Cancel sign-in"
					variant="ghost"
					onPress={onRetryCloud}
				/>
			</View>
		);
	}
	if (cloudState.phase === "error") {
		return (
			<View style={{ gap: 8 }}>
				<Text variant="small" tone="danger" accessibilityLiveRegion="polite">
					{cloudState.message}
				</Text>
				{cloudState.detail ? (
					<Disclosure label="Technical details" defaultExpanded={false}>
						<Text variant="caption" tone="muted" selectable>
							{cloudState.detail}
						</Text>
					</Disclosure>
				) : null}
				<Button
					label={
						cloudState.recovery === "sign-in" ? "Sign in again" : "Try again"
					}
					variant="outline"
					onPress={cloudState.recovery === "sign-in" ? onSignIn : onRetryCloud}
				/>
			</View>
		);
	}
	if (options.phase === "idle" || options.phase === "loading") {
		return <LoadingLine label="Loading repositories and models…" />;
	}
	if (options.phase === "error") {
		return (
			<View style={{ gap: 8 }}>
				<Text variant="small" tone="danger" accessibilityLiveRegion="polite">
					{options.message}
				</Text>
				{options.githubMissing ? (
					<Button
						label="Connect GitHub"
						icon={<GitFork size={15} color="white" />}
						onPress={openGitHubSettings}
					/>
				) : null}
				{githubOpenError ? (
					<Text variant="small" tone="danger" accessibilityLiveRegion="polite">
						{githubOpenError}
					</Text>
				) : null}
				<Button label="Try again" variant="outline" onPress={onReloadOptions} />
			</View>
		);
	}
	if (options.repositories.length === 0) {
		return (
			<View style={{ gap: 8 }}>
				<Text variant="small" tone="muted">
					No repositories are available. Connect GitHub or update repository
					access, then try again.
				</Text>
				<Button
					label="Connect GitHub"
					icon={<GitFork size={15} color="white" />}
					onPress={openGitHubSettings}
				/>
				{githubOpenError ? (
					<Text variant="small" tone="danger" accessibilityLiveRegion="polite">
						{githubOpenError}
					</Text>
				) : null}
				<Button label="Try again" variant="outline" onPress={onReloadOptions} />
			</View>
		);
	}
	const normalizedRepoQuery = repoQuery.trim().toLowerCase();
	const repositories = options.repositories.filter((repo) =>
		`${repo.fullName} ${repo.repoUrl}`
			.toLowerCase()
			.includes(normalizedRepoQuery),
	);
	const normalizedModelQuery = modelQuery.trim().toLowerCase();
	const models = options.models.filter((model) =>
		`${model.name} ${model.id} ${model.tags.join(" ")}`
			.toLowerCase()
			.includes(normalizedModelQuery),
	);
	return (
		<View style={{ gap: 12 }}>
			<OptionGroup label="Repository">
				{options.repositories.length > 8 || repoQuery ? (
					<TextField
						variant="search"
						placeholder="Search repositories…"
						value={repoQuery}
						onChangeText={setRepoQuery}
						accessibilityLabel="Search repositories"
					/>
				) : null}
				{repositories.slice(0, 20).map((repo) => (
					<ChoiceRow
						key={repo.id}
						label={repo.fullName}
						selected={repo.repoUrl === selectedRepo?.repoUrl}
						onPress={() => onSelectRepo(repo)}
					/>
				))}
				{repositories.length === 0 ? (
					<Text variant="small" tone="muted">
						No repositories match your search.
					</Text>
				) : repositories.length > 20 ? (
					<Text variant="caption" tone="muted">
						{repositories.length - 20} more repositories — keep typing to
						narrow.
					</Text>
				) : null}
			</OptionGroup>
			{selectedRepo ? (
				<BranchGroup
					key={JSON.stringify([organizationId, selectedRepo.repoUrl])}
					gateway={gateway}
					repo={selectedRepo}
					organizationId={organizationId}
					selected={selectedBranch}
					onSelect={onSelectBranch}
				/>
			) : null}
			<OptionGroup label="Model">
				{options.models.length > 6 || modelQuery ? (
					<TextField
						variant="search"
						placeholder="Search models…"
						value={modelQuery}
						onChangeText={setModelQuery}
						accessibilityLabel="Search models"
					/>
				) : null}
				{models.slice(0, 20).map((model) => (
					<ChoiceRow
						key={model.id}
						label={model.name}
						detail={model.tags.join(" · ") || model.id}
						selected={model.id === selectedModel?.id}
						onPress={() => onSelectModel(model)}
					/>
				))}
				{models.length === 0 ? (
					<Text variant="small" tone="muted">
						No models match your search.
					</Text>
				) : models.length > 20 ? (
					<Text variant="caption" tone="muted">
						{models.length - 20} more models — keep typing to narrow.
					</Text>
				) : null}
			</OptionGroup>
			<Button
				label="Use Cline Cloud"
				loading={saving}
				loadingLabel="Saving…"
				disabled={!selectedRepo || !selectedModel}
				fullWidth
				onPress={onSave}
			/>
			{saveError ? (
				<Text variant="small" tone="danger" accessibilityLiveRegion="polite">
					{saveError}
				</Text>
			) : null}
		</View>
	);
}

/**
 * Branch choice for new Cloud sessions. Search-first on purpose: a repository
 * can carry tens of thousands of branches, and at that scale a pick list is
 * the fallback, not the navigation — `query` is a repository-wide server-side
 * search, so the branch you want is a few keystrokes away regardless of count.
 * No selection means the repository's default branch.
 */
const BRANCH_ROWS_SHOWN = 6;

function BranchGroup({
	gateway,
	repo,
	organizationId,
	selected,
	onSelect,
}: {
	gateway: CloudSetupGateway;
	repo: CloudRepository;
	organizationId?: string;
	selected?: string;
	onSelect(branch: string | undefined): void;
}) {
	const [query, setQuery] = useState("");
	const resolveRepository = useCallback(async () => repo, [repo]);
	const { state } = useCloudBranches({
		gateway,
		resolveRepository,
		organizationId,
		query,
	});
	const loadError = state.phase === "error" ? state.message : undefined;
	useAccessibilityAnnouncement(loadError);
	const defaultBranch = repo.defaultBranch?.trim() || "main";
	const { rows, pinnedCount } = pinnedBranchChoices({
		defaultBranch,
		selected,
		branches: state.phase === "ready" ? state.branches : [],
	});

	return (
		<OptionGroup label="Branch">
			<TextField
				variant="search"
				placeholder="Search branches…"
				value={query}
				onChangeText={setQuery}
				accessibilityLabel="Search branches"
			/>
			{loadError ? (
				<Text variant="small" tone="danger" accessibilityLiveRegion="polite">
					{loadError}
				</Text>
			) : state.phase !== "ready" ? (
				<LoadingLine label="Loading branches…" />
			) : (
				<>
					{rows.slice(0, BRANCH_ROWS_SHOWN + pinnedCount).map((branch) => (
						<ChoiceRow
							key={branch}
							label={branch}
							{...(branch === defaultBranch ? { detail: "default" } : {})}
							selected={(selected ?? defaultBranch) === branch}
							onPress={() =>
								onSelect(branch === defaultBranch ? undefined : branch)
							}
						/>
					))}
					{state.hasMore ? (
						<Text variant="caption" tone="muted">
							More branches exist — keep typing to narrow.
						</Text>
					) : null}
				</>
			)}
		</OptionGroup>
	);
}

function LoadingLine({ label }: { label: string }) {
	return (
		<View
			accessible
			accessibilityRole="progressbar"
			accessibilityLabel={label}
			accessibilityLiveRegion="polite"
			style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
		>
			<Spinner size={14} />
			<Text variant="small" tone="muted">
				{label}
			</Text>
		</View>
	);
}

function OptionGroup({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<View style={{ gap: 6 }}>
			<Text variant="caption" tone="muted" weight="600">
				{label}
			</Text>
			<View style={{ gap: 4 }}>{children}</View>
		</View>
	);
}

function ChoiceRow({
	label,
	detail,
	selected,
	onPress,
}: {
	label: string;
	detail?: string;
	selected: boolean;
	onPress(): void;
}) {
	const theme = useTheme();
	return (
		<Pressable
			accessibilityRole="radio"
			accessibilityLabel={label}
			accessibilityState={{ checked: selected }}
			onPress={onPress}
			style={({ pressed }) => ({
				minHeight: 46,
				flexDirection: "row",
				alignItems: "center",
				gap: 8,
				paddingHorizontal: 10,
				paddingVertical: 7,
				borderWidth: 1,
				borderColor: selected ? theme.brand.violetBorder : theme.color.border,
				borderRadius: theme.radius.sm,
				backgroundColor:
					pressed || selected ? theme.color.surfaceMuted : "transparent",
			})}
		>
			<View style={{ flex: 1, gap: 1 }}>
				<Text variant="small" weight="500" numberOfLines={1}>
					{label}
				</Text>
				{detail ? (
					<Text variant="caption" tone="muted" numberOfLines={1}>
						{detail}
					</Text>
				) : null}
			</View>
			{selected ? <Check size={15} color={theme.brand.violet} /> : null}
		</Pressable>
	);
}
