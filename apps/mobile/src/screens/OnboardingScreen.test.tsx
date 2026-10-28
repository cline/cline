import * as ReactNative from "react-native";
import { AccessibilityInfo, AppState, Linking, StyleSheet } from "react-native";
import { act, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/features", () => ({ COMPUTER_CONNECTIONS_ENABLED: true }));

import { render } from "../ui/__testing__/render";
import { containsText } from "./__testing__/harness";
import {
	isCompactOnboardingLayout,
	OnboardingScreen,
} from "./OnboardingScreen";

const hoisted = vi.hoisted(() => ({
	listAccounts: vi.fn(),
	resolveInstallUrl: vi.fn(),
	listRepositories: vi.fn(),
	listRecommendedModels: vi.fn(),
	listBranches: vi.fn(),
}));

vi.mock("@/cloud/rest/CloudAccountGateway", () => ({
	CloudAccountGateway: class {
		listAccounts = hoisted.listAccounts;
	},
}));
vi.mock("@/cloud/rest/CloudGitHubGateway", () => ({
	CloudGitHubGateway: class {
		resolveInstallUrl = hoisted.resolveInstallUrl;
	},
}));

vi.mock("@/cloud", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/cloud")>();
	class FakeSetupGateway {
		listRepositories = hoisted.listRepositories;
		listRecommendedModels = hoisted.listRecommendedModels;
		listBranches = hoisted.listBranches;
	}
	return {
		...actual,
		CloudSetupGateway: FakeSetupGateway,
		cloudAuthStore: {
			identityVersion: 0,
			subscribeIdentity: () => () => {},
			getValidAccessToken: vi.fn(async () => "jwt"),
		},
	};
});

function press(root: ReactTestInstance, label: string): void {
	const node = root.findAll(
		(candidate) =>
			typeof candidate.type === "string" &&
			candidate.props.accessibilityLabel === label,
	)[0];
	if (!node) throw new Error(`No pressable labelled "${label}"`);
	node.props.onPress();
}

function advanceToConnect(root: ReactTestInstance): void {
	act(() => press(root, "Get started"));
}

beforeEach(() => {
	vi.clearAllMocks();
	hoisted.listAccounts.mockResolvedValue([{ name: "Personal", active: true }]);
	hoisted.resolveInstallUrl.mockResolvedValue(
		"https://github.com/apps/example/installations/new?state=example",
	);
	hoisted.listRepositories.mockResolvedValue([
		{
			id: 1,
			name: "cline",
			fullName: "cline/cline",
			repoUrl: "https://github.com/cline/cline.git",
			private: false,
		},
		{
			id: 2,
			name: "docs",
			fullName: "cline/docs",
			repoUrl: "https://github.com/cline/docs.git",
			private: false,
		},
	]);
	hoisted.listBranches.mockResolvedValue({
		branches: ["main", "develop", "feature/x"],
	});
	hoisted.listRecommendedModels.mockResolvedValue([
		{ id: "model-a", name: "Model A", tags: ["Default"] },
		{ id: "model-b", name: "Model B", tags: ["Fast"] },
	]);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("OnboardingScreen", () => {
	it("uses Desktop's 720px option-header breakpoint", () => {
		expect(isCompactOnboardingLayout(390)).toBe(true);
		expect(isCompactOnboardingLayout(720)).toBe(true);
		expect(isCompactOnboardingLayout(768)).toBe(false);
	});

	it("matches Desktop's centered welcome before showing setup choices", () => {
		const onSignIn = vi.fn();
		const { root } = render(
			<OnboardingScreen
				cloudState={{ phase: "signed-out" }}
				onSignIn={onSignIn}
				onRetryCloud={() => {}}
				onSaveCloudTarget={async () => {}}
			/>,
		);

		expect(containsText(root, "Cline")).toBe(true);
		expect(containsText(root, "Build software your way")).toBe(true);
		expect(containsText(root, "Set up Cline")).toBe(false);

		const action = root.findAll(
			(node) => node.props.testID === "onboarding-primary-action",
		)[0];
		expect(action).toBeDefined();
		if (!action) throw new Error("Missing centered onboarding action");
		expect(StyleSheet.flatten(action.props.style)).toMatchObject({
			width: "100%",
			maxWidth: 256,
			alignSelf: "center",
		});
		const grid = root.findAll(
			(node) =>
				node.props.testID === "agent-welcome-hero" &&
				StyleSheet.flatten(node.props.style)?.height === "100%",
		)[0];
		expect(grid).toBeDefined();

		advanceToConnect(root);
		expect(containsText(root, "Set up Cline")).toBe(true);
		const setupHeader = root.findAll(
			(node) => node.props.testID === "onboarding-setup-header",
		)[0];
		expect(setupHeader).toBeDefined();
		if (!setupHeader) throw new Error("Missing onboarding setup header");
		expect(StyleSheet.flatten(setupHeader.props.style)).toMatchObject({
			flexDirection: "row",
			alignItems: "center",
		});
		expect(containsText(root, "Cline Cloud")).toBe(true);
		expect(containsText(root, "My computer")).toBe(false);
		// Desktop stacks each option's title/description below its icon row at
		// phone widths, leaving room for the Recommended badge and dynamic type.
		expect(
			root.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.props.testID === "setup-option-heading-row",
			),
		).toHaveLength(1);
		press(root, "Sign in to Cline");
		expect(containsText(root, "Scan handoff QR")).toBe(false);
		expect(onSignIn).toHaveBeenCalledOnce();
	});

	it("keeps first-run navigation available after rotating to a short window", () => {
		const dimensions = vi.spyOn(ReactNative, "useWindowDimensions");
		const props = {
			cloudState: { phase: "signed-out" as const },
			onSignIn: vi.fn(),
			onRetryCloud: vi.fn(),
			onSaveCloudTarget: async () => {},
		};
		const mounted = render(<OnboardingScreen {...props} />);
		dimensions.mockReturnValue({
			width: 844,
			height: 390,
			scale: 2,
			fontScale: 1,
		});
		act(() => mounted.renderer.update(<OnboardingScreen {...props} />));
		const hero = mounted.root.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.props.testID === "agent-welcome-hero" &&
				StyleSheet.flatten(node.props.style)?.height === 96,
		);
		expect(hero).toHaveLength(1);
		advanceToConnect(mounted.root);
		expect(containsText(mounted.root, "Set up Cline")).toBe(true);
		act(() => press(mounted.root, "Back"));
		expect(containsText(mounted.root, "Get started")).toBe(true);
	});

	it("uses keyboard-safe scrolling on the setup step", () => {
		const { root } = render(
			<OnboardingScreen
				cloudState={{ phase: "signed-out" }}
				onSignIn={() => {}}
				onRetryCloud={() => {}}
				onSaveCloudTarget={async () => {}}
			/>,
		);
		advanceToConnect(root);

		const scroll = root.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.type === "ScrollView" &&
				node.props.automaticallyAdjustKeyboardInsets === true &&
				node.props.keyboardDismissMode === "interactive",
		)[0];
		expect(scroll).toBeDefined();
	});

	it("saves the selected existing Cloud API repository and model", async () => {
		const onSaveCloudTarget = vi.fn(async () => {});
		const onFinish = vi.fn();
		const { root } = render(
			<OnboardingScreen
				cloudState={{ phase: "ready", sessions: [] }}
				onSignIn={() => {}}
				onRetryCloud={() => {}}
				onSaveCloudTarget={onSaveCloudTarget}
				onFinish={onFinish}
			/>,
		);
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		act(() => {
			press(root, "cline/docs");
			press(root, "Model B");
		});
		await act(async () => {
			press(root, "Use Cline Cloud");
		});

		expect(onSaveCloudTarget).toHaveBeenCalledWith({
			repoUrl: "https://github.com/cline/docs.git",
			label: "cline/docs",
			modelId: "model-b",
		});
		expect(onFinish).toHaveBeenCalledOnce();
	});

	it("keeps setup open and explains a save failure", async () => {
		const onFinish = vi.fn();
		const { root } = render(
			<OnboardingScreen
				cloudState={{ phase: "ready", sessions: [] }}
				onSignIn={() => {}}
				onRetryCloud={() => {}}
				onSaveCloudTarget={async () => {
					throw new Error("Could not save this Cloud setup");
				}}
				onFinish={onFinish}
			/>,
		);
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		await act(async () => {
			press(root, "Use Cline Cloud");
		});
		expect(containsText(root, "Could not save this Cloud setup")).toBe(true);
		expect(onFinish).not.toHaveBeenCalled();
	});
});

/**
 * Branch choice: `main` (the default) needs no touch and is NOT persisted —
 * absent means "the repository's default", resolved at session start — while an
 * explicit pick rides the saved target. The list is search-first because a
 * repository can carry tens of thousands of branches.
 */
describe("cloud branch selection", () => {
	async function renderReady(
		onSaveCloudTarget: (input: Record<string, unknown>) => Promise<void>,
	) {
		const rendered = render(
			<OnboardingScreen
				cloudState={{ phase: "ready", sessions: [] }}
				onSignIn={() => {}}
				onRetryCloud={() => {}}
				onSaveCloudTarget={onSaveCloudTarget as never}
			/>,
		);
		advanceToConnect(rendered.root);
		// options load, then the branch fetch behind its zero-delay debounce.
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
		return rendered;
	}

	it("defaults to main without persisting a branch", async () => {
		const onSaveCloudTarget = vi.fn(
			async (_input: Record<string, unknown>) => {},
		);
		const { root } = await renderReady(onSaveCloudTarget);
		expect(containsText(root, "main")).toBe(true);
		await act(async () => {
			press(root, "Use Cline Cloud");
		});
		const saved = onSaveCloudTarget.mock.calls[0]?.[0];
		expect(saved).toBeDefined();
		expect(saved !== undefined && "branch" in saved).toBe(false);
	});

	it("keeps the organization for repository lookup, branch lookup, and the saved workspace", async () => {
		hoisted.listAccounts.mockResolvedValue([
			{ name: "Example", active: true, organizationId: "org-example" },
		]);
		const onSaveCloudTarget = vi.fn(async () => {});
		const { root } = await renderReady(onSaveCloudTarget);
		expect(hoisted.listRepositories).toHaveBeenCalledWith("org-example");
		expect(hoisted.listBranches).toHaveBeenCalledWith(1, {
			organizationId: "org-example",
		});
		act(() => {
			press(root, "develop");
		});
		await act(async () => {
			press(root, "Use Cline Cloud");
		});
		expect(onSaveCloudTarget).toHaveBeenCalledWith(
			expect.objectContaining({
				branch: "develop",
				organizationId: "org-example",
			}),
		);
	});

	it("searches server-side instead of filtering the loaded page", async () => {
		const { root } = await renderReady(async () => {});
		const field = root.findAll(
			(node) => node.props.accessibilityLabel === "Search branches",
		)[0];
		expect(field).toBeDefined();
		act(() => {
			(field?.props.onChangeText as (t: string) => void)("release/");
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 350));
		});
		expect(hoisted.listBranches).toHaveBeenLastCalledWith(1, {
			query: "release/",
		});
	});
});

/**
 * Delta found against the dashboard's AgentStartView: a branch chosen through
 * search must stay VISIBLE after the query is cleared and the page no longer
 * contains it — selected-but-invisible reads as "my choice was lost".
 */
it("keeps a searched selection visible after the query changes", async () => {
	const onSaveCloudTarget = vi.fn(
		async (_input: Record<string, unknown>) => {},
	);
	const { root } = render(
		<OnboardingScreen
			cloudState={{ phase: "ready", sessions: [] }}
			onSignIn={() => {}}
			onRetryCloud={() => {}}
			onSaveCloudTarget={onSaveCloudTarget as never}
		/>,
	);
	advanceToConnect(root);
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 5));
	});

	// Search for a branch outside the browse page and pick it.
	hoisted.listBranches.mockResolvedValue({ branches: ["release/9.9"] });
	const field = root.findAll(
		(node) => node.props.accessibilityLabel === "Search branches",
	)[0];
	act(() => {
		(field?.props.onChangeText as (t: string) => void)("release");
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 350));
	});
	act(() => {
		press(root, "release/9.9");
	});

	// Clear the query; the browse page does not contain the selection.
	hoisted.listBranches.mockResolvedValue({
		branches: ["main", "develop", "feature/x"],
	});
	act(() => {
		(field?.props.onChangeText as (t: string) => void)("");
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 50));
	});

	expect(containsText(root, "release/9.9")).toBe(true);
	await act(async () => {
		press(root, "Use Cline Cloud");
	});
	expect(onSaveCloudTarget).toHaveBeenCalledWith(
		expect.objectContaining({ branch: "release/9.9" }),
	);
});

describe("GitHub setup recovery", () => {
	it("shows a truthful actionable state for an empty repository list", async () => {
		hoisted.listRepositories.mockResolvedValue([]);
		const { root } = render(
			<OnboardingScreen
				cloudState={{ phase: "ready", sessions: [] }}
				onSignIn={() => {}}
				onRetryCloud={() => {}}
				onSaveCloudTarget={async () => {}}
			/>,
		);
		advanceToConnect(root);
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(containsText(root, "No repositories are available")).toBe(true);
		expect(
			root.findAll(
				(node) => node.props.accessibilityLabel === "Connect GitHub",
			),
		).not.toHaveLength(0);
		expect(containsText(root, "No repositories match your search")).toBe(false);
		expect(
			vi.mocked(AccessibilityInfo.announceForAccessibility),
		).toHaveBeenCalledWith(
			expect.stringContaining("No repositories are available"),
		);
	});

	it("reports a GitHub browser-open failure without falling back to another account", async () => {
		hoisted.listRepositories.mockResolvedValue([]);
		vi.mocked(Linking.openURL).mockRejectedValueOnce(new Error("cannot open"));
		const { root } = render(
			<OnboardingScreen
				cloudState={{ phase: "ready", sessions: [] }}
				onSignIn={() => {}}
				onRetryCloud={() => {}}
				onSaveCloudTarget={async () => {}}
			/>,
		);
		advanceToConnect(root);
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		await act(async () => press(root, "Connect GitHub"));

		expect(containsText(root, "cannot open")).toBe(true);
		expect(Linking.openURL).toHaveBeenCalledWith(
			"https://github.com/apps/example/installations/new?state=example",
		);
		expect(containsText(root, "/dashboard/integrations")).toBe(false);
	});

	it("connects GitHub for the same organization whose repositories are missing", async () => {
		hoisted.listAccounts.mockResolvedValue([
			{ name: "Example", active: true, organizationId: "org-example" },
		]);
		const { CloudSetupApiError } = await import("@/cloud");
		hoisted.listRepositories.mockRejectedValue(
			new CloudSetupApiError("Connect GitHub", 404),
		);
		const { root } = render(
			<OnboardingScreen
				cloudState={{ phase: "ready", sessions: [] }}
				onSignIn={() => {}}
				onRetryCloud={() => {}}
				onSaveCloudTarget={async () => {}}
				onFinish={() => {}}
			/>,
		);
		await act(async () => {});
		await act(async () => press(root, "Connect GitHub"));
		expect(hoisted.resolveInstallUrl).toHaveBeenCalledWith(
			"org-example",
			"connect",
		);
		expect(Linking.openURL).toHaveBeenCalledWith(
			"https://github.com/apps/example/installations/new?state=example",
		);
	});

	it("refreshes repositories after returning from GitHub", async () => {
		hoisted.listRepositories.mockResolvedValue([]);
		let onAppStateChange: ((state: string) => void) | undefined;
		vi.spyOn(AppState, "addEventListener").mockImplementation(
			(_event, listener) => {
				onAppStateChange = listener as (state: string) => void;
				return { remove: vi.fn() } as never;
			},
		);
		const { root } = render(
			<OnboardingScreen
				cloudState={{ phase: "ready", sessions: [] }}
				onSignIn={() => {}}
				onRetryCloud={() => {}}
				onSaveCloudTarget={async () => {}}
			/>,
		);
		advanceToConnect(root);
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		const callsBeforeReturn = hoisted.listRepositories.mock.calls.length;

		await act(async () => {
			onAppStateChange?.("background");
			onAppStateChange?.("active");
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(hoisted.listRepositories.mock.calls.length).toBeGreaterThan(
			callsBeforeReturn,
		);
	});
});
