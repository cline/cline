import { act } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
import type { ConnectionDescriptor } from "@/connection";
import { asRemoteSessionId, type RemoteSession } from "@/session";
import { render } from "@/ui/__testing__/render";
import { useSessionHistory } from "./useSessionHistory";

const data = vi.hoisted(() => ({
	scope: undefined as { organizationId?: string } | undefined,
	endpoints: [] as ConnectionDescriptor[],
	sessions: [] as RemoteSession[],
}));
vi.mock("@/state/cloud-auth", () => ({
	useCloudAccountScope: () => ({ scope: data.scope }),
}));
vi.mock("@/state/endpoints", () => ({
	useEndpoints: () => ({ endpoints: data.endpoints }),
}));
vi.mock("@/state/execution-targets", () => ({
	useExecutionTargets: () => ({ cloudTargets: [] }),
}));
vi.mock("@/state/last-opened", () => ({
	useLastOpened: () => ({ lastOpened: {} }),
}));
vi.mock("@/connection/use-cloud-session-statuses", () => ({
	useCloudSessionStatuses: () => ({}),
	useUnreadCloudSessions: () => new Set(),
}));
vi.mock("./local-sessions", () => ({
	useLocalSessions: () => ({ sessions: [] }),
}));
vi.mock("./cloud-sessions", () => ({
	useCloudSessions: () => ({
		state: { phase: "ready", sessions: data.sessions },
	}),
	getCloudSessions: (state: { sessions: RemoteSession[] }) => state.sessions,
}));

function remote(id: string, organizationId?: string): RemoteSession {
	return {
		id: asRemoteSessionId(id),
		sandboxUrl: `https://${id}.test/hub`,
		status: "running",
		expiredAt: null,
		title: id,
		...(organizationId ? { organizationId } : {}),
	};
}
let history: ReturnType<typeof useSessionHistory>;
function Harness() {
	history = useSessionHistory({ openVerificationUrl: () => false });
	return null;
}
const titles = () => history.rows.map((row) => row.title);
beforeEach(() => {
	data.scope = {};
	data.sessions = [
		remote("personal"),
		remote("team-a", "org-a"),
		remote("team-b", "org-b"),
	];
	data.endpoints = data.sessions.map((session) => ({
		mode: "cloud",
		url: session.sandboxUrl,
		remoteSessionId: session.id,
		sessionTitle: session.title,
		...(session.organizationId
			? { organizationId: session.organizationId }
			: {}),
	}));
});

it("renders only the selected account even while the cached hook result still contains every account", () => {
	const screen = render(<Harness />);
	expect(titles()).toEqual(["personal"]);
	act(() => {
		data.scope = { organizationId: "org-a" };
		screen.renderer.update(<Harness />);
	});
	expect(titles()).toEqual(["team-a"]);
	act(() => {
		data.scope = { organizationId: "org-b" };
		screen.renderer.update(<Harness />);
	});
	expect(titles()).toEqual(["team-b"]);
	act(() => {
		data.scope = {};
		screen.renderer.update(<Harness />);
	});
	expect(titles()).toEqual(["personal"]);
	// History filtering must not remove saved routes for already-open chats.
	expect(data.endpoints).toHaveLength(3);
});

it("hides old cloud rows immediately when the selected account has no returned sessions", () => {
	const screen = render(<Harness />);
	act(() => {
		data.scope = { organizationId: "org-empty" };
		screen.renderer.update(<Harness />);
	});
	expect(titles()).toEqual([]);
});

it("waits for a known account without hiding unrelated local computers", () => {
	data.scope = undefined;
	data.endpoints = [
		...data.endpoints,
		{ mode: "local", url: "ws://local.test/hub", label: "My computer" },
	];
	render(<Harness />);
	expect(titles()).toEqual(["My computer"]);
});
