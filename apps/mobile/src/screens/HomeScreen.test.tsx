/**
 * The session-first home, as a person meets it.
 *
 * The claims worth holding still: there is no "where does your agent run?"
 * question and no url field on the front door; the empty state names the two real
 * ways to get a session; and a machine row promises nothing it cannot observe.
 * Raw connection details live in Settings, not on this surface.
 */

import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared";
import * as ImagePicker from "expo-image-picker";
import * as Native from "react-native";
import { Alert } from "react-native";
import type { ReactTestInstance } from "react-test-renderer";
import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CloudApi from "@/cloud";

vi.mock("@/config/features", () => ({ COMPUTER_CONNECTIONS_ENABLED: true }));

import {
	ClineAuthStore,
	type CloudModelOption,
	type CloudRepository,
	CloudSessionApiError,
	CloudSetupApiError,
	createInMemoryAuthStorage,
} from "@/cloud";
import { AmbiguousCloudSessionCreateError } from "@/cloud/rest/CloudSessionGateway";
import { CloudSetupGateway as ActualCloudSetupGateway } from "@/cloud/rest/CloudSetupGateway";
import { type ConnectionDescriptor, SavedEndpointsStore } from "@/connection";
import { cloudLaunches } from "@/connection/cloud-launches";
import {
	asRemoteSessionId,
	type RemoteSession,
	type SessionInputAttachments,
} from "@/session";
import {
	CloudAuthProvider,
	type UseCloudAuth,
	useCloudAccountScope,
	useCloudAuth,
} from "@/state/cloud-auth";
import { cloudStartStore } from "@/state/cloud-starts";
import { EndpointsProvider } from "@/state/endpoints";
import {
	type CloudExecutionTarget,
	ExecutionTargetStore,
} from "@/state/execution-target-store";
import { ExecutionTargetsProvider } from "@/state/execution-targets";
import { LastOpenedProvider, LastOpenedStore } from "@/state/last-opened";
import { render } from "../ui/__testing__/render";
import { containsText, findByLabel } from "./__testing__/harness";
import { AutoApprovePill, AutoApproveSheet } from "./chat/AutoApproveControl";
import { ModelSheet } from "./chat/ModelControl";
import { deriveCloudSessionTitle, HomeScreen } from "./HomeScreen";
import { HomeComposer } from "./home/HomeComposer";
import { IntroScreen } from "./home/IntroScreen";
import { SessionSidebar } from "./home/SessionSidebar";

const hoisted = vi.hoisted(() => ({
	getValidAccessToken: vi.fn(async (): Promise<string | null> => null),
	listRemoteSessions: vi.fn(
		async (_organizationId?: string): Promise<unknown[]> => [],
	),
	createRemoteSession: vi.fn(),
	listRepositories: vi.fn(async (): Promise<CloudRepository[]> => []),
	listAccounts:
		vi.fn<
			() => Promise<
				Array<{ name: string; active: boolean; organizationId?: string }>
			>
		>(),
	listBranches: vi.fn(
		async (): Promise<{ branches: string[]; nextToken?: string }> => ({
			branches: [],
		}),
	),
	listRecommendedModels: vi.fn(async (): Promise<CloudModelOption[]> => []),
	gatewayScopes: [] as Array<string | undefined>,
}));

vi.mock("@/cloud", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/cloud")>();
	class FakeGateway {
		private readonly organizationId?: string;
		constructor(options: { organizationId?: string }) {
			this.organizationId = options.organizationId;
			hoisted.gatewayScopes.push(options.organizationId);
		}
		listRemoteSessions = () => hoisted.listRemoteSessions(this.organizationId);
		createRemoteSession = hoisted.createRemoteSession;
	}
	class FakeSetupGateway {
		listRepositories = hoisted.listRepositories;
		listBranches = hoisted.listBranches;
		listRecommendedModels = hoisted.listRecommendedModels;
	}
	return {
		...actual,
		CloudSessionGateway: FakeGateway,
		CloudSetupGateway: FakeSetupGateway,
		cloudAuthStore: {
			identityVersion: 0,
			subscribeIdentity: () => () => {},
			getValidAccessToken: hoisted.getValidAccessToken,
			setCredentials: vi.fn(async () => {}),
		},
	};
});
vi.mock("@/cloud/rest/CloudAccountGateway", () => ({
	CloudAccountGateway: class {
		listAccounts = hoisted.listAccounts;
		switchAccount = async () => {};
	},
}));
const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

const LAPTOP: ConnectionDescriptor = {
	mode: "local",
	url: "ws://192.168.1.20:4599/hub",
	label: "MacBook Pro",
	authToken: "hub-token",
};
const STUDIO: ConnectionDescriptor = {
	mode: "local",
	url: "ws://192.168.1.31:4599/hub",
	label: "Studio",
};
const LAPTOP_SESSION: ConnectionDescriptor = {
	...LAPTOP,
	hubSessionId: "local-laptop-session",
	sessionTitle: "Review mobile",
};
const STUDIO_SESSION: ConnectionDescriptor = {
	...STUDIO,
	hubSessionId: "local-studio-session",
	sessionTitle: "Studio migration",
};
const EXTRA_COMPUTERS: ConnectionDescriptor[] = Array.from(
	{ length: 6 },
	(_, index) => ({
		mode: "local",
		url: `ws://192.168.1.${40 + index}:4599/hub`,
		label: `Computer ${index + 1}`,
	}),
);
const EXTRA_SESSIONS: ConnectionDescriptor[] = EXTRA_COMPUTERS.map(
	(computer, index) => ({
		...computer,
		hubSessionId: `local-session-${index}`,
		sessionTitle: `Computer session ${index + 1}`,
	}),
);

function cloudSession(overrides: Partial<RemoteSession> = {}): RemoteSession {
	return {
		id: asRemoteSessionId("sess_1"),
		sandboxUrl: "https://pod-1.cline.bot/hub",
		status: "running",
		expiredAt: null,
		title: "Fix the flaky test",
		lastActivityAt: NOW - MINUTE,
		...overrides,
	};
}

/** A store holding `descriptors` in the given display order. */
async function seededStore(
	descriptors: ConnectionDescriptor[],
): Promise<SavedEndpointsStore> {
	const store = new SavedEndpointsStore();
	for (const descriptor of [...descriptors].reverse()) {
		await store.save(descriptor);
	}
	return store;
}

function labels(root: ReactTestInstance): string[] {
	return root
		.findAll(
			(node) =>
				typeof node.type === "string" &&
				typeof node.props.accessibilityLabel === "string",
		)
		.map((node) => node.props.accessibilityLabel as string);
}

async function mount(
	options: {
		authStore?: ClineAuthStore;
		endpoints?: ConnectionDescriptor[];
		lastOpened?: Record<string, number>;
		activeKey?: string;
		activeStatus?: "idle" | "running";
		openSessionsOnMount?: boolean;
		preferCloudOnMount?: boolean;
		executionTargetStore?: ExecutionTargetStore;
		recoveryJobId?: string;
		onOpenSession?: (descriptor: ConnectionDescriptor) => void;
		onStartMessage?: (
			descriptor: ConnectionDescriptor,
			message: string,
			createNewSession: boolean,
		) => void;
		onStartSubmission?: (
			descriptor: ConnectionDescriptor,
			message: string | undefined,
			createNewSession: boolean,
			attachments: SessionInputAttachments | undefined,
		) => void;
		onConfigureCloud?: () => void;
		onOpenCloudStart?: (jobId: string) => void;
		cloudTargets?: Array<Omit<CloudExecutionTarget, "id" | "mode">>;
	} = {},
) {
	const endpointStore = await seededStore(options.endpoints ?? []);
	const lastOpenedStore = new LastOpenedStore();
	const executionTargetStore =
		options.executionTargetStore ?? new ExecutionTargetStore();
	for (const target of options.cloudTargets ?? []) {
		await executionTargetStore.saveCloudTarget(target);
	}
	for (const [key, at] of Object.entries(options.lastOpened ?? {})) {
		await lastOpenedStore.touch(key, at);
	}
	let accountScope!: ReturnType<typeof useCloudAccountScope>;
	let auth!: UseCloudAuth;
	function AuthObserver() {
		auth = useCloudAuth();
		return null;
	}
	function AccountObserver() {
		accountScope = useCloudAccountScope();
		return null;
	}
	const result = render(
		<CloudAuthProvider store={options.authStore}>
			{options.authStore ? <AuthObserver /> : null}
			<AccountObserver />
			<EndpointsProvider store={endpointStore}>
				<ExecutionTargetsProvider store={executionTargetStore}>
					<LastOpenedProvider store={lastOpenedStore}>
						<HomeScreen
							onScanHandoff={vi.fn()}
							now={NOW}
							openSessionsOnMount={options.openSessionsOnMount}
							preferCloudOnMount={options.preferCloudOnMount}
							recoveryJobId={options.recoveryJobId}
							{...(options.activeKey ? { activeKey: options.activeKey } : {})}
							{...(options.activeStatus
								? { activeStatus: options.activeStatus }
								: {})}
							onOpenSession={(
								descriptor,
								initialMessage,
								createNewSession,
								attachments,
							) => {
								options.onOpenSession?.(descriptor);
								options.onStartSubmission?.(
									descriptor,
									initialMessage,
									createNewSession ?? false,
									attachments,
								);
								if (initialMessage) {
									options.onStartMessage?.(
										descriptor,
										initialMessage,
										createNewSession ?? false,
									);
								}
							}}
							{...(options.onConfigureCloud
								? { onConfigureCloud: options.onConfigureCloud }
								: {})}
							onOpenCloudStart={options.onOpenCloudStart}
						/>
					</LastOpenedProvider>
				</ExecutionTargetsProvider>
			</EndpointsProvider>
		</CloudAuthProvider>,
	);
	// The mount-time cloud load (and the store hydrations) settle here, so every
	// test asserts on a screen that has finished arriving.
	await act(async () => {});
	return {
		...result,
		getAuth: () => auth,
		getAccountScope: () => accountScope,
		endpointStore,
		lastOpenedStore,
		executionTargetStore,
		selectAccountScope: (organizationId?: string) =>
			accountScope.selectScope({ organizationId }),
	};
}

it("blocks Home new-task submission during an account selection lease while retaining its draft", async () => {
	hoisted.getValidAccessToken.mockResolvedValue("jwt");
	hoisted.listAccounts.mockResolvedValue([{ name: "Personal", active: true }]);
	const screen = await mount({
		cloudTargets: [
			{
				repoUrl: "https://github.com/team/personal",
				label: "team/personal",
				modelId: "model",
			},
			{
				repoUrl: "https://github.com/team/organization",
				label: "team/organization",
				modelId: "model",
				organizationId: "team-a",
			},
		],
	});
	act(() =>
		findByLabel(screen.root, "Message Cline from Home")!.props.onChangeText(
			"Keep this draft",
		),
	);
	let finish!: ReturnType<
		ReturnType<typeof useCloudAccountScope>["beginSelection"]
	>;
	const capturedSend = screen.root.find((node) => node.type === HomeComposer)
		.props.onSend;
	const capturedModelChange = screen.root.find(
		(node) => node.type === ModelSheet,
	).props.onChange;
	let modelChange!: Promise<void>;
	act(() => {
		finish = screen.getAccountScope().beginSelection();
		capturedSend("Keep this draft");
		modelChange = capturedModelChange("model-before-React-commit");
	});
	await act(async () => {
		await modelChange;
	});
	await act(async () =>
		screen.root
			.find((node) => node.type === ModelSheet)
			.props.onChange("model-during-switch"),
	);
	expect(
		screen.executionTargetStore
			.get()
			.cloudTargets.every((row) => row.modelId === "model"),
	).toBe(true);
	act(() =>
		screen.root
			.find((node) => node.type === HomeComposer)
			.props.onSend("Keep this draft"),
	);
	expect(cloudStartStore.getSnapshot()).toHaveLength(0);
	expect(
		screen.root.find((node) => node.type === HomeComposer).props.busy,
	).toBe(true);
	expect(findByLabel(screen.root, "Message Cline from Home")!.props.value).toBe(
		"Keep this draft",
	);
	await act(async () => {
		finish({ organizationId: "team-a" });
		capturedSend("Keep this draft");
		await capturedModelChange("model-after-commit-before-render");
	});
	expect(cloudStartStore.getSnapshot()).toHaveLength(0);
	expect(
		screen.executionTargetStore
			.get()
			.cloudTargets.every((row) => row.modelId === "model"),
	).toBe(true);
	expect(
		screen.root.find((node) => node.type === HomeComposer).props.busy,
	).toBe(false);
	expect(findByLabel(screen.root, "Message Cline from Home")!.props.value).toBe(
		"Keep this draft",
	);
});

it("rejects a captured Home send/model callback immediately after its account scope is retired", async () => {
	hoisted.getValidAccessToken.mockResolvedValue("jwt");
	hoisted.listAccounts.mockResolvedValue([{ name: "Personal", active: true }]);
	const screen = await mount({
		cloudTargets: [
			{
				repoUrl: "https://github.com/team/personal",
				label: "team/personal",
				modelId: "model",
			},
		],
	});
	const send = screen.root.find((node) => node.type === HomeComposer).props
		.onSend;
	const model = screen.root.find((node) => node.type === ModelSheet).props
		.onChange;
	await act(async () => {
		screen.getAccountScope().selectScope(undefined);
		send("Old account input");
		await model("wrong-model");
	});
	expect(cloudStartStore.getSnapshot()).toHaveLength(0);
	expect(screen.executionTargetStore.get().cloudTargets[0]?.modelId).toBe(
		"model",
	);
});

it("retains Home draft and explains a failed account change after leaving Settings", async () => {
	hoisted.getValidAccessToken.mockResolvedValue("jwt");
	hoisted.listAccounts.mockResolvedValue([{ name: "Personal", active: true }]);
	const screen = await mount({
		cloudTargets: [
			{
				repoUrl: "https://github.com/team/personal",
				label: "team/personal",
				modelId: "model",
			},
		],
	});
	act(() =>
		findByLabel(screen.root, "Message Cline from Home")!.props.onChangeText(
			"Keep on failure",
		),
	);
	const capturedModel = screen.root.find((node) => node.type === ModelSheet)
		.props.onChange;
	let pending!: ReturnType<
		ReturnType<typeof useCloudAccountScope>["beginSelection"]
	>;
	act(() => {
		pending = screen.getAccountScope().beginSelection();
	});
	expect(
		screen.root.find((node) => node.type === HomeComposer).props.busy,
	).toBe(true);
	await act(async () => {
		expect(pending.fail()).toBe(true);
		await capturedModel("model-after-failed-selection");
	});
	expect(screen.executionTargetStore.get().cloudTargets[0]?.modelId).toBe(
		"model-after-failed-selection",
	);
	expect(
		screen.root.find((node) => node.type === HomeComposer).props.busy,
	).toBe(false);
	expect(findByLabel(screen.root, "Message Cline from Home")!.props.value).toBe(
		"Keep on failure",
	);
	expect(
		containsText(
			screen.root,
			"Account could not be changed. Your previous account is still selected.",
		),
	).toBe(true);
	expect(screen.getAccountScope().scope).toEqual({
		organizationId: undefined,
		accountName: "Personal",
	});
	expect(cloudStartStore.getSnapshot()).toHaveLength(0);
});

it("keeps Cloud sign-in recovery visible alongside a failed account-selection notice", async () => {
	hoisted.getValidAccessToken.mockResolvedValue("jwt");
	hoisted.listAccounts.mockResolvedValue([{ name: "Personal", active: true }]);
	hoisted.listRemoteSessions.mockRejectedValue(
		new CloudSessionApiError("Unauthorized", 401),
	);
	const screen = await mount({
		cloudTargets: [
			{
				repoUrl: "https://github.com/team/repo",
				label: "team/repo",
				modelId: "model",
			},
		],
	});
	act(() => {
		const selection = screen.getAccountScope().beginSelection();
		selection.fail();
	});
	expect(
		containsText(
			screen.root,
			"Account could not be changed. Your previous account is still selected.",
		),
	).toBe(true);
	expect(findByLabel(screen.root, "Sign in to Cline")).toBeDefined();
	const start = vi.spyOn(CloudApi, "startClineDeviceAuth").mockResolvedValue({
		deviceCode: "reauth",
		userCode: "REAUTH-CODE",
		verificationUri: "https://example.invalid/verify",
		expiresInSeconds: 900,
		pollIntervalSeconds: 1,
	});
	const complete = vi
		.spyOn(CloudApi, "completeClineDeviceAuth")
		.mockReturnValue(new Promise(() => {}));
	try {
		await act(async () =>
			findByLabel(screen.root, "Sign in to Cline")?.props.onPress(),
		);
		expect(containsText(screen.root, "REAUTH-CODE")).toBe(true);
		expect(
			containsText(
				screen.root,
				"Account could not be changed. Your previous account is still selected.",
			),
		).toBe(true);
	} finally {
		start.mockRestore();
		complete.mockRestore();
	}
});

it("retires mounted Home text and images after explicit sign-out and re-sign-in", async () => {
	const credentials = {
		access: "fixture",
		refresh: "fixture-refresh",
		expires: Date.now() + 60_000,
		accountId: "fixture-user",
		email: "fixture@example.invalid",
		metadata: { provider: "cline" as const },
	};
	const authStore = new ClineAuthStore({
		storage: createInMemoryAuthStorage(credentials),
	});
	const mounted = await mount({ endpoints: [LAPTOP], authStore });
	expect(mounted.getAuth().account.phase).toBe("signed-in");
	act(() =>
		findByLabel(mounted.root, "Message Cline from Home")!.props.onChangeText(
			"Private mounted Home draft",
		),
	);
	vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
		canceled: false,
		assets: [
			{
				assetId: null,
				base64: "/9j/",
				duration: null,
				exif: null,
				fileName: "private-image.jpg",
				fileSize: 3,
				height: 1,
				mimeType: "image/jpeg",
				type: "image",
				uri: "file:///private.jpg",
				width: 1,
			},
		],
	});
	act(() => findByLabel(mounted.root, "Add attachment")!.props.onPress());
	await act(async () => {
		vi.mocked(Native.ActionSheetIOS.showActionSheetWithOptions).mock.calls.at(
			-1,
		)![1](0);
	});
	expect(findByLabel(mounted.root, "Remove private-image.jpg")).toBeDefined();
	await act(async () => {
		await mounted.getAuth().signOut();
		await authStore.setCredentials(credentials);
	});
	expect(await authStore.getCredentials()).not.toBeNull();
	expect(
		findByLabel(mounted.root, "Message Cline from Home")!.props.value,
	).toBe("");
	expect(findByLabel(mounted.root, "Remove private-image.jpg")).toBeUndefined();
	mounted.unmount();
});

it.each([
	"jwt",
	null,
])("waits for saved Cloud authentication before showing the start screen (%s)", async (token) => {
	const pendingToken = Promise.withResolvers<string | null>();
	hoisted.getValidAccessToken.mockReturnValueOnce(pendingToken.promise);
	const { root, unmount } = await mount({
		cloudTargets: [
			{
				repoUrl: "https://github.com/team/repo",
				label: "team/repo",
				modelId: "model",
			},
		],
	});
	expect(containsText(root, "Run Cline in the cloud")).toBe(false);
	expect(findByLabel(root, "Opening Cline")).toBeDefined();
	expect(containsText(root, "Loading Cline…")).toBe(false);
	await act(async () => pendingToken.resolve(token));
	expect(findByLabel(root, "Opening Cline")).toBeUndefined();
	expect(containsText(root, "Run Cline in the cloud")).toBe(token === null);
	if (token) expect(findByLabel(root, "Message Cline from Home")).toBeDefined();
	unmount();
});

it("opens the saved Cloud composer while session history is still loading", async () => {
	const history = Promise.withResolvers<unknown[]>();
	hoisted.getValidAccessToken.mockResolvedValue("jwt");
	hoisted.listRemoteSessions.mockReturnValueOnce(history.promise);
	const { root, unmount } = await mount({
		cloudTargets: [
			{
				repoUrl: "https://github.com/team/repo",
				label: "team/repo",
				modelId: "model",
			},
		],
	});
	expect(findByLabel(root, "Opening Cline")).toBeUndefined();
	expect(containsText(root, "Run Cline in the cloud")).toBe(false);
	expect(findByLabel(root, "Message Cline from Home")).toBeDefined();
	act(() =>
		findByLabel(root, "Message Cline from Home")?.props.onChangeText(
			"Keep my draft",
		),
	);
	await act(async () => history.resolve([]));
	expect(findByLabel(root, "Message Cline from Home")?.props.value).toBe(
		"Keep my draft",
	);
	unmount();
});

it("requires a repository after switching accounts without losing the draft or saved targets", async () => {
	hoisted.getValidAccessToken.mockResolvedValue("jwt");
	hoisted.listAccounts.mockResolvedValue([
		{ name: "Team", active: true, organizationId: "old-org" },
	]);
	const { root, selectAccountScope, executionTargetStore } = await mount({
		cloudTargets: [
			{
				repoUrl: "https://github.com/team/repo",
				label: "team/repo",
				modelId: "model",
				organizationId: "old-org",
				branch: "old-branch",
			},
		],
	});
	act(() =>
		findByLabel(root, "Message Cline from Home")?.props.onChangeText(
			"Keep this draft",
		),
	);
	hoisted.listAccounts.mockResolvedValue([{ name: "Personal", active: true }]);
	await act(async () => selectAccountScope());
	expect(findByLabel(root, "Repository required")).toBeUndefined();
	expect(
		root.find((node) => node.type === IntroScreen).props.setup,
	).toBeDefined();
	expect(findByLabel(root, "Send to team/repo")).toBeUndefined();
	expect(
		findByLabel(root, "Send message")?.props.accessibilityState.disabled,
	).toBe(false);
	expect(findByLabel(root, "Message Cline from Home")?.props.value).toBe(
		"Keep this draft",
	);
	expect(executionTargetStore.get().cloudTargets).toHaveLength(1);
	expect(hoisted.listRepositories).toHaveBeenLastCalledWith(undefined);
	expect(hoisted.createRemoteSession).not.toHaveBeenCalled();
	act(() => selectAccountScope("old-org"));
	expect(
		root.find((node) => node.type === IntroScreen).props.setup,
	).toBeUndefined();
	expect(findByLabel(root, "Message Cline from Home")?.props.value).toBe(
		"Keep this draft",
	);
});

it("preserves the draft and model selected before choosing a Cloud repository", async () => {
	hoisted.getValidAccessToken.mockResolvedValue("jwt");
	hoisted.listRepositories.mockResolvedValue([
		{
			id: 1,
			name: "repo",
			fullName: "team/repo",
			repoUrl: "https://github.com/team/repo",
			private: false,
			defaultBranch: "main",
		},
	]);
	const model: CloudModelOption = {
		id: "anthropic/test-model",
		name: "Test model",
		tags: [],
		supportsImages: false,
	};
	hoisted.listRecommendedModels.mockResolvedValue([model]);
	const { root, executionTargetStore } = await mount();
	expect(root.find((node) => node.type === IntroScreen).props.setup).toBeNull();
	expect(findByLabel(root, "Choose repository")).toBeUndefined();
	const composer = root.find((node) => node.type === HomeComposer);
	expect(composer.props.modelId).toBe(CLINE_DEFAULT_MODEL_ID);
	expect(composer.props.onOpenModel).toBeTypeOf("function");
	const picker = root.find((node) => node.type === ModelSheet);
	expect(picker.props.cloud).toBe(true);
	expect(picker.props.canChange).toBe(true);
	await act(async () => picker.props.onChange(model.id, model));
	expect(composer.props.modelId).toBe(model.id);
	expect(composer.props.modelName).toBe(model.name);
	expect(composer.props.supportsImages).toBe(false);
	expect(executionTargetStore.get().cloudTargets).toHaveLength(0);
	act(() =>
		findByLabel(root, "Message Cline from Home")!.props.onChangeText(
			"Keep this draft",
		),
	);
	await act(async () => findByLabel(root, "Send message")!.props.onPress());
	expect(
		containsText(root, "Choose a repository before starting your task."),
	).toBe(true);
	expect(hoisted.createRemoteSession).not.toHaveBeenCalled();
	await act(async () => findByLabel(root, "team/repo")?.props.onPress());
	expect(
		root.find((node) => node.type === IntroScreen).props.setup,
	).toBeUndefined();
	expect(findByLabel(root, "Message Cline from Home")!.props.value).toBe(
		"Keep this draft",
	);
	expect(findByLabel(root, "Cloud repository: team/repo")).toBeDefined();
	expect(findByLabel(root, "Cloud branch: default")).toBeDefined();
	expect(findByLabel(root, "Send to team/repo")).toBeDefined();
	expect(executionTargetStore.get().cloudTargets[0]).toMatchObject({
		repoUrl: "https://github.com/team/repo",
		modelId: model.id,
	});
	expect(composer.props.modelId).toBe(model.id);
	expect(hoisted.createRemoteSession).not.toHaveBeenCalled();
});

it("remembers a separate Cloud model in each account without clearing the draft", async () => {
	hoisted.getValidAccessToken.mockResolvedValue("jwt");
	hoisted.listRepositories.mockResolvedValue([
		{
			id: 1,
			name: "repo",
			fullName: "team/repo",
			repoUrl: "https://github.com/team/repo",
			private: false,
		},
	]);
	hoisted.listRecommendedModels.mockResolvedValue([
		{ id: "custom/model", name: "Custom model", tags: [] },
	]);
	const { root, selectAccountScope, executionTargetStore } = await mount();
	const composer = root.find((node) => node.type === HomeComposer);
	act(() => composer.props.onDraftChange("Keep my draft"));
	await act(async () =>
		root
			.find((node) => node.type === ModelSheet)
			.props.onChange("custom/model"),
	);
	expect(composer.props.modelId).toBe("custom/model");
	hoisted.listAccounts.mockResolvedValue([
		{ name: "Team", active: true, organizationId: "team" },
	]);
	await act(async () => selectAccountScope("team"));
	expect(composer.props.modelId).toBe(CLINE_DEFAULT_MODEL_ID);
	expect(composer.props.draft).toBe("Keep my draft");
	expect(executionTargetStore.get().cloudTargets).toHaveLength(0);
	hoisted.listAccounts.mockResolvedValue([{ name: "Personal", active: true }]);
	await act(async () => selectAccountScope());
	expect(composer.props.modelId).toBe("custom/model");
});

it("consumes rapid Send presses once and allows another new prompt", async () => {
	hoisted.getValidAccessToken.mockResolvedValue("jwt");
	hoisted.createRemoteSession.mockReturnValue(new Promise(() => {}));
	const { root } = await mount({
		cloudTargets: [
			{
				repoUrl: "https://github.com/team/repo",
				label: "team/repo",
				modelId: "model",
			},
		],
	});
	act(() =>
		findByLabel(root, "Message Cline from Home")?.props.onChangeText("First"),
	);
	await act(async () => {
		const send = findByLabel(root, "Send to team/repo")?.props.onPress;
		send();
		send();
	});
	expect(hoisted.createRemoteSession).toHaveBeenCalledTimes(1);
	act(() =>
		findByLabel(root, "Message Cline from Home")?.props.onChangeText("Second"),
	);
	await act(async () =>
		findByLabel(root, "Send to team/repo")?.props.onPress(),
	);
	expect(hoisted.createRemoteSession).toHaveBeenCalledTimes(2);
});

beforeEach(() => {
	vi.spyOn(cloudLaunches, "start").mockImplementation(
		async ({ descriptor, save }) => {
			const next = { ...descriptor };
			delete next.pendingInitialMessage;
			await save(next);
			return next;
		},
	);
	act(() => cloudStartStore.clear());
	vi.clearAllMocks();
	hoisted.getValidAccessToken.mockResolvedValue(null);
	hoisted.listAccounts.mockResolvedValue([{ name: "Personal", active: true }]);
	hoisted.listRemoteSessions.mockResolvedValue([]);
	hoisted.createRemoteSession.mockReset();
	hoisted.listRepositories.mockResolvedValue([]);
	hoisted.listBranches.mockResolvedValue({ branches: [] });
	hoisted.listRecommendedModels.mockResolvedValue([]);
	hoisted.gatewayScopes.length = 0;
});

describe("deriveCloudSessionTitle", () => {
	it("keeps the new-chat composer and draft when resizing and collapsing the sidebar", async () => {
		let width = 390;
		const dimensions = vi
			.spyOn(Native, "useWindowDimensions")
			.mockImplementation(() => ({
				width,
				height: 844,
				scale: 2,
				fontScale: 1,
			}));
		try {
			const { root } = await mount({ endpoints: [LAPTOP] });
			const composer = root.find((node) => node.type === HomeComposer);
			act(() => composer.props.onDraftChange("Keep my draft"));
			width = 874;
			// A draft update rerenders Home with the changed native window measurement.
			act(() => composer.props.onDraftChange("Keep my draft!"));
			const sidebar = () => root.find((node) => node.type === SessionSidebar);
			expect(sidebar().props.presentation).toBe("drawer");
			expect(sidebar().props.open).toBe(false);
			act(() => findByLabel(root, "All sessions")?.props.onPress());
			expect(sidebar().props.open).toBe(true);
			act(() => sidebar().props.onClose());
			expect(sidebar().props.open).toBe(false);
			expect(composer.props.draft).toBe("Keep my draft!");
			width = 1024;
			act(() => composer.props.onDraftChange("Keep my draft on tablet"));
			expect(sidebar().props.presentation).toBe("inline");
			expect(sidebar().props.open).toBe(true);
			expect(root.find((node) => node.type === HomeComposer)).toBe(composer);
			act(() => sidebar().props.onClose());
			expect(sidebar().props.open).toBe(false);
			const dismiss = vi.spyOn(Native.Keyboard, "dismiss");
			act(() => findByLabel(root, "All sessions")?.props.onPress());
			expect(dismiss).not.toHaveBeenCalled();
			dismiss.mockRestore();
			expect(sidebar().props.open).toBe(true);
			width = 390;
			act(() => composer.props.onDraftChange("Keep my draft!!"));
			expect(sidebar().props.presentation).toBe("drawer");
			expect(sidebar().props.open).toBe(false);
			expect(composer.props.draft).toBe("Keep my draft!!");
		} finally {
			dimensions.mockRestore();
		}
	});
	it.each([
		"local",
		"cloud",
		"unselected",
	] as const)("only exposes approval settings for a local new-chat target (%s)", async (mode) => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		const { root } = await mount({
			endpoints: mode === "local" ? [LAPTOP] : [],
			cloudTargets:
				mode === "cloud"
					? [
							{
								repoUrl: "https://github.com/cline/cline",
								label: "cline/cline",
								modelId: "text-model",
							},
						]
					: [],
		});
		const count = mode === "local" ? 1 : 0;
		expect(root.findAll((node) => node.type === AutoApprovePill)).toHaveLength(
			count,
		);
		expect(root.findAll((node) => node.type === AutoApproveSheet)).toHaveLength(
			count,
		);
	});
	it.each([
		"success",
		"failure",
	])("waits for the first Cloud catalog to settle (%s) before allowing images", async (result) => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		let resolve!: (models: CloudModelOption[]) => void;
		let reject!: (error: Error) => void;
		hoisted.listRecommendedModels.mockReturnValue(
			new Promise((done, fail) => {
				resolve = done;
				reject = fail;
			}),
		);
		const { root } = await mount({
			cloudTargets: [
				{
					repoUrl: "https://github.com/cline/cline",
					label: "cline/cline",
					modelId: "text-model",
				},
			],
		});
		expect(
			root.find((node) => node.type === HomeComposer).props
				.checkingImageSupport,
		).toBe(true);
		await act(async () => {
			if (result === "success")
				resolve([
					{ id: "text-model", name: "Text", tags: [], supportsImages: false },
				]);
			else reject(new Error("offline"));
		});
		expect(
			root.find((node) => node.type === HomeComposer).props
				.checkingImageSupport,
		).toBe(false);
		expect(
			root.find((node) => node.type === HomeComposer).props.supportsImages,
		).toBe(result === "success" ? false : undefined);
	});
	it("loads the initial Cloud model capability before opening its picker", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.listRecommendedModels.mockResolvedValue([
			{ id: "text-model", name: "Text model", tags: [], supportsImages: false },
		]);
		const { root } = await mount({
			cloudTargets: [
				{
					repoUrl: "https://github.com/cline/cline",
					label: "cline/cline",
					modelId: "text-model",
				},
			],
		});
		expect(hoisted.listRecommendedModels).toHaveBeenCalled();
		expect(
			root.find((node) => node.type === HomeComposer).props.supportsImages,
		).toBe(false);
	});

	it("starts local work with the provider selected alongside a shared model ID", async () => {
		const onStartMessage = vi.fn();
		const { root } = await mount({
			endpoints: [{ ...LAPTOP, providerId: "alpha", modelId: "shared" }],
			onStartMessage,
		});
		await act(async () =>
			root
				.find((node) => node.type === ModelSheet)
				.props.onChange("shared", {
					id: "shared",
					name: "Shared model",
					providerId: "beta",
					tags: [],
				}),
		);
		act(() =>
			findByLabel(root, "Message Cline from Home")?.props.onChangeText(
				"Review this",
			),
		);
		act(() => findByLabel(root, "Send to MacBook Pro")?.props.onPress());
		expect(onStartMessage).toHaveBeenCalledWith(
			expect.objectContaining({ providerId: "beta", modelId: "shared" }),
			"Review this",
			true,
		);
	});
	it("matches desktop's first-line, 72-character title", () => {
		expect(deriveCloudSessionTitle("  Review auth\nthen fix it  ")).toBe(
			"Review auth",
		);
		expect(deriveCloudSessionTitle("x".repeat(100))).toHaveLength(72);
	});
});

describe("HomeScreen, signed out with nothing saved", () => {
	it("does not offer pairing in the main picker for Cloud-only users", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		const { root } = await mount({
			cloudTargets: [
				{
					repoUrl: "https://github.com/cline/cline",
					label: "cline/cline",
					modelId: "text-model",
				},
			],
		});
		expect(findByLabel(root, "Pair a computer")).toBeUndefined();
		expect(findByLabel(root, "Message Cline from Home")).toBeDefined();
	});
	it("shows setup before promising that a composer can run", async () => {
		const { root } = await mount();
		expect(findByLabel(root, "Message Cline from Home")).toBeUndefined();
		expect(containsText(root, "Build software your way")).toBe(true);
		expect(containsText(root, "Set up Cline")).toBe(false);
		act(() => findByLabel(root, "Get started")?.props.onPress());
		expect(containsText(root, "Set up Cline")).toBe(true);
		expect(findByLabel(root, "Scan handoff QR")).toBeUndefined();
		expect(findByLabel(root, "Sign in to Cline")).toBeDefined();
	});

	it("never asks where the agent runs", async () => {
		const { root } = await mount();
		expect(containsText(root, "My Machine")).toBe(false);
		expect(containsText(root, "Choose where your agent runs")).toBe(false);
	});

	it("offers Cloud setup without local pairing in onboarding", async () => {
		const { root } = await mount();
		act(() => findByLabel(root, "Get started")?.props.onPress());
		expect(findByLabel(root, "Search sessions")).toBeUndefined();
		expect(containsText(root, "My computer")).toBe(false);
		const computer = findByLabel(root, "Select my computer");
		expect(computer).toBeUndefined();
		expect(containsText(root, "/handoff")).toBe(false);
		expect(containsText(root, "Cline Cloud")).toBe(true);
		expect(findByLabel(root, "Sign in to Cline")).toBeDefined();
	});

	it("keeps the url and token fields out of the front door", async () => {
		const { root } = await mount();
		expect(findByLabel(root, "Hub WebSocket URL")).toBeUndefined();
		expect(findByLabel(root, "Hub auth token")).toBeUndefined();
		expect(
			findByLabel(root, "Advanced connection options, expand"),
		).toBeUndefined();
	});

	it("keeps a signed-out Cloud draft and lets the user switch to a computer", async () => {
		const onOpenCloudStart = vi.fn();
		const { root } = await mount({
			endpoints: [LAPTOP],
			cloudTargets: [
				{
					repoUrl: "https://github.com/cline/cline.git",
					label: "cline/cline",
					modelId: "cline/model",
				},
			],
			onOpenCloudStart,
		});

		act(() => {
			findByLabel(root, "Message Cline from Home")?.props.onChangeText(
				"Keep this while I sign in",
			);
		});

		const send = findByLabel(root, "Send to cline/cline");
		expect(
			send?.props.accessibilityState?.disabled ?? send?.props.disabled,
		).toBe(true);
		expect(findByLabel(root, "Sign in to Cline")).toBeDefined();
		expect(containsText(root, "Run Cline in the cloud")).toBe(true);
		expect(findByLabel(root, "Message Cline from Home")?.props.value).toBe(
			"Keep this while I sign in",
		);
		expect(onOpenCloudStart).not.toHaveBeenCalled();
		expect(cloudStartStore.getSnapshot()).toHaveLength(0);
		const setup = root.find((node) => node.type === IntroScreen).props.setup;
		expect(setup).toBeDefined();
		expect(findByLabel(root, "Execution location: Cline Cloud")).toBeDefined();
		act(() =>
			findByLabel(root, "Execution location: Cline Cloud")?.props.onPress(),
		);
		await act(async () =>
			findByLabel(root, "Use MacBook Pro on My computer")?.props.onPress(),
		);
		expect(
			root.find((node) => node.type === IntroScreen).props.setup,
		).toBeUndefined();
		expect(
			findByLabel(root, "Send to MacBook Pro")?.props.accessibilityState
				.disabled,
		).toBe(false);
		expect(findByLabel(root, "Message Cline from Home")?.props.value).toBe(
			"Keep this while I sign in",
		);
	});
});

describe("HomeScreen Cline welcome", () => {
	it("keeps the welcome composer inside the keyboard-avoiding layout", async () => {
		const { root } = await mount({ endpoints: [LAPTOP] });
		const keyboardScroll = root
			.findAll(
				(node) =>
					typeof node.type === "string" && node.type === "KeyboardAvoidingView",
			)
			.at(0);
		expect(keyboardScroll).toBeDefined();
		expect(
			keyboardScroll?.findAll(
				(node) => node.props.accessibilityLabel === "Message Cline from Home",
			).length,
		).toBeGreaterThan(0);
		const target = findByLabel(
			root,
			"Message target: MacBook Pro, My computer",
		);
		expect(target?.props.accessibilityRole).toBe("button");
		expect(target?.props.disabled).toBe(false);
	});

	it("keeps new-work targets separate from session history", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.listRemoteSessions.mockResolvedValue([cloudSession()]);
		const onConfigureCloud = vi.fn();
		const { root } = await mount({
			endpoints: [LAPTOP],
			onConfigureCloud,
		});
		expect(containsText(root, "Start new")).toBe(true);
		expect(findByLabel(root, "Use MacBook Pro on My computer")).toBeDefined();
		expect(findByLabel(root, "Pair a computer")).toBeUndefined();
		expect(containsText(root, "Continue a session")).toBe(false);
		expect(
			findByLabel(root, "Open Fix the flaky test on Cloud pod"),
		).toBeDefined();
		await act(async () => {
			findByLabel(root, "Set up Cline Cloud for new work")?.props.onPress();
		});
		expect(onConfigureCloud).not.toHaveBeenCalled();
		expect(findByLabel(root, "Execution location: Cline Cloud")).toBeDefined();
		expect(findByLabel(root, "Manage repository access")).toBeDefined();
		expect(findByLabel(root, "Message Cline from Home")).toBeDefined();
	});

	it("opens a history session directly instead of selecting it for a new prompt", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.listRemoteSessions.mockResolvedValue([cloudSession()]);
		const onOpenSession = vi.fn();
		const { root } = await mount({ endpoints: [LAPTOP], onOpenSession });
		act(() => {
			findByLabel(
				root,
				"Open Fix the flaky test on Cloud pod",
			)?.props.onPress();
		});
		expect(onOpenSession).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "cloud",
				remoteSessionId: "sess_1",
			}),
		);
	});

	it("does not reopen dismissed history when a background launch saves its connection", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		const { root, endpointStore } = await mount({
			endpoints: [LAPTOP],
			openSessionsOnMount: true,
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
		const sidebar = () =>
			root.findAll((node) => node.type === SessionSidebar)[0];
		expect(sidebar().props.open).toBe(true);
		act(() => sidebar().props.onClose());
		expect(sidebar().props.open).toBe(false);
		await act(async () => {
			await endpointStore.save({
				mode: "cloud",
				url: "https://background.cline.bot/hub",
				remoteSessionId: "background-launch",
				label: "Background",
			});
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
		expect(sidebar().props.open).toBe(false);
	});

	it("keeps the current Cline welcome hero after sessions arrive", async () => {
		const { root } = await mount({ endpoints: [LAPTOP] });
		expect(
			root.findAll((node) => node.props.testID === "agent-welcome-hero").at(0),
		).toBeDefined();
		expect(
			root
				.findAll((node) => node.props.testID === "agent-welcome-bot-fill")
				.at(0),
		).toBeDefined();
		expect(
			findByLabel(root, "Message Cline from Home")?.props.placeholder,
		).toBe("Ask Cline…");
	});

	it("moves session history out of the centered welcome content", async () => {
		const { root } = await mount({ endpoints: [LAPTOP] });
		expect(findByLabel(root, "All sessions")).toBeDefined();
		expect(containsText(root, "Recent sessions")).toBe(false);
		// Latest Cline deliberately keeps this surface focused on the composer.
		expect(containsText(root, "Review changes")).toBe(false);
		expect(containsText(root, "Check for build errors")).toBe(false);
	});

	it("shows only capability-backed composer controls", async () => {
		const { root } = await mount({ endpoints: [LAPTOP] });
		expect(labels(root)).toContain("Model: Cline · anthropic/claude-sonnet-5");
		expect(
			labels(root).some((label) => label.startsWith("Auto-approve:")),
		).toBe(true);
		expect(findByLabel(root, "Attach files")).toBeUndefined();
	});

	it("sends the Home draft to the selected target without another launcher", async () => {
		const onStartMessage = vi.fn();
		const { root } = await mount({
			endpoints: [LAPTOP, STUDIO],
			onStartMessage,
		});

		act(() => {
			findByLabel(root, "Message Cline from Home")?.props.onChangeText(
				"Fix the failing mobile test",
			);
		});
		// The target sheet is mounted closed; choosing a row updates the single
		// compact target control rather than navigating to a Computers screen.
		act(() => {
			findByLabel(root, "Use Studio on My computer")?.props.onPress();
		});
		expect(
			findByLabel(root, "Message target: Studio, My computer"),
		).toBeDefined();
		act(() => {
			findByLabel(root, "Send to Studio")?.props.onPress();
		});

		expect(onStartMessage).toHaveBeenCalledWith(
			STUDIO,
			"Fix the failing mobile test",
			true,
		);
	});

	it("provisions a configured Cloud target before sending its first message", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.createRemoteSession.mockResolvedValue({
			sessionId: "remote-1",
			sandboxUrl: "https://api.example.com/api/v1/session/remote-1",
		});
		const onStartMessage = vi.fn();
		const onStartSubmission = vi.fn();
		const { root, endpointStore } = await mount({
			cloudTargets: [
				{
					repoUrl: "https://github.com/cline/cline.git",
					label: "cline/cline",
					modelId: "anthropic/claude-sonnet-5",
				},
			],
			onStartMessage,
			onStartSubmission,
		});
		act(() => {
			findByLabel(root, "Message Cline from Home")?.props.onChangeText(
				"Review this repository",
			);
		});
		await act(async () => {
			findByLabel(root, "Send to cline/cline")?.props.onPress();
		});

		expect(hoisted.createRemoteSession).toHaveBeenCalledWith(
			{
				modelId: "anthropic/claude-sonnet-5",
				repoUrl: "https://github.com/cline/cline.git",
				title: "Review this repository",
			},
			expect.objectContaining({ onCreated: expect.any(Function) }),
		);
		// Send in the background, but never navigate over the user's current work.
		expect(onStartMessage).not.toHaveBeenCalled();
		expect(cloudLaunches.start).toHaveBeenCalledWith(
			expect.objectContaining({ message: "Review this repository" }),
		);
		await act(async () => {
			findByLabel(root, "Open cline/cline")?.props.onPress();
		});
		expect(onStartMessage).not.toHaveBeenCalled();
		expect(onStartSubmission).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "cloud",
				remoteSessionId: "remote-1",
				label: "Review this repository",
				modelId: "anthropic/claude-sonnet-5",
			}),
			undefined,
			false,
			undefined,
		);
		expect(endpointStore.list()).toContainEqual(
			expect.objectContaining({
				mode: "cloud",
				remoteSessionId: "remote-1",
				modelId: "anthropic/claude-sonnet-5",
				repoUrl: "https://github.com/cline/cline.git",
			}),
		);
	});

	it("retains a Cloud prompt once Cloud API accepts workspace creation", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		let onCreated:
			| ((session: {
					sessionId: string;
					sandboxUrl: string;
					initialStatus?: string;
			  }) => void | Promise<void>)
			| undefined;
		hoisted.createRemoteSession.mockImplementation((_input, options) => {
			onCreated = options?.onCreated;
			return new Promise(() => {});
		});
		const { root, endpointStore } = await mount({
			cloudTargets: [
				{
					repoUrl: "https://github.com/cline/cline.git",
					label: "cline/cline",
					modelId: "cline/model",
				},
			],
		});
		act(() => {
			findByLabel(root, "Message Cline from Home")?.props.onChangeText(
				"Fix this after the app restarts",
			);
		});
		act(() => {
			findByLabel(root, "Send to cline/cline")?.props.onPress();
		});
		await act(async () => {});
		await act(async () => {
			await onCreated?.({
				sessionId: "remote-persisted",
				sandboxUrl: "https://api.example.com/api/v1/session/remote-persisted",
				initialStatus: "provisioning",
			});
		});

		expect(endpointStore.list()).toContainEqual(
			expect.objectContaining({
				remoteSessionId: "remote-persisted",
				pendingInitialMessage: "Fix this after the app restarts",
				label: "Fix this after the app restarts",
			}),
		);
	});

	it("enters a provisional Cloud conversation as soon as creation starts", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.createRemoteSession.mockReturnValue(new Promise(() => {}));
		const onOpenCloudStart = vi.fn();
		const { root } = await mount({
			cloudTargets: [
				{
					repoUrl: "https://github.com/cline/cline.git",
					label: "cline/cline",
					modelId: "cline/model",
				},
			],
			onOpenCloudStart,
		});
		act(() => {
			findByLabel(root, "Message Cline from Home")?.props.onChangeText(
				"Start immediately",
			);
		});
		act(() => {
			findByLabel(root, "Send to cline/cline")?.props.onPress();
		});
		expect(onOpenCloudStart).toHaveBeenCalledWith(
			expect.stringMatching(/^cloud-start-/),
		);
	});

	it("keeps a failed Cloud prompt in its retryable background job", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.createRemoteSession.mockRejectedValue(
			new Error("provision failed"),
		);
		const { root } = await mount({
			cloudTargets: [
				{
					repoUrl: "https://github.com/cline/cline.git",
					label: "cline/cline",
					modelId: "anthropic/claude-sonnet-5",
				},
			],
		});
		act(() => {
			findByLabel(root, "Message Cline from Home")?.props.onChangeText(
				"Keep this draft",
			);
		});
		await act(async () => {
			findByLabel(root, "Send to cline/cline")?.props.onPress();
		});

		expect(findByLabel(root, "Message Cline from Home")?.props.value).toBe("");
		expect(containsText(root, "Keep this draft")).toBe(true);
		expect(containsText(root, "provision failed")).toBe(true);
		expect(findByLabel(root, "Retry cline/cline")).toBeDefined();
	});

	it("can start a Mac session while a Cloud workspace is still provisioning", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.createRemoteSession.mockReturnValue(new Promise(() => {}));
		const onStartMessage = vi.fn();
		const { root } = await mount({
			endpoints: [LAPTOP],
			cloudTargets: [
				{
					repoUrl: "https://github.com/cline/cline.git",
					label: "cline/cline",
					modelId: "anthropic/claude-sonnet-5",
				},
			],
			onStartMessage,
		});
		act(() => {
			findByLabel(root, "Message Cline from Home")?.props.onChangeText(
				"Start this in Cloud",
			);
		});
		act(() => {
			findByLabel(root, "Send to cline/cline")?.props.onPress();
		});
		expect(
			containsText(root, "You can use other sessions while this starts."),
		).toBe(true);

		act(() => {
			findByLabel(root, "Use MacBook Pro on My computer")?.props.onPress();
		});
		act(() => {
			findByLabel(root, "Message Cline from Home")?.props.onChangeText(
				"Start this on my Mac",
			);
		});
		act(() => {
			findByLabel(root, "Send to MacBook Pro")?.props.onPress();
		});
		expect(onStartMessage).toHaveBeenCalledWith(
			LAPTOP,
			"Start this on my Mac",
			true,
		);
	});

	it("lists Cloud and paired-computer sessions together, newest first", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.listRemoteSessions.mockResolvedValue([cloudSession()]);
		const { root } = await mount({
			endpoints: [LAPTOP_SESSION],
			lastOpened: {
				'["local","ws://192.168.1.20:4599/hub","local-laptop-session"]':
					NOW - 10 * MINUTE,
			},
		});

		const openLabels = labels(root).filter((label) =>
			label.startsWith("Open "),
		);
		expect(openLabels).toEqual([
			"Open Fix the flaky test on Cloud pod",
			"Open Review mobile on MacBook Pro",
		]);
		expect(containsText(root, "1m ago")).toBe(true);
		expect(containsText(root, "10m ago")).toBe(true);
	});

	it("explicitly resumes an unknown create with its retained submission", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.listAccounts.mockResolvedValue([
			{ name: "Team", active: true, organizationId: "org-1" },
		]);
		hoisted.listRemoteSessions.mockResolvedValue([
			cloudSession({
				id: asRemoteSessionId("remote-unknown"),
				sandboxUrl: "https://core-api.cline.bot/api/v1/session/remote-unknown",
				taskId: "task-canonical",
				title: "Recover mobile request",
				repoUrl: "https://github.com/cline/cline",
				organizationId: "org-1",
			}),
		]);
		const attachments = { userImages: ["data:image/png;base64,aW1hZ2U="] };
		const jobId = cloudStartStore.start({
			target: {
				id: "cloud-target",
				mode: "cloud",
				repoUrl: "https://github.com/cline/cline.git",
				label: "cline/cline",
				modelId: "cline/model",
				organizationId: "org-1",
			},
			message: "Recover mobile request",
			attachments,
			provision: async () => {
				throw new AmbiguousCloudSessionCreateError();
			},
		});
		await vi.waitFor(() =>
			expect(cloudStartStore.getSnapshot()[0]).toEqual(
				expect.objectContaining({
					id: jobId,
					phase: "error",
					recovery: "check-sessions",
				}),
			),
		);
		const onStartSubmission = vi.fn();
		const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
		const { root, endpointStore } = await mount({
			onStartSubmission,
		});

		act(() => findByLabel(root, "Check sessions")?.props.onPress());
		act(() =>
			findByLabel(
				root,
				"Open Recover mobile request on cline/cline",
			)?.props.onPress(),
		);
		expect(alert).toHaveBeenCalledWith(
			"Resume this request here?",
			expect.stringContaining("Recover mobile request"),
			expect.any(Array),
		);
		const buttons = alert.mock.calls[0]?.[2] as
			| Array<{ text?: string; onPress?: () => void }>
			| undefined;
		await act(async () => {
			buttons?.find((button) => button.text === "Cancel recovery")?.onPress?.();
		});
		// The retained card can select the same failed job again after cancellation.
		act(() => findByLabel(root, "Check sessions")?.props.onPress());
		act(() =>
			findByLabel(
				root,
				"Open Recover mobile request on cline/cline",
			)?.props.onPress(),
		);
		const retryButtons = alert.mock.calls[1]?.[2] as
			| Array<{ text?: string; onPress?: () => void }>
			| undefined;
		await act(async () => {
			retryButtons
				?.find((button) => button.text === "Resume request")
				?.onPress?.();
		});

		expect(onStartSubmission).toHaveBeenCalledWith(
			expect.objectContaining({
				remoteSessionId: "remote-unknown",
				allowInitialCreate: true,
			}),
			"Recover mobile request",
			true,
			attachments,
		);
		expect(onStartSubmission.mock.calls[0]?.[0]).not.toHaveProperty(
			"hubSessionId",
		);
		expect(cloudStartStore.getSnapshot()).toHaveLength(0);
		// A stale native confirmation callback must not hand the same retained
		// text/image request to a second chat after its job authority is retired.
		await act(async () => {
			retryButtons
				?.find((button) => button.text === "Resume request")
				?.onPress?.();
		});
		expect(onStartSubmission).toHaveBeenCalledOnce();
		// Images remain process-local in the launch submission, never SecureStore.
		expect(endpointStore.list()[0]).not.toHaveProperty("attachments");
		alert.mockRestore();
	});

	it("distinguishes workspace readiness from stopped sessions", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.listRemoteSessions.mockResolvedValue([
			cloudSession(),
			cloudSession({
				id: asRemoteSessionId("sess_2"),
				sandboxUrl: "https://pod-2.cline.bot/hub",
				title: "Stopped work",
				status: "stopped",
				updatedAt: NOW - 2 * MINUTE,
			}),
		]);
		const { root } = await mount({ endpoints: [LAPTOP] });
		expect(findByLabel(root, "Workspace ready")).toBeUndefined();
		expect(containsText(root, "Running")).toBe(false);
		// A known-stopped pod still says so through its chip.
		expect(containsText(root, "Stopped")).toBe(true);
	});

	it("shows no status chip for a machine it is not connected to", async () => {
		const { root } = await mount({ endpoints: [LAPTOP] });
		expect(containsText(root, "Idle")).toBe(false);
		expect(containsText(root, "Running")).toBe(false);
	});

	it("shows the live status of the exact session it is connected to", async () => {
		const { root } = await mount({
			endpoints: [LAPTOP_SESSION],
			activeKey:
				'["local","ws://192.168.1.20:4599/hub","local-laptop-session"]',
			activeStatus: "running",
		});
		expect(findByLabel(root, "Running")).toBeDefined();
	});

	it("opens the row that was tapped and remembers when", async () => {
		const opened: ConnectionDescriptor[] = [];
		const { root, lastOpenedStore } = await mount({
			endpoints: [LAPTOP_SESSION, STUDIO_SESSION],
			onOpenSession: (descriptor) => opened.push(descriptor),
		});
		await act(async () => {
			findByLabel(root, "Open Studio migration on Studio")?.props.onPress();
		});
		expect(opened).toEqual([STUDIO_SESSION]);
		expect(
			lastOpenedStore.get(
				'["local","ws://192.168.1.31:4599/hub","local-studio-session"]',
			),
		).toBeGreaterThan(0);
	});

	it("filters the unified list without changing what a row is called", async () => {
		const { root } = await mount({
			endpoints: [LAPTOP_SESSION, STUDIO_SESSION, ...EXTRA_SESSIONS],
		});
		await act(async () => {
			findByLabel(root, "Search sessions")?.props.onChangeText("studio");
		});
		expect(findByLabel(root, "Open Studio migration on Studio")).toBeDefined();
		expect(
			findByLabel(root, "Open Review mobile on MacBook Pro"),
		).toBeUndefined();
	});

	it("says so honestly when a search matches nothing", async () => {
		const { root } = await mount({
			endpoints: [LAPTOP_SESSION, STUDIO_SESSION, ...EXTRA_SESSIONS],
		});
		await act(async () => {
			findByLabel(root, "Search sessions")?.props.onChangeText("zzz");
		});
		expect(containsText(root, "No sessions match")).toBe(true);
	});

	it("keeps session search available in the navigation sidebar", async () => {
		const { root } = await mount({ endpoints: [LAPTOP, STUDIO] });
		expect(findByLabel(root, "Search sessions")).toBeDefined();
	});
});

describe("HomeScreen degradation", () => {
	it("keeps personal sessions when a saved organization scope is no longer accessible", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.listRemoteSessions.mockImplementation(async (organizationId) => {
			if (organizationId === "org-revoked") {
				throw new Error("organization access revoked");
			}
			return [cloudSession({ title: "Personal work remains visible" })];
		});
		const { root } = await mount({
			cloudTargets: [
				{
					repoUrl: "https://github.com/cline/old-org-repo",
					label: "cline/old-org-repo",
					modelId: "cline/default",
					organizationId: "org-revoked",
				},
			],
		});

		expect(containsText(root, "Personal work remains visible")).toBe(true);
		expect(containsText(root, "Something went wrong with Cline Cloud.")).toBe(
			false,
		);
	});

	it("keeps saved organization sessions out of Personal Recents without querying their scope", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.listRemoteSessions.mockResolvedValue([
			cloudSession({ title: "Personal recent work" }),
		]);
		const { root } = await mount({
			endpoints: [
				{
					mode: "cloud",
					url: "https://pod-organization.cline.bot/hub",
					remoteSessionId: "organization-session",
					organizationId: "org-session-only",
					sessionTitle: "Saved organization work",
				},
			],
		});

		expect(containsText(root, "Personal recent work")).toBe(true);
		expect(containsText(root, "Saved organization work")).toBe(false);
		expect(hoisted.gatewayScopes).toEqual([undefined]);
		expect(hoisted.listRemoteSessions).toHaveBeenCalledWith(undefined);
		expect(hoisted.listRemoteSessions).not.toHaveBeenCalledWith(
			"org-session-only",
		);
	});

	it("keeps a configured Cloud composer usable when only history refresh fails", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.listRemoteSessions.mockRejectedValue(new Error("network down"));
		const { root } = await mount({
			cloudTargets: [
				{
					repoUrl: "https://github.com/cline/cline.git",
					label: "cline/cline",
					modelId: "cline/default",
				},
			],
		});
		act(() => {
			findByLabel(root, "Message Cline from Home")?.props.onChangeText(
				"Start despite history being unavailable",
			);
		});
		const send = findByLabel(root, "Send to cline/cline");
		expect(
			send?.props.accessibilityState?.disabled ?? send?.props.disabled,
		).toBe(false);
	});

	it("keeps local sessions available when Cline Cloud cannot be reached", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.listRemoteSessions.mockRejectedValue(new Error("network down"));
		const { root } = await mount({ endpoints: [LAPTOP_SESSION] });
		expect(
			findByLabel(root, "Open Review mobile on MacBook Pro"),
		).toBeDefined();
		expect(containsText(root, "Something went wrong with Cline Cloud.")).toBe(
			true,
		);
		expect(containsText(root, "Showing the last sessions")).toBe(true);
	});

	it("says nothing about the cloud when simply signed out", async () => {
		const { root } = await mount({ endpoints: [LAPTOP] });
		expect(containsText(root, "could not be reached")).toBe(false);
		expect(containsText(root, "went wrong")).toBe(false);
		expect(findByLabel(root, "Sign in to Cline")).toBeUndefined();
		expect(findByLabel(root, "All sessions")).toBeDefined();
	});

	it("keeps signed-in new Cloud work on Home with repository and branch controls", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.listRepositories.mockResolvedValue([
			{
				id: 1,
				name: "cline",
				fullName: "cline/cline",
				repoUrl: "https://github.com/cline/cline",
				private: false,
				defaultBranch: "main",
			},
		]);
		const { root, executionTargetStore } = await mount();
		expect(findByLabel(root, "Sign in to Cline")).toBeUndefined();
		expect(findByLabel(root, "Get started")).toBeUndefined();
		expect(findByLabel(root, "Message Cline from Home")).toBeDefined();
		expect(findByLabel(root, "Select Cloud repository")).toBeDefined();
		expect(
			findByLabel(root, "Select a repository before choosing a branch"),
		).toBeUndefined();

		await act(async () => {
			findByLabel(root, "Select Cloud repository")?.props.onPress();
		});
		expect(findByLabel(root, "cline/cline")).toBeDefined();
		await act(async () => {
			findByLabel(root, "cline/cline")?.props.onPress();
		});

		expect(findByLabel(root, "Cloud repository: cline/cline")).toBeDefined();
		expect(findByLabel(root, "Cloud branch: default")).toBeDefined();
		expect(executionTargetStore.get().cloudTargets).toEqual([
			expect.objectContaining({
				label: "cline/cline",
				repoUrl: "https://github.com/cline/cline",
			}),
		]);
	});

	it("offers GitHub setup when repository discovery reports no integration", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.listRepositories.mockRejectedValue(
			new CloudSetupApiError(
				"Connect GitHub to your Cline account, then try again.",
				404,
			),
		);
		const { root } = await mount();

		const setup = root.find(
			(node) => node.props.testID === "cloud-workspace-setup",
		);
		expect(findByLabel(setup, "Connect GitHub")).toBeDefined();
		expect(findByLabel(setup, "I've connected GitHub")).toBeDefined();
		expect(containsText(setup, "Connect GitHub to get started")).toBe(true);
		expect(
			root.find((node) => node.type === IntroScreen).props.setup,
		).toBeDefined();
	});

	it("switches Home to a newly selected Cloud repository", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.listRepositories.mockResolvedValue([
			{
				id: 1,
				name: "old",
				fullName: "cline/old",
				repoUrl: "https://github.com/cline/old",
				private: false,
				defaultBranch: "main",
			},
			{
				id: 2,
				name: "new",
				fullName: "cline/new",
				repoUrl: "https://github.com/cline/new",
				private: false,
				defaultBranch: "main",
			},
		]);
		const { root } = await mount({
			cloudTargets: [
				{
					repoUrl: "https://github.com/cline/old",
					label: "cline/old",
					modelId: "cline/model",
				},
			],
		});

		await act(async () => {
			findByLabel(root, "Cloud repository: cline/old")?.props.onPress();
		});
		await act(async () => {
			findByLabel(root, "cline/new")?.props.onPress();
		});

		expect(findByLabel(root, "Cloud repository: cline/new")).toBeDefined();
		expect(findByLabel(root, "Cloud repository: cline/old")).toBeUndefined();
	});

	it("queries repositories and Recents only for the active organization", async () => {
		hoisted.listAccounts.mockResolvedValue([
			{ name: "Team", active: true, organizationId: "org-7" },
		]);
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.listRepositories.mockResolvedValue([]);
		const { root } = await mount({
			cloudTargets: [
				{
					repoUrl: "https://github.com/cline/org-repo",
					label: "cline/org-repo",
					modelId: "cline/model",
					organizationId: "org-7",
				},
			],
		});
		await act(async () => {
			findByLabel(root, "Cloud repository: cline/org-repo")?.props.onPress();
		});
		expect(hoisted.listRepositories).toHaveBeenCalledWith("org-7");
		expect(hoisted.gatewayScopes).toEqual(["org-7"]);
		expect(hoisted.listRemoteSessions).toHaveBeenCalledWith("org-7");
		expect(hoisted.listRemoteSessions).not.toHaveBeenCalledWith(undefined);
	});
});

it.each([
	undefined,
	"org-selected",
])("keeps repository selection in Home's known account despite a conflicting remote preference (%s)", async (organizationId) => {
	hoisted.getValidAccessToken.mockResolvedValue("jwt");
	hoisted.listAccounts.mockResolvedValue([
		{ name: "Selected", active: true, organizationId },
	]);
	const { root, executionTargetStore } = await mount({
		cloudTargets: [
			{
				repoUrl: "https://github.com/cline/old",
				label: "cline/old",
				modelId: "cline/model",
				...(organizationId ? { organizationId } : {}),
			},
		],
	});
	hoisted.listAccounts.mockResolvedValue([
		{
			name: "Other device preference",
			active: true,
			organizationId: "org-foreign",
		},
	]);
	hoisted.listRepositories.mockResolvedValue([
		{
			id: 17,
			name: "new",
			fullName: "cline/new",
			repoUrl: "https://github.com/cline/new",
			private: true,
			defaultBranch: "main",
		},
	]);
	hoisted.listRepositories.mockClear();
	await act(async () =>
		findByLabel(root, "Cloud repository: cline/old")?.props.onPress(),
	);
	expect(hoisted.listRepositories).toHaveBeenLastCalledWith(organizationId);
	await act(async () => findByLabel(root, "cline/new")?.props.onPress());
	expect(findByLabel(root, "Cloud repository: cline/new")).toBeDefined();
	expect(
		executionTargetStore
			.get()
			.cloudTargets.find(
				(target) => target.repoUrl === "https://github.com/cline/new",
			)?.organizationId,
	).toBe(organizationId);
});

it("restores the repository and model on a fresh Home opened through the Cloud shortcut", async () => {
	hoisted.getValidAccessToken.mockResolvedValue("jwt");
	let saved: string | null = null;
	const persistence = {
		getItem: async () => saved,
		setItem: async (_key: string, value: string) => {
			saved = value;
		},
		deleteItem: async () => {
			saved = null;
		},
	};
	const previous = new ExecutionTargetStore(persistence);
	await previous.saveCloudTarget({
		repoUrl: "https://github.com/team/repo",
		label: "team/repo",
		modelId: "remembered/model",
		branch: "feature",
	});
	const { root } = await mount({
		preferCloudOnMount: true,
		executionTargetStore: new ExecutionTargetStore(persistence),
	});
	expect(findByLabel(root, "Cloud repository: team/repo")).toBeDefined();
	expect(findByLabel(root, "Cloud branch: feature")).toBeDefined();
	expect(root.find((node) => node.type === HomeComposer).props.modelId).toBe(
		"remembered/model",
	);
	expect(hoisted.createRemoteSession).not.toHaveBeenCalled();
});

it("keeps saved targets and new-task submission unavailable when the active account cannot be discovered", async () => {
	hoisted.getValidAccessToken.mockResolvedValue("jwt");
	hoisted.listAccounts.mockRejectedValue(
		new Error("Account discovery offline"),
	);
	const { root } = await mount({
		cloudTargets: [
			{
				repoUrl: "https://github.com/team/repo",
				label: "team/repo",
				modelId: "remembered/model",
			},
		],
	});
	const composer = root.find((node) => node.type === HomeComposer);
	expect(composer.props.busy).toBe(true);
	expect(composer.props.target).toBeUndefined();
	expect(composer.props.onChooseTarget).toBeUndefined();
	expect(hoisted.listRepositories).not.toHaveBeenCalled();
	expect(hoisted.createRemoteSession).not.toHaveBeenCalled();
	act(() => composer.props.onDraftChange("Keep my private draft"));
	expect(findByLabel(root, "Retry")).toBeDefined();
	hoisted.listAccounts.mockResolvedValue([{ name: "Personal", active: true }]);
	await act(async () => findByLabel(root, "Retry")?.props.onPress());
	const recovered = root.find((node) => node.type === HomeComposer);
	expect(recovered.props.busy).toBe(false);
	expect(recovered.props.target.cloud.repoUrl).toBe(
		"https://github.com/team/repo",
	);
	expect(recovered.props.draft).toBe("Keep my private draft");
	expect(hoisted.createRemoteSession).not.toHaveBeenCalled();
});

it("settles missing-default thinking capability after the actual gateway catalog loads, without guessing support", async () => {
	hoisted.getValidAccessToken.mockResolvedValue("jwt");
	let releaseCatalog!: (response: Response) => void;
	const catalog = new Promise<Response>((resolve) => {
		releaseCatalog = resolve;
	});
	const gateway = new ActualCloudSetupGateway({
		apiBaseUrl: "https://catalog.invalid",
		getAccessToken: async () => null,
		fetchImpl: (async (url) =>
			String(url).endsWith("/recommended-models")
				? new Response(
						JSON.stringify({
							recommended: [
								{ id: "anthropic/claude-sonnet-4-6", name: "Fixture Sonnet" },
							],
						}),
					)
				: catalog) as typeof fetch,
	});
	hoisted.listRecommendedModels.mockImplementation(() =>
		gateway.listRecommendedModels(),
	);
	const { root } = await mount({
		cloudTargets: [
			{
				repoUrl: "https://github.com/cline/cline",
				label: "cline/cline",
				modelId: CLINE_DEFAULT_MODEL_ID,
			},
		],
	});
	expect(containsText(root, "Checking thinking…")).toBe(true);
	await act(async () =>
		releaseCatalog(
			new Response(
				JSON.stringify({
					data: [
						{
							id: "anthropic/claude-sonnet-4-6",
							name: "Fixture Sonnet",
							supported_parameters: ["reasoning"],
							architecture: { input_modalities: ["text", "image"] },
						},
						{
							id: "anthropic/claude-sonnet-4-6-mini",
							name: "Fixture Fast (no thinking)",
							supported_parameters: [],
							architecture: { input_modalities: ["text"] },
						},
					],
				}),
			),
		),
	);
	const picker = root.find((node) => node.type === ModelSheet);
	expect(
		picker.props.cachedModels.find(
			(model: CloudModelOption) => model.id === CLINE_DEFAULT_MODEL_ID,
		)?.supportsReasoning,
	).toBeUndefined();
	expect(containsText(root, "Checking thinking…")).toBe(false);
	expect(containsText(root, "Thinking options unavailable")).toBe(true);
	expect(
		containsText(root, "Choose another model to configure thinking."),
	).toBe(true);
	expect(findByLabel(root, "Thinking level: Model setting")).toBeUndefined();
	await act(async () => picker.props.onChange("anthropic/claude-sonnet-4-6"));
	expect(findByLabel(root, "Thinking level: Model setting")).toBeDefined();
	await act(async () =>
		picker.props.onChange("anthropic/claude-sonnet-4-6-mini"),
	);
	expect(containsText(root, "Thinking unavailable")).toBe(true);
	expect(hoisted.createRemoteSession).not.toHaveBeenCalled();
});
