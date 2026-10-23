import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { asRemoteSessionId, type RemoteSession } from "@/session";
import { render } from "../ui/__testing__/render";
import { DestinationScreen } from "./DestinationScreen";
import type { CloudSessionsState } from "./home/cloud-sessions";

const cloud = vi.hoisted(() => ({
	getState: vi.fn<() => CloudSessionsState>(),
	signIn: vi.fn(),
	refresh: vi.fn(),
}));
vi.mock("./home/cloud-sessions", async (importOriginal) => ({
	...(await importOriginal<typeof import("./home/cloud-sessions")>()),
	useCloudSessions: () => ({ ...cloud, state: cloud.getState() }),
}));

describe("Cloud destination history", () => {
	it("retains rows through refresh and transient failure, then clears them on authentication loss", () => {
		const sessions: RemoteSession[] = [
			{
				id: asRemoteSessionId("retained-session"),
				sandboxUrl: "https://workspace.example/hub",
				status: "suspended",
				expiredAt: null,
				title: "Review the change",
			},
		];
		cloud.getState.mockReturnValue({ phase: "ready", sessions });
		const screen = () => (
			<DestinationScreen
				destination="cloud"
				onBack={() => {}}
				onOpenSession={() => {}}
			/>
		);
		const { root, renderer } = render(screen());
		const rows = () =>
			root.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.props.accessibilityLabel ===
						"Open Review the change on Cloud pod",
			);
		expect(rows()).toHaveLength(1);
		for (const state of [
			{ phase: "loading", sessions, authenticated: true },
			{
				phase: "error",
				sessions,
				authenticated: true,
				message: "Could not refresh",
				recovery: "retry",
			},
		] satisfies CloudSessionsState[]) {
			cloud.getState.mockReturnValue(state);
			act(() => renderer.update(screen()));
			expect(rows()).toHaveLength(1);
		}
		for (const state of [
			{
				phase: "error",
				sessions: [],
				authenticated: false,
				message: "Sign in again",
				recovery: "sign-in",
			},
			{ phase: "signed-out" },
		] satisfies CloudSessionsState[]) {
			cloud.getState.mockReturnValue(state);
			act(() => renderer.update(screen()));
			expect(rows()).toHaveLength(0);
		}
	});
});
