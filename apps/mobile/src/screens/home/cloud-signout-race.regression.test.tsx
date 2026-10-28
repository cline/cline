import { act } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { cloudAuthStore } from "@/cloud";
import {
	CloudAuthProvider,
	type UseCloudAuth,
	useCloudAuth,
} from "@/state/cloud-auth";
import { cleanup, render } from "@/ui/__testing__/render";
import { type UseCloudSessions, useCloudSessions } from "./cloud-sessions";

const api = vi.hoisted(() => ({ list: vi.fn<() => Promise<unknown[]>>() }));
vi.mock("@/cloud", async (original) => {
	const actual = await original<typeof import("@/cloud")>();
	return {
		...actual,
		cloudAuthStore: new actual.ClineAuthStore({
			storage: actual.createInMemoryAuthStorage(),
			resolveCredentials: async (credentials) => credentials,
		}),
		CloudSessionGateway: class {
			listRemoteSessions = api.list;
		},
	};
});
vi.mock("@/cloud/rest/CloudAccountGateway", () => ({
	CloudAccountGateway: class {
		listAccounts = async () => [];
	},
}));
afterEach(cleanup);

it("does not publish a private list response received after explicit sign-out", async () => {
	await cloudAuthStore.setCredentials({
		access: "fixture-access",
		refresh: "fixture-refresh",
		expires: Date.now() + 600_000,
	});
	let finishList!: (rows: unknown[]) => void;
	api.list.mockImplementation(
		() =>
			new Promise((resolve) => {
				finishList = resolve;
			}),
	);
	let auth!: UseCloudAuth;
	let history!: UseCloudSessions;
	function Observe() {
		auth = useCloudAuth();
		history = useCloudSessions({ openVerificationUrl: () => false });
		return null;
	}
	render(
		<CloudAuthProvider store={cloudAuthStore}>
			<Observe />
		</CloudAuthProvider>,
	);
	await act(async () => {});
	expect(api.list).toHaveBeenCalledOnce();
	await act(async () => {
		await auth.signOut();
	});
	expect(auth.account.phase).toBe("signed-out");
	expect(await cloudAuthStore.getValidAccessToken()).toBeNull();
	await act(async () => {
		finishList([
			{
				id: "private-old-account",
				title: "Private old account task",
				status: "running",
				sandboxUrl: "https://fixture.invalid/private",
			},
		]);
	});
	expect(history.state).toMatchObject({ phase: "signed-out" });
	expect("sessions" in history.state ? history.state.sessions : []).toEqual([]);
});
