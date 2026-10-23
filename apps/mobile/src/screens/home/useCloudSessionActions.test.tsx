import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { descriptorKey, SavedEndpointsStore } from "@/connection";
import { cloudLaunches } from "@/connection/cloud-launches";
import { EndpointsProvider } from "@/state/endpoints";
import { render } from "../../ui/__testing__/render";
import type { SessionRow } from "./session-rows";
import { useCloudSessionActions } from "./useCloudSessionActions";

const mocks = vi.hoisted(() => ({
	updateTitle: vi.fn(),
	deleteRemoteSession: vi.fn(),
	suspendRemoteSession: vi.fn(),
	options: vi.fn(),
}));
vi.mock("@/cloud", () => ({
	cloudAuthStore: { getValidAccessToken: async () => "token" },
	CloudSessionGateway: class {
		constructor(options: unknown) {
			mocks.options(options);
		}
		updateTitle = mocks.updateTitle;
		deleteRemoteSession = mocks.deleteRemoteSession;
		suspendRemoteSession = mocks.suspendRemoteSession;
	},
}));
const descriptor = {
	mode: "cloud" as const,
	url: "https://api.test/session/one",
	remoteSessionId: "one",
	organizationId: "org-1",
	apiBaseUrl: "https://api.test",
	hubSessionId: "task-exact",
};
const row: SessionRow = {
	key: descriptorKey(descriptor),
	kind: "session",
	title: "Old",
	location: { kind: "cloud", name: "Cloud" },
	online: false,
	descriptor,
};
beforeEach(() => {
	vi.clearAllMocks();
	mocks.updateTitle.mockResolvedValue(undefined);
	mocks.deleteRemoteSession.mockResolvedValue(undefined);
	mocks.suspendRemoteSession.mockResolvedValue(undefined);
});
async function mount() {
	const store = new SavedEndpointsStore();
	await store.save(descriptor);
	const refresh = vi.fn();
	const deleted = vi.fn();
	let actions!: ReturnType<typeof useCloudSessionActions>;
	function Harness() {
		actions = useCloudSessionActions(refresh, deleted);
		return null;
	}
	render(
		<EndpointsProvider store={store}>
			<Harness />
		</EndpointsProvider>,
	);
	await act(async () => {});
	return { actions, store, refresh, deleted };
}
describe("Cloud session actions", () => {
	it("stops a workspace without deleting saved history and closes its retained connection only on success", async () => {
		const { actions, store, deleted: closed, refresh } = await mount();
		const removeLaunch = vi.spyOn(cloudLaunches, "remove");
		mocks.suspendRemoteSession.mockRejectedValueOnce(new Error("Offline"));
		await expect(actions.onStopWorkspace(row)).rejects.toThrow("Offline");
		expect(removeLaunch).not.toHaveBeenCalled();
		expect(closed).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
		await act(() => actions.onStopWorkspace(row));
		expect(mocks.suspendRemoteSession).toHaveBeenLastCalledWith("one");
		expect(mocks.options).toHaveBeenLastCalledWith(
			expect.objectContaining({ organizationId: "org-1" }),
		);
		expect(store.get(row.key)).toMatchObject({ hubSessionId: "task-exact" });
		expect(mocks.deleteRemoteSession).not.toHaveBeenCalled();
		expect(removeLaunch).toHaveBeenCalledExactlyOnceWith(row.key);
		expect(closed).toHaveBeenCalledExactlyOnceWith(row.key);
		expect(refresh).toHaveBeenCalledOnce();
		removeLaunch.mockRestore();
	});
	it("renames exact scoped session and preserves inner session identity", async () => {
		const { actions, store, refresh } = await mount();
		await act(() => actions.onRenameSession(row, "Renamed"));
		expect(mocks.options).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				apiBaseUrl: "https://api.test",
			}),
		);
		expect(mocks.updateTitle).toHaveBeenCalledWith("one", "Renamed");
		expect(store.get(row.key)).toMatchObject({
			label: "Renamed",
			hubSessionId: "task-exact",
		});
		expect(refresh).toHaveBeenCalledOnce();
	});
	it("does not remove local state or navigate when server deletion fails", async () => {
		const { actions, store, deleted, refresh } = await mount();
		mocks.deleteRemoteSession.mockRejectedValueOnce(new Error("Offline"));
		await expect(actions.onDeleteSession(row)).rejects.toThrow("Offline");
		expect(store.get(row.key)).toBeDefined();
		expect(deleted).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
	});
	it("removes the exact saved connection after successful deletion", async () => {
		const { actions, store, deleted } = await mount();
		await act(() => actions.onDeleteSession(row));
		expect(mocks.deleteRemoteSession).toHaveBeenCalledWith("one");
		expect(store.get(row.key)).toBeUndefined();
		expect(deleted).toHaveBeenCalledWith(row.key);
	});
});
