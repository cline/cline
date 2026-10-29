import { AppState } from "react-native";
import { act } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CloudAuthProvider, useCloudAccountScope } from "@/state/cloud-auth";
import { cleanup, render } from "@/ui/__testing__/render";
import { type UseCloudSessions, useCloudSessions } from "./cloud-sessions";

const api = vi.hoisted(() => ({
	list: vi.fn(
		async (_organizationId?: string): Promise<unknown[]> => [
			{ id: "a", status: "running" },
		],
	),
	accounts: vi.fn(
		async (): Promise<
			Array<{ organizationId?: string; name: string; active: boolean }>
		> => [],
	),
	token: vi.fn(async () => "token"),
}));
vi.mock("@/cloud", async (original) => ({
	...(await original<typeof import("@/cloud")>()),
	cloudAuthStore: {
		identityVersion: 0,
		subscribeIdentity: () => () => {},
		getValidAccessToken: api.token,
	},
	CloudSessionGateway: class {
		constructor(private readonly options: { organizationId?: string }) {}
		listRemoteSessions = () => api.list(this.options.organizationId);
	},
}));
vi.mock("@/cloud/rest/CloudAccountGateway", () => ({
	CloudAccountGateway: class {
		listAccounts = api.accounts;
	},
}));
beforeEach(() => {
	api.token.mockResolvedValue("token");
	api.accounts.mockReset().mockResolvedValue([]);
	api.list.mockReset().mockResolvedValue([{ id: "a", status: "running" }]);
});
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
	const screen = render(
		<CloudAuthProvider>
			<Harness />
		</CloudAuthProvider>,
	);
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

function mountHistory() {
	let history!: UseCloudSessions;
	let account!: ReturnType<typeof useCloudAccountScope>;
	const frames: Array<{
		scope: typeof account.scope;
		state: UseCloudSessions["state"];
	}> = [];
	function Observe() {
		account = useCloudAccountScope();
		history = useCloudSessions({ openVerificationUrl: () => false });
		frames.push({ scope: account.scope, state: history.state });
		return null;
	}
	const screen = render(
		<CloudAuthProvider>
			<Observe />
		</CloudAuthProvider>,
	);
	return {
		...screen,
		frames,
		get history() {
			return history;
		},
		get account() {
			return account;
		},
	};
}
const membership = [
	{ name: "Personal", active: true },
	{ organizationId: "org-a", name: "Team", active: false },
	{ organizationId: "org-unrelated", name: "Other", active: false },
];
const personalRow = { id: "personal-task", status: "running" };
const orgRow = { id: "org-task", status: "running", organizationId: "org-a" };

it("shows only the selected Personal→Organization→Personal history and rejects late old-scope rows", async () => {
	api.accounts.mockResolvedValue(membership);
	let finishOldOrg!: (rows: unknown[]) => void;
	let finishPersonal!: (rows: unknown[]) => void;
	let holdOrg = false,
		holdPersonal = false;
	api.list.mockImplementation(async (organizationId) => {
		if (organizationId === "org-a")
			return holdOrg
				? new Promise((resolve) => {
						finishOldOrg = resolve;
					})
				: [orgRow];
		return holdPersonal
			? new Promise((resolve) => {
					finishPersonal = resolve;
				})
			: [personalRow];
	});
	const screen = mountHistory();
	await act(async () => {});
	expect(screen.history.state).toMatchObject({
		phase: "ready",
		sessions: [personalRow],
	});
	await act(async () =>
		screen.account.selectScope({ organizationId: "org-a" }),
	);
	expect(screen.history.state).toMatchObject({
		phase: "ready",
		sessions: [orgRow],
	});
	holdOrg = true;
	await act(async () => screen.history.refresh());
	expect(screen.history.state).toMatchObject({
		phase: "loading",
		sessions: [orgRow],
	});
	holdPersonal = true;
	await act(async () => screen.account.selectScope({}));
	expect(screen.history.state).toMatchObject({
		phase: "loading",
		sessions: [],
	});
	await act(async () =>
		finishOldOrg([{ ...orgRow, title: "Late private team result" }]),
	);
	expect(screen.history.state).toMatchObject({
		phase: "loading",
		sessions: [],
	});
	await act(async () => finishPersonal([personalRow]));
	expect(screen.history.state).toMatchObject({
		phase: "ready",
		sessions: [personalRow],
	});
	expect(api.list.mock.calls.map(([scope]) => scope)).not.toContain(
		"org-unrelated",
	);
	for (const frame of screen.frames) {
		if (!frame.scope) continue;
		const rows = "sessions" in frame.state ? (frame.state.sessions ?? []) : [];
		expect(
			rows.every((row) => row.organizationId === frame.scope?.organizationId),
		).toBe(true);
	}
});

it("waits for initial active-account discovery rather than assuming unknown scope is Personal", async () => {
	let finishAccounts!: (value: typeof membership) => void;
	api.accounts.mockReturnValue(
		new Promise((resolve) => {
			finishAccounts = resolve;
		}),
	);
	api.list.mockResolvedValue([orgRow]);
	const screen = mountHistory();
	await act(async () => {});
	expect(screen.account.scope).toBeUndefined();
	expect(api.list).not.toHaveBeenCalled();
	await act(async () =>
		finishAccounts(
			membership.map((account) => ({
				...account,
				active: account.organizationId === "org-a",
			})),
		),
	);
	expect(screen.account.scope).toEqual({ organizationId: "org-a" });
	expect(api.list.mock.calls.map(([scope]) => scope)).toEqual(["org-a"]);
	expect(screen.history.state).toMatchObject({
		phase: "ready",
		sessions: [orgRow],
	});
});

it("cannot let a late initial account response override a newer selected scope or publish its history", async () => {
	let finishAccounts!: (value: typeof membership) => void;
	api.accounts.mockReturnValue(
		new Promise((resolve) => {
			finishAccounts = resolve;
		}),
	);
	api.list.mockImplementation(async (scope) =>
		scope === "org-a" ? [orgRow] : [personalRow],
	);
	const screen = mountHistory();
	await act(async () => {});
	await act(async () =>
		screen.account.selectScope({ organizationId: "org-a" }),
	);
	expect(screen.history.state).toMatchObject({
		phase: "ready",
		sessions: [orgRow],
	});
	await act(async () => finishAccounts(membership));
	expect(screen.account.scope).toEqual({ organizationId: "org-a" });
	expect(screen.history.state).toMatchObject({
		phase: "ready",
		sessions: [orgRow],
	});
	expect(api.list.mock.calls.map(([scope]) => scope)).toEqual(["org-a"]);
});

it("does not query unrelated organization history or fail selected Personal history when that organization is unavailable", async () => {
	api.accounts.mockResolvedValue(membership);
	api.list.mockImplementation(async (scope) => {
		if (scope) throw new Error("Unrelated organization is unavailable");
		return [personalRow];
	});
	const screen = mountHistory();
	await act(async () => {});
	expect(api.list.mock.calls.map(([scope]) => scope)).toEqual([undefined]);
	expect(screen.history.state).toMatchObject({
		phase: "ready",
		sessions: [personalRow],
	});
});

it("retains only same-selected-scope cached rows through a transient error", async () => {
	api.accounts.mockResolvedValue(membership);
	api.list.mockImplementation(async (scope) =>
		scope === "org-a" ? [orgRow] : [personalRow],
	);
	const screen = mountHistory();
	await act(async () => {});
	await act(async () =>
		screen.account.selectScope({ organizationId: "org-a" }),
	);
	api.list.mockRejectedValueOnce(new Error("offline"));
	await act(async () => screen.history.refresh());
	expect(screen.history.state).toMatchObject({
		phase: "error",
		sessions: [orgRow],
		authenticated: true,
	});
	api.list.mockRejectedValueOnce(new Error("offline"));
	await act(async () => screen.account.selectScope({}));
	expect(screen.history.state).toMatchObject({
		phase: "error",
		sessions: [],
		authenticated: true,
	});
});

it("filters explicit foreign-scope DTOs even when the selected history endpoint returns mixed accounts", async () => {
	api.accounts.mockResolvedValue(membership);
	api.list.mockResolvedValue([
		personalRow,
		orgRow,
		{ ...orgRow, id: "foreign-task", organizationId: "org-unrelated" },
	]);
	const screen = mountHistory();
	await act(async () => {});
	expect(screen.history.state).toMatchObject({
		phase: "ready",
		sessions: [personalRow],
	});
	await act(async () =>
		screen.account.selectScope({ organizationId: "org-a" }),
	);
	expect(screen.history.state).toMatchObject({
		phase: "ready",
		sessions: [orgRow],
	});
});
