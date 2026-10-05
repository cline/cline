import { describe, expect, it } from "bun:test";
import type { HubEventEnvelope } from "@cline/shared";
import {
	approvalSummary,
	PetStateProjector,
	TRANSIENT_MS,
	toolLabel,
} from "./state";

const ev = (
	event: string,
	sessionId: string | undefined,
	payload: Record<string, unknown> = {},
) =>
	({ version: "v1", event, sessionId, payload }) as unknown as HubEventEnvelope;

function setup() {
	let now = 1_000;
	const p = new PetStateProjector(() => now);
	p.setHubOnline(true);
	return { p, advance: (ms: number) => (now += ms) };
}

describe("labels", () => {
	it("shows the command for bash-like tools", () => {
		expect(toolLabel("run_commands", { commands: ["bun test --watch"] })).toBe(
			"bun test --watch",
		);
		expect(toolLabel("editor", { path: "a.ts" })).toBe("editor");
		expect(
			approvalSummary("bash", JSON.stringify({ command: "bun test" })),
		).toBe("Run: bun test");
		expect(
			approvalSummary("editor", JSON.stringify({ path: "src/a.ts" })),
		).toBe("editor: src/a.ts");
	});
	it("clips long labels", () => {
		expect(toolLabel("bash", { command: "x".repeat(100) })).toHaveLength(24);
	});
});

describe("PetStateProjector", () => {
	it("is offline until the hub connects", () => {
		const p = new PetStateProjector();
		expect(p.snapshot().state).toBe("offline");
	});

	it("goes idle → working → done → idle", () => {
		const { p, advance } = setup();
		expect(p.snapshot().state).toBe("idle");
		p.apply(ev("run.started", "s1"));
		p.apply(ev("tool.started", "s1", { toolName: "editor" }));
		expect(p.snapshot()).toMatchObject({
			state: "working",
			tool: "editor",
			session: "s1",
		});
		p.apply(ev("tool.finished", "s1", { toolName: "editor" }));
		expect(p.snapshot().tool).toBeUndefined();
		p.apply(ev("assistant.finished", "s1", { text: "Done.\nAll tests pass." }));
		p.apply(ev("run.completed", "s1", { reason: "completed" }));
		expect(p.snapshot()).toMatchObject({
			state: "done",
			reply: "All tests pass.",
		});
		advance(TRANSIENT_MS + 1);
		expect(p.snapshot().state).toBe("idle");
		expect(p.stats()).toEqual({ sessions: 0, today: 1 });
	});

	it("prioritises approvals and clears them on resolve", () => {
		const { p } = setup();
		p.apply(ev("run.started", "s1"));
		p.apply(
			ev("approval.requested", "s1", {
				approvalId: "a1",
				sessionId: "s1",
				toolName: "bash",
				inputJson: JSON.stringify({ command: "rm -rf dist" }),
			}),
		);
		expect(p.snapshot()).toMatchObject({
			state: "waiting",
			approval: { id: "a1", summary: "Run: rm -rf dist" },
		});
		p.apply(
			ev("approval.resolved", "s1", { approvalId: "a1", approved: true }),
		);
		expect(p.snapshot().state).toBe("working");
	});

	it("reports failures with an error label", () => {
		const { p } = setup();
		p.apply(ev("run.started", "s1"));
		p.apply(ev("run.failed", "s1", { reason: "error", error: "exit code 1" }));
		expect(p.snapshot()).toMatchObject({ state: "error", err: "exit code 1" });
	});

	it("voice overlay beats working but not approvals", () => {
		const { p } = setup();
		p.apply(ev("run.started", "s1"));
		p.setVoice({ phase: "listening" });
		expect(p.snapshot().state).toBe("listening");
		p.setVoice({ phase: "thinking", transcript: "fix it" });
		expect(p.snapshot()).toMatchObject({
			state: "thinking",
			transcript: "fix it",
		});
		p.apply(
			ev("approval.requested", "s1", { approvalId: "a", toolName: "bash" }),
		);
		expect(p.snapshot().state).toBe("waiting");
	});

	it("picks the most recently active running session", () => {
		const { p, advance } = setup();
		p.apply(ev("run.started", "s1"));
		advance(10);
		p.apply(ev("run.started", "s2"));
		expect(p.activeSessionId()).toBe("s2");
		p.apply(ev("run.completed", "s2"));
		expect(p.activeSessionId()).toBe("s1");
	});

	it("drops runs and approvals when the hub goes away", () => {
		const { p } = setup();
		p.apply(ev("run.started", "s1"));
		p.apply(
			ev("approval.requested", "s1", { approvalId: "a", toolName: "bash" }),
		);
		p.setHubOnline(false);
		expect(p.snapshot().state).toBe("offline");
		p.setHubOnline(true);
		expect(p.snapshot().state).toBe("idle");
	});
});

describe("voice thinking", () => {
	it("stays thinking after submit until the target session's turn starts", () => {
		const { p, advance } = setup();
		p.setVoice({ phase: "thinking", transcript: "hi", awaitingSession: "s9" });
		p.apply(ev("run.started", "other"));
		expect(p.snapshot().state).toBe("thinking");
		advance(10);
		p.apply(ev("run.started", "s9"));
		expect(p.snapshot()).toMatchObject({ state: "working", session: "s9" });
	});
});

describe("recent workspace", () => {
	it("tracks the workspace of the newest session event", () => {
		const { p, advance } = setup();
		expect(p.recentWorkspace()).toBeUndefined();
		p.apply(ev("session.created", "s1", { session: { workspaceRoot: "/a" } }));
		advance(5);
		p.apply(
			ev("session.updated", "s2", {
				session: { workspaceRoot: "/b", cwd: "/b/pkg" },
			}),
		);
		expect(p.recentWorkspace()).toBe("/b/pkg");
	});
});

describe("turn end without run.completed", () => {
	const status = (sid: string, s: string) =>
		ev("session.updated", sid, { session: { workspaceRoot: "/w", status: s } });

	it("settles on agent.done + session idle (queued delivery, captured from the hub)", () => {
		const { p, advance } = setup();
		p.apply(ev("run.started", "s1"));
		p.apply(status("s1", "running"));
		p.apply(ev("iteration.started", "s1"));
		expect(p.snapshot().state).toBe("working");
		p.apply(ev("assistant.finished", "s1", { text: "hi" }));
		p.apply(ev("iteration.finished", "s1"));
		p.apply(ev("agent.done", "s1", { reason: "completed", text: "hi" }));
		expect(p.snapshot()).toMatchObject({ state: "done", reply: "hi" });
		p.apply(status("s1", "idle"));
		expect(p.snapshot()).toMatchObject({ state: "done", reply: "hi" });
		advance(TRANSIENT_MS + 1);
		expect(p.snapshot().state).toBe("idle");
	});

	it("settles on session idle alone", () => {
		const { p } = setup();
		p.apply(status("s1", "running"));
		expect(p.snapshot().state).toBe("working");
		p.apply(status("s1", "idle"));
		expect(p.snapshot().state).toBe("done");
	});

	it("keeps the reply when run.completed follows agent.done", () => {
		const { p } = setup();
		p.apply(ev("run.started", "s1"));
		p.apply(
			ev("agent.done", "s1", { reason: "completed", text: "All green." }),
		);
		p.apply(status("s1", "idle"));
		p.apply(ev("run.completed", "s1", { reason: "completed" }));
		expect(p.snapshot()).toMatchObject({ state: "done", reply: "All green." });
	});

	it("maps a failed session status to error and ignores team sub-agents", () => {
		const { p } = setup();
		p.apply(ev("run.started", "s1"));
		p.apply(ev("agent.done", "s1", { reason: "completed", teamAgentId: "a2" }));
		expect(p.snapshot().state).toBe("working");
		p.apply(status("s1", "failed"));
		expect(p.snapshot()).toMatchObject({ state: "error", err: "failed" });
	});

	it("an idle session that never ran stays idle", () => {
		const { p } = setup();
		p.apply(status("s1", "idle"));
		expect(p.snapshot().state).toBe("idle");
	});
});
