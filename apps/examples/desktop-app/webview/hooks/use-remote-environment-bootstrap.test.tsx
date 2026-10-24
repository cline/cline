// @vitest-environment jsdom
import {
	Activity,
	act,
	useCallback,
	useReducer,
	useRef,
	useState,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
	createDesktopAppState,
	type DesktopAppAction,
	desktopAppReducer,
} from "@/lib/desktop-app-state";
import type { RemoteWorkspaceEnvironment } from "@/lib/workspace-environment";
import { useRemoteEnvironmentBootstrap } from "./use-remote-environment-bootstrap";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke } }));

const container = document.createElement("div");
let root = createRoot(container);
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
	act(() => root.unmount());
	root = createRoot(container);
	vi.clearAllMocks();
	nextDraft = 0;
});

let nextDraft = 0;
let dispatchApp: (action: DesktopAppAction<string>) => void;

function Probe() {
	const revision = useRef(0);
	const [state, dispatch] = useReducer(
		desktopAppReducer<string>,
		createDesktopAppState("draft-0", "General", "local"),
	);
	dispatchApp = dispatch;
	const [environment, setEnvironment] =
		useState<RemoteWorkspaceEnvironment | null>(null);
	useRemoteEnvironmentBootstrap(
		revision,
		useCallback(
			(remote: RemoteWorkspaceEnvironment | null, isFirstLoad: boolean) => {
				setEnvironment(remote);
				if (isFirstLoad && remote) {
					dispatch({
						type: "select-environment-draft",
						threadId: `draft-${++nextDraft}`,
						environmentId: remote.id,
					});
				}
			},
			[],
		),
	);
	return (
		<span>{`${environment?.id ?? "local"}:${state.navigation.current.activeThreadId}`}</span>
	);
}

function render(mode: "visible" | "hidden") {
	return act(async () =>
		root.render(
			<Activity mode={mode}>
				<Probe />
			</Activity>,
		),
	);
}

it("keeps an open remote conversation when the app is shown again", async () => {
	invoke.mockResolvedValue({
		remoteEnvironment: { id: "ssh-1" },
		homeDir: "/home/me",
	});
	await render("visible");
	expect(container.textContent).toBe("ssh-1:draft-1");
	act(() =>
		dispatchApp({
			type: "thread-started",
			threadId: "draft-1",
			sessionId: "session-1",
		}),
	);

	await render("hidden");
	await render("visible");

	expect(invoke).toHaveBeenCalledTimes(2);
	expect(container.textContent).toBe("ssh-1:draft-1");
});

it("bootstraps navigation on the first load that succeeds", async () => {
	invoke.mockRejectedValueOnce(new Error("Hub starting")).mockResolvedValue({
		remoteEnvironment: { id: "ssh-1" },
		homeDir: "/home/me",
	});
	await render("visible");
	expect(container.textContent).toBe("local:draft-0");

	await render("hidden");
	await render("visible");

	expect(container.textContent).toBe("ssh-1:draft-1");
});
