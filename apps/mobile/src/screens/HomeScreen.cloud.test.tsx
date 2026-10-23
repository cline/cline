/**
 * Cloud sign-in from the session list: the verification-URL allowlist,
 * cancellation/supersession of the device poll, and error copy. Carried over from
 * the retired Connect screen — the flow moved, its guarantees did not.
 *
 * `@/cloud` is mocked so the flow is driven without a network or SecureStore; the
 * real `isAllowedVerificationUrl` is kept, since it is what is under test.
 */

import { Linking } from "react-native";
import { act, type ReactTestInstance } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudAccount } from "@/cloud/rest/CloudAccountGateway";
import { cloudEnv } from "@/config/env";
import { ExecutionTargetStore } from "@/state/execution-target-store";
import { ExecutionTargetsProvider } from "@/state/execution-targets";
import { findAllByType, render } from "../ui/__testing__/render";
import { containsText } from "./__testing__/harness";
import { HomeScreen } from "./HomeScreen";

const hoisted = vi.hoisted(() => ({
	startClineDeviceAuth: vi.fn(),
	completeClineDeviceAuth: vi.fn(),
	setCredentials: vi.fn(async () => {}),
	getValidAccessToken: vi.fn(async (): Promise<string | null> => null),
	listRemoteSessions: vi.fn(async () => []),
	listAccounts: vi.fn(
		async (): Promise<CloudAccount[]> => [{ name: "Personal", active: true }],
	),
	listScopes: [] as Array<string | undefined>,
}));

vi.mock("@/cloud/rest/CloudAccountGateway", () => ({
	CloudAccountGateway: class {
		listAccounts = hoisted.listAccounts;
		switchAccount = vi.fn(async () => {});
	},
}));

vi.mock("@/cloud", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/cloud")>();
	class FakeGateway {
		constructor(options: { organizationId?: string }) {
			hoisted.listScopes.push(options.organizationId);
		}
		listRemoteSessions = hoisted.listRemoteSessions;
	}
	return {
		...actual,
		CloudSessionGateway: FakeGateway,
		cloudAuthStore: {
			setCredentials: hoisted.setCredentials,
			getValidAccessToken: hoisted.getValidAccessToken,
		},
		startClineDeviceAuth: hoisted.startClineDeviceAuth,
		completeClineDeviceAuth: hoisted.completeClineDeviceAuth,
	};
});
const AUTHORIZATION = {
	deviceCode: "device-code",
	userCode: "ABCD-1234",
	verificationUri: "https://api.workos.com/device",
	verificationUriComplete: "https://api.workos.com/device?code=ABCD-1234",
	expiresInSeconds: 300,
	pollIntervalSeconds: 5,
};

const CREDENTIALS = {
	access: "jwt",
	refresh: "refresh",
	expires: Date.now() + 60_000,
};

function press(root: ReactTestInstance, label: string): void {
	const node = root.findAll(
		(candidate) =>
			typeof candidate.type === "string" &&
			candidate.props.accessibilityLabel === label,
	)[0];
	if (!node) {
		throw new Error(`No pressable labelled "${label}"`);
	}
	node.props.onPress();
}

function openUrlMock() {
	return Linking.openURL as unknown as ReturnType<typeof vi.fn>;
}

async function mountHome() {
	const result = render(<HomeScreen onOpenSession={() => {}} />);
	await act(async () => {});
	if (
		result.root.findAll(
			(node) => node.props.accessibilityLabel === "Get started",
		).length > 0
	) {
		act(() => press(result.root, "Get started"));
	}
	return result;
}

beforeEach(() => {
	vi.clearAllMocks();
	hoisted.getValidAccessToken.mockResolvedValue(null);
	hoisted.listRemoteSessions.mockResolvedValue([]);
	hoisted.listAccounts.mockResolvedValue([{ name: "Personal", active: true }]);
	hoisted.listScopes.length = 0;
});

describe("HomeScreen cloud sign-in", () => {
	it("does not offer another sign-in while loading the account after successful authentication", async () => {
		const accounts = Promise.withResolvers<CloudAccount[]>();
		const targets = new ExecutionTargetStore();
		await targets.saveCloudTarget({
			repoUrl: "https://github.com/example/project",
			label: "example/project",
			modelId: "test-model",
		});
		hoisted.startClineDeviceAuth.mockResolvedValue(AUTHORIZATION);
		hoisted.completeClineDeviceAuth.mockResolvedValue(CREDENTIALS);
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.getValidAccessToken.mockResolvedValueOnce(null);
		hoisted.listAccounts.mockReturnValue(accounts.promise);
		const { root, unmount } = render(
			<ExecutionTargetsProvider store={targets}>
				<HomeScreen onOpenSession={() => {}} />
			</ExecutionTargetsProvider>,
		);
		await act(async () => {});
		await act(async () => press(root, "Sign in to Cline"));
		expect(hoisted.setCredentials).toHaveBeenCalledWith(CREDENTIALS);
		expect(containsText(root, "Checking your Cline account")).toBe(true);
		expect(
			root.findAll(
				(node) => node.props.accessibilityLabel === "Sign in to Cline",
			),
		).toHaveLength(0);
		await act(async () =>
			accounts.resolve([{ name: "Personal", active: true }]),
		);
		expect(containsText(root, "Checking your Cline account")).toBe(false);
		expect(hoisted.startClineDeviceAuth).toHaveBeenCalledTimes(1);
		unmount();
	});

	it("discovers organization sessions on a fresh install without saved targets", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.listAccounts.mockResolvedValue([
			{ name: "Personal", active: false },
			{ name: "Team", active: true, organizationId: "org-new" },
		]);
		await mountHome();
		expect(hoisted.listScopes).toContain(undefined);
		expect(hoisted.listScopes).toContain("org-new");
		expect(hoisted.listRemoteSessions).toHaveBeenCalledTimes(2);
	});
	it("opens an https verification URL", async () => {
		hoisted.startClineDeviceAuth.mockResolvedValue(AUTHORIZATION);
		hoisted.completeClineDeviceAuth.mockReturnValue(new Promise(() => {}));
		const { root } = await mountHome();

		await act(async () => {
			press(root, "Sign in to Cline");
		});

		expect(openUrlMock()).toHaveBeenCalledWith(
			AUTHORIZATION.verificationUriComplete,
		);
		expect(containsText(root, "ABCD-1234")).toBe(true);
		expect(containsText(root, AUTHORIZATION.verificationUriComplete)).toBe(
			true,
		);
		await act(async () => {
			press(root, "Open browser again");
		});
		expect(openUrlMock()).toHaveBeenCalledTimes(2);
		// Client id, api base and WorkOS base all come from the one env record, so
		// the SDK can reject a cross-environment pair.
		expect(hoisted.startClineDeviceAuth).toHaveBeenCalledWith({
			workOsClientId: cloudEnv.workOsClientId,
			apiBaseUrl: cloudEnv.apiBaseUrl,
			workOsBaseUrl: cloudEnv.workOsBaseUrl,
		});
		expect(hoisted.completeClineDeviceAuth).toHaveBeenCalledWith(
			expect.objectContaining({
				apiBaseUrl: cloudEnv.apiBaseUrl,
				workOsClientId: cloudEnv.workOsClientId,
				workOsBaseUrl: cloudEnv.workOsBaseUrl,
			}),
		);
	});

	it("keeps the setup step mounted while browser sign-in starts", async () => {
		const accounts = Promise.withResolvers<CloudAccount[]>();
		hoisted.listAccounts.mockReturnValue(accounts.promise);
		let beginAuthorization: (value: typeof AUTHORIZATION) => void = () => {};
		let finishAuthorization: (value: typeof CREDENTIALS) => void = () => {};
		let finishSessionLoad: (value: never[]) => void = () => {};
		hoisted.startClineDeviceAuth.mockReturnValue(
			new Promise((resolve) => {
				beginAuthorization = resolve;
			}),
		);
		hoisted.completeClineDeviceAuth.mockReturnValue(
			new Promise((resolve) => {
				finishAuthorization = resolve;
			}),
		);
		hoisted.getValidAccessToken.mockResolvedValueOnce(null);
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.listRemoteSessions.mockReturnValue(
			new Promise((resolve) => {
				finishSessionLoad = resolve;
			}),
		);
		const { root } = await mountHome();

		act(() => press(root, "Sign in to Cline"));
		expect(containsText(root, "Set up Cline")).toBe(true);
		expect(containsText(root, "Starting secure sign-in")).toBe(true);
		expect(containsText(root, "Loading Cline")).toBe(false);

		await act(async () => beginAuthorization(AUTHORIZATION));
		expect(containsText(root, "ABCD-1234")).toBe(true);

		await act(async () => finishAuthorization(CREDENTIALS));
		expect(containsText(root, "Set up Cline")).toBe(true);
		expect(containsText(root, "Checking your Cline account")).toBe(true);
		expect(containsText(root, "Loading Cline")).toBe(false);

		await act(async () =>
			accounts.resolve([{ name: "Personal", active: true }]),
		);
		expect(containsText(root, "Checking your Cline account")).toBe(false);
		await act(async () => finishSessionLoad([]));
	});

	it("never opens a non-https verification URL, and shows it instead", async () => {
		hoisted.startClineDeviceAuth.mockResolvedValue({
			...AUTHORIZATION,
			verificationUriComplete: "cline://auth?code=ABCD-1234",
		});
		hoisted.completeClineDeviceAuth.mockReturnValue(new Promise(() => {}));
		const { root } = await mountHome();

		await act(async () => {
			press(root, "Sign in to Cline");
		});

		expect(openUrlMock()).not.toHaveBeenCalled();
		// The code and the address are both on screen as copyable text.
		expect(containsText(root, "ABCD-1234")).toBe(true);
		expect(containsText(root, "cline://auth?code=ABCD-1234")).toBe(true);
		expect(containsText(root, "could not be opened safely")).toBe(true);
	});

	it("discards a poll that completes after the screen unmounts", async () => {
		let finishPoll: (value: unknown) => void = () => {};
		hoisted.startClineDeviceAuth.mockResolvedValue(AUTHORIZATION);
		hoisted.completeClineDeviceAuth.mockReturnValue(
			new Promise((resolve) => {
				finishPoll = resolve;
			}),
		);
		const { root, unmount } = await mountHome();

		await act(async () => {
			press(root, "Sign in to Cline");
		});
		unmount();
		await act(async () => {
			finishPoll(CREDENTIALS);
		});

		expect(hoisted.setCredentials).not.toHaveBeenCalled();
	});

	it("lets a refresh supersede an abandoned sign-in", async () => {
		let finishFirstPoll: (value: unknown) => void = () => {};
		hoisted.startClineDeviceAuth.mockResolvedValue(AUTHORIZATION);
		hoisted.completeClineDeviceAuth.mockReturnValueOnce(
			new Promise((resolve) => {
				finishFirstPoll = resolve;
			}),
		);
		const { root } = await mountHome();

		// Flow 1 is left polling…
		await act(async () => {
			press(root, "Sign in to Cline");
		});
		expect(containsText(root, "Waiting for confirmation")).toBe(true);

		// …and cancelling it retires that generation.
		await act(async () => {
			press(root, "Cancel sign-in");
		});
		await act(async () => {
			finishFirstPoll(CREDENTIALS);
		});

		// The abandoned attempt neither persists its tokens nor repaints the screen.
		expect(hoisted.setCredentials).not.toHaveBeenCalled();
		expect(containsText(root, "Waiting for confirmation")).toBe(false);
		expect(containsText(root, "Sign in")).toBe(true);
	});

	it("persists credentials for the flow that is still current", async () => {
		hoisted.startClineDeviceAuth.mockResolvedValue(AUTHORIZATION);
		hoisted.completeClineDeviceAuth.mockResolvedValue(CREDENTIALS);
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		// The mount-time load finds nothing, so the screen offers sign-in; the load
		// *after* sign-in is the one that sees a token.
		hoisted.getValidAccessToken.mockResolvedValueOnce(null);
		const { root } = await mountHome();

		await act(async () => {
			press(root, "Sign in to Cline");
		});

		expect(hoisted.setCredentials).toHaveBeenCalledWith(CREDENTIALS);
		expect(hoisted.listRemoteSessions).toHaveBeenCalled();
	});

	it("shows a friendly message and makes technical details available on demand", async () => {
		hoisted.startClineDeviceAuth.mockRejectedValue(
			new Error("Token registration failed: 500 - <html>Internal error</html>"),
		);
		const { root } = await mountHome();

		await act(async () => {
			press(root, "Sign in to Cline");
		});

		expect(containsText(root, "Something went wrong with Cline Cloud.")).toBe(
			true,
		);
		expect(containsText(root, "Token registration failed: 500")).toBe(false);
		act(() => press(root, "Technical details, expand"));
		expect(containsText(root, "Token registration failed: 500")).toBe(true);
	});

	it("explains an expired session instead of printing the status line", async () => {
		const { CloudSessionApiError } = await import("@/cloud");
		hoisted.getValidAccessToken.mockRejectedValue(
			new CloudSessionApiError("Failed to list sessions: 401", 401),
		);
		const { root } = await mountHome();

		expect(containsText(root, "Your Cline session has expired.")).toBe(true);
	});

	it("opens existing Cloud sessions without forcing new-work setup", async () => {
		hoisted.getValidAccessToken.mockResolvedValue("jwt");
		hoisted.listRemoteSessions.mockResolvedValue([
			{
				id: "sess_1",
				sandboxUrl: "https://pod-1.cline.bot/hub",
				status: "running",
				expiredAt: null,
				title: "Ship the mobile app",
				updatedAt: Date.now(),
			},
		] as never);
		const { root } = await mountHome();

		expect(containsText(root, "Use Cline from anywhere")).toBe(false);
		expect(
			root.findAll(
				(node) => node.props.accessibilityLabel === "Message Cline from Home",
			),
		).not.toHaveLength(0);
		// Existing work stays one tap away; it must not cover the new-task composer.
		expect(findAllByType(root, "Modal").at(0)?.props.visible).toBe(false);
	});
});
