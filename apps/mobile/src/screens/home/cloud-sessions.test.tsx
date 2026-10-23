import { AppState } from "react-native";
import { act } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@/ui/__testing__/render";
import { type UseCloudSessions, useCloudSessions } from "./cloud-sessions";

const api = vi.hoisted(() => ({
	list: vi.fn(async (): Promise<unknown[]> => [{ id: "a", status: "running" }]),
	token: vi.fn(async () => "token"),
}));
vi.mock("@/cloud", async (original) => ({
	...(await original<typeof import("@/cloud")>()),
	cloudAuthStore: { getValidAccessToken: api.token },
	CloudSessionGateway: class {
		listRemoteSessions = api.list;
	},
}));
vi.mock("@/cloud/rest/CloudAccountGateway", () => ({
	CloudAccountGateway: class {
		listAccounts = async () => [];
	},
}));
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.clearAllMocks();
});

it("refreshes visible history without dropping rows, skips overlapping/background loads and stops on unmount", async () => {
	vi.useFakeTimers();
	let value!: UseCloudSessions;
	function Harness() {
		value = useCloudSessions({
			openVerificationUrl: () => false,
			refreshIntervalMs: 30_000,
		});
		return null;
	}
	const screen = render(<Harness />);
	await act(async () => {});
	expect(api.list).toHaveBeenCalledTimes(1);
	let resolve!: (rows: unknown[]) => void;
	api.list.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(30_000);
	});
	expect(value.state).toMatchObject({
		phase: "loading",
		sessions: [{ id: "a" }],
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(60_000);
	});
	expect(api.list).toHaveBeenCalledTimes(2);
	await act(async () => {
		resolve([{ id: "a", status: "suspended" }]);
	});
	expect(value.state).toMatchObject({
		phase: "ready",
		sessions: [{ status: "suspended" }],
	});
	const current = vi.spyOn(AppState, "currentState", "get");
	current.mockReturnValue("background");
	await act(async () => {
		await vi.advanceTimersByTimeAsync(30_000);
	});
	expect(api.list).toHaveBeenCalledTimes(2);
	current.mockRestore();
	screen.unmount();
	await vi.advanceTimersByTimeAsync(30_000);
	expect(api.list).toHaveBeenCalledTimes(2);
});
