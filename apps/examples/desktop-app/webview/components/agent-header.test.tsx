// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentHeader } from "@/components/agent-header";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("AgentHeader title bar", () => {
	it("makes non-interactive header space draggable", async () => {
		await act(async () => {
			root.render(<AgentHeader status="completed" title="A session" />);
		});

		expect(
			container.querySelector("header")?.getAttribute("data-tauri-drag-region"),
		).toBe("deep");
	});

	it("renders a read-only title as draggable text", async () => {
		await act(async () => {
			root.render(<AgentHeader status="completed" title="Read-only session" />);
		});

		expect(
			container.querySelector('span[title="Read-only session"]'),
		).not.toBeNull();
		expect(
			container.querySelector('button[title="Read-only session"]'),
		).toBeNull();
	});
});

describe("AgentHeader title editor", () => {
	it("preserves the displayed title width when editing starts", async () => {
		await act(async () => {
			root.render(
				<AgentHeader
					canEditTitle
					onRenameTitle={vi.fn()}
					status="completed"
					title="A title wide enough to expose resizing"
				/>,
			);
		});

		const titleButton = container.querySelector<HTMLButtonElement>(
			'button[title="A title wide enough to expose resizing"]',
		);
		expect(container.querySelector("header")?.className).toContain(
			"max-md:pl-28",
		);
		expect(container.querySelector("header")?.className).toContain(
			"max-md:h-7",
		);
		expect(container.querySelector("header")?.className).toContain(
			"md:group-data-[state=collapsed]/sidebar-wrapper:pl-7",
		);
		expect(titleButton).not.toBeNull();
		vi.spyOn(
			titleButton as HTMLButtonElement,
			"getBoundingClientRect",
		).mockReturnValue({
			width: 318,
		} as DOMRect);

		await act(async () => {
			titleButton?.click();
		});

		const titleForm = container.querySelector("form");
		const titleInput = container.querySelector<HTMLInputElement>("input");
		expect(titleForm?.style.width).toBe("318px");
		expect(titleInput?.className).toContain("w-full");
		expect(titleInput?.className).not.toContain("w-64");
	});
});

describe("AgentHeader agent activity", () => {
	const renderHeader = async (
		agentActivity?: Parameters<typeof AgentHeader>[0]["agentActivity"],
		diff?: Parameters<typeof AgentHeader>[0]["diff"],
	) => {
		await act(async () => {
			root.render(
				<AgentHeader
					agentActivity={agentActivity}
					diff={diff}
					status="running"
					title="S"
				/>,
			);
		});
		return container.querySelector("#agent-activity");
	};

	it("stays hidden when the session spawned no agents", async () => {
		expect(await renderHeader(undefined)).toBeNull();
		expect(
			await renderHeader({
				total: 0,
				running: 0,
				completed: 0,
				failed: 0,
				cancelled: 0,
				unresolved: 0,
			}),
		).toBeNull();
	});

	it("shows the total with a per-state breakdown beside the diff stats", async () => {
		// The diff button only renders once there are additions, so give it some
		// to assert the pill's placement relative to it.
		const activity = await renderHeader(
			{
				total: 5,
				running: 1,
				completed: 2,
				failed: 1,
				cancelled: 1,
				unresolved: 0,
			},
			{ additions: 3, deletions: 1 },
		);
		expect(activity).not.toBeNull();
		expect(activity?.getAttribute("aria-label")).toBe(
			"5 agents: 1 running, 2 completed, 1 failed, 1 cancelled",
		);
		// total, running, completed, failed, stalled
		expect(activity?.textContent).toBe("51211");

		const diffStats = container.querySelector("#diff-stats");
		expect(diffStats).not.toBeNull();
		// The pill sits immediately before the diff button in the actions row.
		expect(activity?.nextElementSibling).toBe(diffStats);
	});

	it("still shows agents when there is no diff to show", async () => {
		// The diff button hides itself at zero additions; the agent pill is
		// independent of it and must not disappear along with it.
		const activity = await renderHeader({
			total: 1,
			running: 1,
			completed: 0,
			failed: 0,
			cancelled: 0,
			unresolved: 0,
		});
		expect(activity).not.toBeNull();
		expect(container.querySelector("#diff-stats")).toBeNull();
	});

	it("omits empty buckets and folds cancelled into the stalled count", async () => {
		const activity = await renderHeader({
			total: 3,
			running: 0,
			completed: 2,
			failed: 0,
			cancelled: 1,
			unresolved: 0,
		});
		expect(activity?.textContent).toBe("321");
		expect(activity?.querySelector(".animate-spin")).toBeNull();
	});

	it("spins only while an agent is running", async () => {
		const running = await renderHeader({
			total: 1,
			running: 1,
			completed: 0,
			failed: 0,
			cancelled: 0,
			unresolved: 0,
		});
		expect(running?.querySelector(".animate-spin")).not.toBeNull();
	});
});

describe("AgentHeader agent roster popover", () => {
	const ACTIVITY = {
		total: 2,
		running: 1,
		completed: 1,
		failed: 0,
		cancelled: 0,
		unresolved: 0,
	};

	const AGENTS: Parameters<typeof AgentHeader>[0]["agents"] = [
		{
			sessionId: "root__reviewer",
			agentId: "agent_1784837087669_01o5io",
			kind: "subagent",
			status: "completed",
			prompt: "Review the diff for regressions",
			lastAction: "Running read_files",
			startedAt: "2026-07-27T00:00:00.000Z",
			hasMessages: true,
		},
		{
			sessionId: "root__builder",
			agentId: "agent_1784837162352_mmz797",
			kind: "teamtask",
			teamName: "platform",
			status: "running",
			prompt: "Port the migration to the new schema",
			startedAt: "2026-07-27T00:01:00.000Z",
			hasMessages: false,
		},
	];

	// Radix portals its popover content, so queries run against document.
	const openPanel = async () => {
		const trigger =
			container.querySelector<HTMLButtonElement>("#agent-activity");
		await act(async () => {
			trigger?.click();
		});
		return document.querySelector("#agent-activity-panel");
	};

	const renderHeader = async (
		props: Partial<Parameters<typeof AgentHeader>[0]> = {},
	) => {
		await act(async () => {
			root.render(
				<AgentHeader
					agentActivity={ACTIVITY}
					agents={AGENTS}
					status="running"
					title="S"
					{...props}
				/>,
			);
		});
	};

	it("identifies each agent by its task, not its generated id", async () => {
		await renderHeader();
		const panel = await openPanel();
		const text = panel?.textContent ?? "";
		expect(text).toContain("Review the diff for regressions");
		expect(text).toContain("Port the migration to the new schema");
		expect(text).not.toContain("agent_1784837087669_01o5io");
		expect(text).not.toContain("agent_1784837162352_mmz797");
	});

	it("shows the last action as the second line", async () => {
		await renderHeader();
		const panel = await openPanel();
		expect(panel?.textContent).toContain("Running read_files");
	});

	it("says a running agent is starting up when it has done nothing yet", async () => {
		await renderHeader();
		const panel = await openPanel();
		expect(panel?.textContent).toContain("Starting up...");
	});

	it("notes a finished agent that recorded no activity", async () => {
		await renderHeader({
			agents: [
				{
					sessionId: "root__quiet",
					agentId: "quiet",
					kind: "subagent",
					status: "failed",
					prompt: "Do a thing",
					startedAt: "2026-07-27T00:00:00.000Z",
					hasMessages: false,
				},
			],
		});
		const panel = await openPanel();
		expect(panel?.textContent).toContain("No activity recorded (failed)");
	});

	it("labels a team-task agent with its team", async () => {
		await renderHeader();
		const panel = await openPanel();
		expect(panel?.textContent).toContain("team platform");
	});

	it("spins the row of a running agent only", async () => {
		await renderHeader();
		const panel = await openPanel();
		const rows = panel?.querySelectorAll("li") ?? [];
		expect(rows.length).toBe(2);
		expect(rows[0]?.querySelector(".animate-spin")).toBeNull();
		expect(rows[1]?.querySelector(".animate-spin")).not.toBeNull();
	});

	it("opens the agent's own session when its row is selected", async () => {
		const onOpenAgentSession = vi.fn();
		await renderHeader({ onOpenAgentSession });
		const panel = await openPanel();
		await act(async () => {
			panel?.querySelector<HTMLButtonElement>("li button")?.click();
		});
		expect(onOpenAgentSession).toHaveBeenCalledWith("root__reviewer");
	});

	it("dismisses the popover once an agent session is opened", async () => {
		await renderHeader({ onOpenAgentSession: vi.fn() });
		const panel = await openPanel();
		await act(async () => {
			panel?.querySelector<HTMLButtonElement>("li button")?.click();
		});
		expect(document.querySelector("#agent-activity-panel")).toBeNull();
	});

	it("constrains a long prompt to the popover instead of overflowing it", async () => {
		await renderHeader({
			agents: [
				{
					sessionId: "root__long",
					agentId: "long",
					kind: "subagent",
					status: "completed",
					prompt:
						"In /Users/beatrix/dev/clinee/apps/examples/desktop-app, investigate the triggers, algorithm/data flow, persistence/state behavior, provider wiring and everything else",
					lastAction: "Running read_files",
					startedAt: "2026-07-27T00:00:00.000Z",
					hasMessages: true,
				},
			],
		});
		const panel = await openPanel();
		// Radix's ScrollArea viewport sizes to max-content, which is what pushed
		// long prompts past the edge; the roster must use a plain scroller.
		expect(panel?.querySelector("[data-slot='scroll-area']")).toBeNull();
		expect(panel?.querySelector(".overflow-y-auto")).not.toBeNull();
		const prompt = panel?.querySelector("li span span");
		expect(prompt?.className).toContain("line-clamp-2");
		expect(prompt?.className).toContain("wrap-break-word");
	});

	it("notifies the host when the panel opens so the roster can be fetched", async () => {
		const onAgentsOpenChange = vi.fn();
		await renderHeader({ onAgentsOpenChange });
		await openPanel();
		expect(onAgentsOpenChange).toHaveBeenCalledWith(true);
	});

	it("shows a loading state while the roster is still being fetched", async () => {
		await renderHeader({ agents: [], agentsLoading: true });
		const panel = await openPanel();
		expect(panel?.textContent).toContain("Loading agents...");
	});

	it("says the list is stale when a refresh failed but agents remain", async () => {
		await renderHeader({ agentsError: "database is locked" });
		const panel = await openPanel();
		// The rows are kept, so the failure has to be stated or they read as fresh.
		expect(panel?.textContent).toContain("Review the diff for regressions");
		const stale = panel?.querySelector("#agent-roster-stale");
		expect(stale?.textContent).toContain("showing the last known agents");
		expect(stale?.textContent).toContain("database is locked");
	});

	it("shows no staleness note when the roster loaded cleanly", async () => {
		await renderHeader();
		const panel = await openPanel();
		expect(panel?.querySelector("#agent-roster-stale")).toBeNull();
	});

	it("explains an empty roster while agents are still starting up", async () => {
		await renderHeader({ agents: [], agentsLoading: false });
		const panel = await openPanel();
		expect(panel?.textContent).toContain("Waiting for the first agent");
	});
});

describe("AgentHeader subagent session badge", () => {
	const renderHeader = async (
		props: Partial<Parameters<typeof AgentHeader>[0]> = {},
	) => {
		await act(async () => {
			root.render(
				<AgentHeader status="completed" title="Child run" {...props} />,
			);
		});
		return container.querySelector<HTMLButtonElement>(
			"#subagent-session-badge",
		);
	};

	const newSessionButton = () =>
		container.querySelector<HTMLButtonElement>(
			'button[aria-label="New session"]',
		);

	it("stays hidden for an ordinary session, which keeps its new-session button", async () => {
		expect(await renderHeader()).toBeNull();
		expect(newSessionButton()).not.toBeNull();
	});

	it("replaces the new-session button on a child agent run", async () => {
		const badge = await renderHeader({
			parentSession: { sessionId: "root1", title: "Refactor the parser" },
			onOpenParentSession: vi.fn(),
		});
		expect(badge).not.toBeNull();
		// "New session" is a top-level action; a nested run offers the way back.
		expect(newSessionButton()).toBeNull();
	});

	it("sits in the header actions group on the right", async () => {
		const badge = await renderHeader({
			parentSession: { sessionId: "root1" },
			onOpenParentSession: vi.fn(),
		});
		const actionsGroup = badge?.parentElement;
		const titleGroup = container.querySelector("header")?.firstElementChild;
		expect(actionsGroup).not.toBe(titleGroup);
		// It is the trailing control of the actions group.
		expect(actionsGroup?.lastElementChild).toBe(badge);
	});

	it("reads as the main agent session rather than naming the child", async () => {
		const badge = await renderHeader({
			parentSession: { sessionId: "root1", title: "Refactor the parser" },
			onOpenParentSession: vi.fn(),
		});
		expect(badge?.textContent).toBe("Main Agent Session");
		expect(badge?.textContent).not.toContain("Subagent of");
	});

	it("keeps the parent title in the tooltip for context", async () => {
		const badge = await renderHeader({
			parentSession: { sessionId: "root1", title: "Refactor the parser" },
			onOpenParentSession: vi.fn(),
		});
		expect(badge?.getAttribute("title")).toBe(
			"Back to the main agent session: Refactor the parser",
		);
		expect(badge?.getAttribute("aria-label")).toBe(
			"Back to the main agent session: Refactor the parser",
		);
	});

	it("still labels itself when the parent title is unknown", async () => {
		const badge = await renderHeader({
			parentSession: { sessionId: "root1" },
			onOpenParentSession: vi.fn(),
		});
		expect(badge?.textContent).toBe("Main Agent Session");
		expect(badge?.getAttribute("title")).toBe("Back to the main agent session");
	});

	it("opens the parent session when clicked", async () => {
		const onOpenParentSession = vi.fn();
		const badge = await renderHeader({
			parentSession: { sessionId: "root1", title: "Parent" },
			onOpenParentSession,
		});
		await act(async () => {
			badge?.click();
		});
		expect(onOpenParentSession).toHaveBeenCalledWith("root1");
	});

	it("is inert when the host cannot navigate", async () => {
		const badge = await renderHeader({
			parentSession: { sessionId: "root1", title: "Parent" },
		});
		expect(badge?.disabled).toBe(true);
	});

	it("coexists with the agent pill and diff stats", async () => {
		const badge = await renderHeader({
			parentSession: { sessionId: "root1" },
			onOpenParentSession: vi.fn(),
			agentActivity: {
				total: 1,
				running: 0,
				completed: 1,
				failed: 0,
				cancelled: 0,
				unresolved: 0,
			},
			diff: { additions: 2, deletions: 1 },
		});
		expect(badge).not.toBeNull();
		expect(container.querySelector("#agent-activity")).not.toBeNull();
		expect(container.querySelector("#diff-stats")).not.toBeNull();
	});
});
