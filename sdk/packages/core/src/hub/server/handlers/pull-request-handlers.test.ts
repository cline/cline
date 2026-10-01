import type { HubCommandEnvelope } from "@cline/shared";
import { beforeEach, expect, it, vi } from "vitest";
import type { HubTransportContext } from "./context";
import { handleSessionPullRequestStatus } from "./pull-request-handlers";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../../services/workspace/pull-request", () => ({
	createPullRequestStatusReader: (options: {
		probeAuthentication: boolean;
	}) => {
		expect(options.probeAuthentication).toBe(false);
		return read;
	},
}));
const getSession = vi.fn();
const ctx = { sessionHost: { getSession } } as unknown as HubTransportContext;
const command: HubCommandEnvelope = {
	version: "v1",
	command: "session.pull_request_status",
	requestId: "request-1",
	payload: { sessionId: "session-1" },
};
beforeEach(() => {
	read.mockReset().mockResolvedValue(null);
	getSession
		.mockReset()
		.mockResolvedValue({ cwd: "/stored/worktree", workspaceRoot: "/stored" });
});

it("reads only the stored session workspace and preserves the desktop result", async () => {
	const status = {
		repository: "owner/repo",
		branch: "feature/actual",
		createUrl: "https://github.com/owner/repo/compare/main...feature/actual",
		pullRequest: null,
	};
	read.mockResolvedValue(status);
	expect(await handleSessionPullRequestStatus(ctx, command)).toMatchObject({
		ok: true,
		requestId: "request-1",
		payload: { sessionId: "session-1", status },
	});
	expect(getSession).toHaveBeenCalledWith("session-1");
	expect(read).toHaveBeenCalledWith("/stored/worktree");
	getSession.mockResolvedValue({ workspaceRoot: "/stored/root" });
	read.mockResolvedValue(null);
	expect(await handleSessionPullRequestStatus(ctx, command)).toMatchObject({
		ok: true,
		payload: { status: null },
	});
	expect(read).toHaveBeenLastCalledWith("/stored/root");
});

it.each([
	{},
	{ sessionId: "session-1", cwd: "/override" },
	{ sessionId: "session-1", branch: "main" },
	{ sessionId: "session-1", repository: "other/repo" },
	{ sessionId: "session-1", command: "echo override" },
])("rejects missing identity or caller execution scope: %j", async (payload) => {
	expect(
		await handleSessionPullRequestStatus(ctx, { ...command, payload }),
	).toMatchObject({ ok: false, error: { code: "invalid_request" } });
	expect(getSession).not.toHaveBeenCalled();
	expect(read).not.toHaveBeenCalled();
});

it("rejects unknown or workspace-less sessions without running commands", async () => {
	getSession.mockResolvedValue(undefined);
	expect(await handleSessionPullRequestStatus(ctx, command)).toMatchObject({
		ok: false,
		error: { code: "session_not_found" },
	});
	getSession.mockResolvedValue({});
	expect(await handleSessionPullRequestStatus(ctx, command)).toMatchObject({
		ok: false,
		error: { code: "workspace_unavailable" },
	});
	expect(read).not.toHaveBeenCalled();
});

it("does not send process stderr or credentials to the client", async () => {
	read.mockRejectedValue(new Error("private process stderr"));
	const reply = await handleSessionPullRequestStatus(ctx, command);
	expect(reply).toMatchObject({
		ok: false,
		error: { code: "pull_request_status_unavailable" },
	});
	expect(JSON.stringify(reply)).not.toContain("private process stderr");
});
