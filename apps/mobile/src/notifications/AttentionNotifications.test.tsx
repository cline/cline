import * as Notifications from "expo-notifications";
import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ConnectionDescriptor,
	descriptorKey,
} from "../connection/endpoints";
import { render } from "../ui/__testing__/render";
import { AttentionNotifications } from "./AttentionNotifications";
import { watchTaskAlerts } from "./attention-notifications";

const fixture = vi.hoisted(() => ({
	push: vi.fn(),
	get: vi.fn(),
	credentials: vi.fn(),
	clearListeners: new Set<(event: { type: "clear" }) => void>(),
}));
vi.mock("@/cloud", () => ({
	cloudAuthStore: { getCredentials: fixture.credentials },
}));
vi.mock("expo-router", () => {
	const router = { push: fixture.push };
	return { useRouter: () => router };
});
vi.mock("@/state/endpoints", () => {
	const store = { get: fixture.get };
	return { useEndpoints: () => ({ store, hydrated: true }) };
});
vi.mock("@/connection", () => ({
	chatRouteParams: (descriptor: ConnectionDescriptor) => ({
		endpointKey: JSON.stringify([descriptor.mode, descriptor.url]),
	}),
}));
vi.mock("@/connection/cloud-launches", () => ({
	cloudLaunches: {
		subscribeAttention: (listener: (event: { type: "clear" }) => void) => {
			fixture.clearListeners.add(listener);
			return () => {
				fixture.clearListeners.delete(listener);
			};
		},
	},
}));
vi.mock("./attention-notifications", async (original) => ({
	...(await original<typeof import("./attention-notifications")>()),
	watchTaskAlerts: vi.fn(() => vi.fn()),
}));

const descriptor: ConnectionDescriptor = {
	mode: "cloud",
	url: "https://saved.invalid/task",
	remoteSessionId: "outer",
	hubSessionId: "inner",
};
function response(
	data: unknown = {
		type: "cline-task-attention",
		endpointKey: descriptorKey(descriptor),
		remoteSessionId: "outer",
		sessionId: "inner",
	},
	identifier = "notification-1",
) {
	return {
		notification: { request: { identifier, content: { data } } },
	} as Notifications.NotificationResponse;
}
let received: (response: Notifications.NotificationResponse) => void;
const remove = vi.fn();
beforeEach(() => {
	vi.clearAllMocks();
	fixture.clearListeners.clear();
	fixture.get.mockReturnValue(descriptor);
	fixture.credentials.mockResolvedValue({
		access: "private-token-not-in-notification",
	});
	vi.mocked(Notifications.getLastNotificationResponse).mockReturnValue(null);
	vi.mocked(
		Notifications.addNotificationResponseReceivedListener,
	).mockImplementation((listener) => {
		received = listener;
		return { remove };
	});
});
describe("task notification navigation", () => {
	it("opens only the stored exact task and deduplicates cold-start plus response callbacks", async () => {
		vi.mocked(Notifications.getLastNotificationResponse).mockReturnValue(
			response(),
		);
		render(<AttentionNotifications />);
		await act(async () => {
			received(response());
		});
		expect(fixture.push).toHaveBeenCalledExactlyOnceWith({
			pathname: "/chat",
			params: { endpointKey: descriptorKey(descriptor) },
		});
		expect(Notifications.clearLastNotificationResponse).toHaveBeenCalledOnce();
	});

	it("rejects signed-out, deleted, wrong-session and arbitrary URL notifications", async () => {
		render(<AttentionNotifications />);
		fixture.credentials.mockResolvedValueOnce(null);
		await act(async () => received(response(undefined, "signed-out")));
		fixture.get.mockReturnValueOnce(undefined);
		await act(async () => received(response(undefined, "deleted")));
		fixture.get.mockReturnValueOnce({
			...descriptor,
			hubSessionId: "replacement",
		});
		await act(async () => received(response(undefined, "replaced")));
		await act(async () =>
			received(
				response({ type: "url", url: "https://attacker.invalid" }, "untrusted"),
			),
		);
		expect(fixture.push).not.toHaveBeenCalled();
	});

	it.each([
		"sign-out",
		"unmount",
	])("retires a pending authentication lookup on %s", async (action) => {
		let finish = (_value: unknown) => {};
		fixture.credentials.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const screen = render(<AttentionNotifications />);
		act(() => received(response()));
		if (action === "sign-out")
			act(() => {
				for (const listener of fixture.clearListeners)
					listener({ type: "clear" });
			});
		else screen.unmount();
		await act(async () => finish({ access: "old-account" }));
		expect(fixture.push).not.toHaveBeenCalled();
		if (action === "unmount") {
			expect(remove).toHaveBeenCalledOnce();
			expect(fixture.clearListeners.size).toBe(0);
			expect(
				vi.mocked(watchTaskAlerts).mock.results[0]?.value,
			).toHaveBeenCalledOnce();
		}
	});
});
