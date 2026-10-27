import { Alert, Linking } from "react-native";
import { act, type ReactTestInstance } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/features", () => ({ COMPUTER_CONNECTIONS_ENABLED: true }));

import {
	ClineAuthStore,
	type ClineOAuthCredentials,
	createInMemoryAuthStorage,
} from "@/cloud";
import { type ConnectionDescriptor, SavedEndpointsStore } from "@/connection";
import { DEFAULT_APPROVAL_POLICY } from "@/session";
import { ApprovalPolicyStore } from "@/state/approval-policy-store";
import { CloudAuthProvider } from "@/state/cloud-auth";
import { EndpointsProvider } from "@/state/endpoints";
import { ExecutionTargetStore } from "@/state/execution-target-store";
import { ExecutionTargetsProvider } from "@/state/execution-targets";
import { LastOpenedProvider, LastOpenedStore } from "@/state/last-opened";
import { SettingsProvider } from "@/state/settings";
import { render } from "../ui/__testing__/render";
import { containsText } from "./__testing__/harness";
import { SettingsScreen } from "./SettingsScreen";

vi.mock("@/cloud/rest/CloudAccountGateway", () => ({
	CloudAccountGateway: class {
		listAccounts = async () => [{ name: "Personal", active: true }];
	},
}));

function credentials(
	overrides: Partial<ClineOAuthCredentials> = {},
): ClineOAuthCredentials {
	return {
		access: "jwt",
		refresh: "refresh",
		expires: Date.now() + 60_000,
		accountId: "usr-1",
		email: "dev@example.com",
		metadata: { provider: "cline" },
		...overrides,
	};
}

function renderScreen(store = new ApprovalPolicyStore()) {
	const endpoints = new SavedEndpointsStore();
	void endpoints.save({ mode: "local", url: "ws://localhost:4599/hub" });
	const result = render(
		<EndpointsProvider store={endpoints}>
			<SettingsProvider store={store}>
				<SettingsScreen onBack={() => {}} />
			</SettingsProvider>
		</EndpointsProvider>,
	);
	return { ...result, store };
}

/**
 * The account section reads storage in an effect, so the render has to be
 * flushed once before asserting on it.
 */
async function renderWithAccount(
	initial: ClineOAuthCredentials | null,
	onSignedOut = () => {},
) {
	const storage = createInMemoryAuthStorage(initial);
	const authStore = new ClineAuthStore({ storage });
	const result = render(
		<CloudAuthProvider store={authStore}>
			<SettingsProvider store={new ApprovalPolicyStore()}>
				<SettingsScreen onBack={() => {}} onSignedOut={onSignedOut} />
			</SettingsProvider>
		</CloudAuthProvider>,
	);
	await act(async () => {});
	return { ...result, storage, authStore };
}

function pressableFor(
	root: ReactTestInstance,
	label: string,
): ReactTestInstance {
	const found = root.findAll(
		(node) =>
			typeof node.type === "string" && node.props.accessibilityLabel === label,
	);
	if (found.length === 0) {
		throw new Error(`No pressable labelled "${label}"`);
	}
	return found[0] as ReactTestInstance;
}

/**
 * Host-only switch nodes, in render order. `findAll` also returns the composite
 * `Toggle` that forwards the same props, which would double every match.
 */
function switches(root: ReactTestInstance): ReactTestInstance[] {
	return root.findAll(
		(node) =>
			typeof node.type === "string" &&
			node.props.accessibilityRole === "switch",
	);
}

function switchFor(root: ReactTestInstance, label: string): ReactTestInstance {
	const found = switches(root).find(
		(node) => node.props.accessibilityLabel === label,
	);
	if (!found) {
		throw new Error(`No switch labelled "${label}"`);
	}
	return found;
}

/** Any host node carrying this `accessibilityLabel` (fields, not just buttons). */
function labelled(
	root: ReactTestInstance,
	label: string,
): ReactTestInstance | undefined {
	return root
		.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.props.accessibilityLabel === label,
		)
		.at(-1);
}

/** Settings with the Advanced section enabled (an `onConnect` is supplied). */
async function renderWithConnect(
	options: {
		endpointStore?: SavedEndpointsStore;
		onConnect?: (descriptor: ConnectionDescriptor) => void;
		onPairComputer?: () => void;
	} = {},
) {
	const endpointStore = options.endpointStore ?? new SavedEndpointsStore();
	const result = render(
		<EndpointsProvider store={endpointStore}>
			<LastOpenedProvider store={new LastOpenedStore()}>
				<SettingsProvider store={new ApprovalPolicyStore()}>
					<SettingsScreen
						onBack={() => {}}
						onConnect={options.onConnect ?? (() => {})}
						onPairComputer={options.onPairComputer}
					/>
				</SettingsProvider>
			</LastOpenedProvider>
		</EndpointsProvider>,
	);
	await act(async () => {});
	return { ...result, endpointStore };
}

describe("SettingsScreen", () => {
	it("uses a readable saved workspace model caption without changing its selection ID", async () => {
		const targets = new ExecutionTargetStore();
		await targets.saveCloudTarget({
			label: "team/repo",
			repoUrl: "https://github.com/team/repo",
			modelId: "anthropic/claude-sonnet-5",
		});
		const { root } = render(
			<ExecutionTargetsProvider store={targets}>
				<SettingsScreen />
			</ExecutionTargetsProvider>,
		);
		await act(async () => {});
		expect(containsText(root, "Claude Sonnet 5")).toBe(true);
		expect(containsText(root, "anthropic/claude-sonnet-5")).toBe(false);
		expect(targets.get().cloudTargets[0]?.modelId).toBe(
			"anthropic/claude-sonnet-5",
		);
	});
	it("hides phone-local approval controls when there is no local connection", () => {
		const { root } = render(
			<EndpointsProvider store={new SavedEndpointsStore()}>
				<SettingsProvider store={new ApprovalPolicyStore()}>
					<SettingsScreen onBack={() => {}} />
				</SettingsProvider>
			</EndpointsProvider>,
		);
		expect(switches(root)).toHaveLength(0);
		expect(containsText(root, "Auto-approve")).toBe(false);
		expect(containsText(root, "Unfamiliar tools follow Run commands")).toBe(
			false,
		);
	});
	it("keeps QR pairing inside Advanced", async () => {
		const onPairComputer = vi.fn();
		const { root } = await renderWithConnect({ onPairComputer });
		expect(labelled(root, "Scan handoff QR")).toBeUndefined();
		expect(labelled(root, "Pair")).toBeUndefined();
		act(() =>
			pressableFor(root, "Advanced connection options, expand").props.onPress(),
		);
		expect(containsText(root, "/handoff")).toBe(true);
		act(() => pressableFor(root, "Scan handoff QR").props.onPress());
		expect(onPairComputer).toHaveBeenCalledOnce();
	});
	it("renders a row per tier with its risk copy", () => {
		const { root, json } = renderScreen();
		expect(json).not.toBeNull();
		expect(containsText(root, "Read files")).toBe(true);
		expect(containsText(root, "Edit files")).toBe(true);
		expect(containsText(root, "Run commands")).toBe(true);
		expect(
			containsText(
				root,
				"Run shell commands — can modify or delete anything in the workspace.",
			),
		).toBe(true);
	});

	it("explains which setting controls unrecognised tools", () => {
		const { root } = renderScreen();
		expect(containsText(root, "Unfamiliar tools follow Run commands")).toBe(
			true,
		);
		expect(containsText(root, "MCP tools")).toBe(true);
	});

	it("reflects the default policy in the switches", () => {
		const { root } = renderScreen();
		const rows = switches(root);
		expect(rows).toHaveLength(3);
		expect(
			rows.map((node) => [
				node.props.accessibilityLabel,
				node.props.accessibilityState?.checked,
			]),
		).toEqual([
			["Auto-approve Read files", true],
			["Auto-approve Edit files", true],
			["Auto-approve Run commands", true],
		]);
		expect(DEFAULT_APPROVAL_POLICY.read).toBe("auto");
	});

	it("writes a tier to the store when its switch is pressed", () => {
		const { root, store } = renderScreen();

		act(() => {
			switchFor(root, "Auto-approve Run commands").props.onPress();
		});

		expect(store.get().execute).toBe("ask");
		expect(store.get().read).toBe("auto");
		expect(store.get().write).toBe("auto");
		// The row re-renders off the store subscription, not local state.
		expect(
			switchFor(root, "Auto-approve Run commands").props.accessibilityState
				?.checked,
		).toBe(false);
	});

	it("shows the signed-in account and a sign-out affordance", async () => {
		const { root } = await renderWithAccount(credentials());

		expect(containsText(root, "Account")).toBe(true);
		expect(containsText(root, "dev@example.com")).toBe(true);
		expect(() => pressableFor(root, "Sign out")).not.toThrow();
	});
	it("shows the stored profile name and offers real account details in the dashboard", async () => {
		const { root } = await renderWithAccount(
			credentials({
				metadata: {
					provider: "cline",
					userInfo: {
						name: "Ada Example",
						email: "dev@example.com",
						subject: null,
						clineUserId: "usr-1",
						accounts: null,
					},
				},
			}),
		);
		expect(containsText(root, "Ada Example")).toBe(true);
		expect(containsText(root, "dev@example.com")).toBe(true);
		expect(containsText(root, "Current account: ")).toBe(true);
		await act(async () =>
			pressableFor(root, "Account and usage").props.onPress(),
		);
		expect(Linking.openURL).toHaveBeenCalledWith(
			"https://staging-app.cline.bot/dashboard",
		);
	});
	it("keeps Sign out secondary and requires an explicit confirmation without discarding credentials on cancel", async () => {
		const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
		try {
			const onSignedOut = vi.fn();
			const { root, storage } = await renderWithAccount(
				credentials(),
				onSignedOut,
			);
			// Inspect the real Button component instead of inferring styling from its label.
			const signOutComponent = root
				.findAll(
					(node) =>
						typeof node.type !== "string" && node.props.label === "Sign out",
				)
				.at(-1);
			expect(signOutComponent?.props.variant).toBe("ghost");
			expect(signOutComponent?.props.fullWidth).not.toBe(true);
			act(() => pressableFor(root, "Sign out").props.onPress());
			expect(await storage.load()).not.toBeNull();
			expect(onSignedOut).not.toHaveBeenCalled();
			const buttons = alert.mock.calls.at(-1)?.[2];
			expect(buttons?.map((button) => button.text)).toEqual([
				"Cancel",
				"Sign out",
			]);
			act(() =>
				buttons?.find((button) => button.text === "Cancel")?.onPress?.(),
			);
			expect(await storage.load()).not.toBeNull();
			await act(async () =>
				buttons?.find((button) => button.text === "Sign out")?.onPress?.(),
			);
			expect(await storage.load()).toBeNull();
			expect(onSignedOut).toHaveBeenCalledOnce();
		} finally {
			alert.mockRestore();
		}
	});

	it("falls back to a generic signed-in label without an email", async () => {
		const { root } = await renderWithAccount(
			credentials({ email: undefined, metadata: { provider: "cline" } }),
		);

		expect(containsText(root, "Signed in")).toBe(true);
	});

	it("says so when no cloud account is stored, with no sign-out button", async () => {
		const { root } = await renderWithAccount(null);

		expect(containsText(root, "Not signed in")).toBe(true);
		expect(() => pressableFor(root, "Sign out")).toThrow();
	});

	it("wipes the credentials and returns to Connect on sign out", async () => {
		const onSignedOut = vi.fn();
		const { root, storage } = await renderWithAccount(
			credentials(),
			onSignedOut,
		);

		await act(async () => {
			pressableFor(root, "Sign out").props.onPress();
		});

		expect(await storage.load()).toBeNull();
		expect(onSignedOut).toHaveBeenCalledTimes(1);
		// The row flips to the signed-out copy without a reload.
		expect(containsText(root, "Not signed in")).toBe(true);
	});

	it("shows a hydrated non-default policy", async () => {
		const store = new ApprovalPolicyStore();
		await store.setPolicy({ read: "ask", write: "auto", execute: "ask" });
		const { root } = renderScreen(store);
		expect(
			switches(root).map((node) => node.props.accessibilityState?.checked),
		).toEqual([false, true, false]);
	});
});

describe("SettingsScreen advanced connections", () => {
	it("hides the manual form behind a collapsed disclosure", async () => {
		const { root } = await renderWithConnect();
		expect(containsText(root, "Connections")).toBe(true);
		expect(
			pressableFor(root, "Advanced connection options, expand"),
		).toBeDefined();
		expect(labelled(root, "Hub WebSocket URL")).toBeUndefined();
	});

	it("connects a hand-entered hub, saving it first", async () => {
		const connected: ConnectionDescriptor[] = [];
		const endpointStore = new SavedEndpointsStore();
		const { root } = await renderWithConnect({
			endpointStore,
			onConnect: (descriptor) => connected.push(descriptor),
		});
		await act(async () => {
			pressableFor(root, "Advanced connection options, expand").props.onPress();
		});
		await act(async () => {
			labelled(root, "Hub WebSocket URL")?.props.onChangeText(
				"wss://hub.example.test/hub",
			);
		});
		await act(async () => {
			labelled(root, "Hub auth token")?.props.onChangeText("tok");
		});
		await act(async () => {
			pressableFor(root, "Connect").props.onPress();
		});

		expect(connected).toEqual([
			{
				mode: "local",
				url: "wss://hub.example.test/hub",
				authToken: "tok",
			},
		]);
		// Saved before navigating: the chat route resolves the key through the store.
		expect(endpointStore.list()).toHaveLength(1);
	});

	it("refuses a plaintext token connection to another LAN host", async () => {
		const onConnect = vi.fn();
		const { root } = await renderWithConnect({ onConnect });
		act(() => {
			pressableFor(root, "Advanced connection options, expand").props.onPress();
		});
		act(() => {
			labelled(root, "Hub WebSocket URL")?.props.onChangeText(
				"ws://10.0.0.9:4599/hub",
			);
		});
		act(() => {
			pressableFor(root, "Connect").props.onPress();
		});

		expect(onConnect).not.toHaveBeenCalled();
		expect(
			containsText(
				root,
				"Use wss:// for a remote hub. For a computer on your network, use /handoff so the connection is encrypted.",
			),
		).toBe(true);
	});

	it("omits the section entirely when the surface cannot connect", async () => {
		const { root } = await renderWithAccount(null);
		expect(containsText(root, "Connections")).toBe(false);
		expect(labelled(root, "Hub WebSocket URL")).toBeUndefined();
	});

	it("points a signed-out account at the session list, not a Connect screen", async () => {
		const { root } = await renderWithAccount(null);
		expect(containsText(root, "Sign in from your session list")).toBe(true);
		expect(containsText(root, "Connect screen")).toBe(false);
	});
});
