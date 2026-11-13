// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	FactoryLiveActivity,
	FactoryLiveEntry,
} from "@/hooks/use-factory-live-activity";
import type { ChatMessage } from "@/lib/chat-schema";
import type { FactoryLiveSession } from "./factory-live";
import {
	FactoryAgentLanes,
	FactoryLiveTranscript,
	factoryAgentLanes,
} from "./factory-live-transcript";

CSSStyleSheet.prototype.replaceSync ??= function replaceSync() {} as never;

const mocks = vi.hoisted(() => {
	const listeners = new Map<string, Set<(payload: unknown) => void>>();
	return {
		listeners,
		invoke: vi.fn(),
		subscribe: vi.fn((event: string, listener: (payload: unknown) => void) => {
			const set = listeners.get(event) ?? new Set();
			set.add(listener);
			listeners.set(event, set);
			return () => set.delete(listener);
		}),
		subscribeTransportState: vi.fn(() => () => {}),
	};
});
vi.mock("@/lib/desktop-client", () => ({ desktopClient: mocks }));

const transcripts: Record<string, ChatMessage[]> = {
	"designer-1": [
		{
			id: "d-user",
			sessionId: "designer-1",
			role: "user",
			content: "Scope the export feature",
			createdAt: 1,
			meta: {
				runCount: 1,
				checkpoint: { ref: "ref", createdAt: 1, runCount: 1 },
			},
		},
		{
			id: "d-answer",
			sessionId: "designer-1",
			role: "assistant",
			content: "Here is the plan",
			createdAt: 2,
		},
	],
	"builder-1": [
		{
			id: "b-answer",
			sessionId: "builder-1",
			role: "assistant",
			content: "Editing the exporter",
			createdAt: 3,
		},
	],
};

const sessions: FactoryLiveSession[] = [
	{ sessionId: "designer-1", role: "designer" },
	{ sessionId: "builder-1", role: "builder" },
];

const activityWith = (
	entries: Record<string, Partial<FactoryLiveEntry>>,
	connected = true,
): FactoryLiveActivity => ({
	connected,
	sessions: new Map(
		Object.entries(entries).map(([id, entry]) => [
			id,
			{ at: 1, ended: false, ...entry },
		]),
	),
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	mocks.listeners.clear();
	mocks.invoke.mockReset();
	mocks.invoke.mockImplementation(async (_command: string, args: unknown) => {
		const sessionId = (args as { sessionId: string }).sessionId;
		const messages = transcripts[sessionId];
		if (!messages) throw new Error("Session not found");
		return messages;
	});
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	HTMLElement.prototype.scrollTo = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const render = (props: Parameters<typeof FactoryLiveTranscript>[0]) =>
	act(async () => root.render(<FactoryLiveTranscript {...props} />));
const button = (name: string) =>
	[...container.querySelectorAll("button")].find(
		(candidate) => candidate.textContent === name,
	);
const stateLine = () =>
	container.querySelector('[data-testid="factory-live-transcript-state"]')
		?.textContent;

it("shows the most recently active session read-only in a labelled region", async () => {
	await render({
		sessions,
		activity: activityWith({
			"designer-1": { at: 5, ended: true },
			"builder-1": { at: 3 },
		}),
	});
	const region = container.querySelector("section");
	expect(region?.getAttribute("aria-label")).toBe("Builder conversation");
	expect(container.textContent).toContain("Editing the exporter");
	expect(stateLine()).toBe("Live · Builder");
	// No live region over the transcript itself.
	expect(container.querySelector('[aria-live="polite"]')).toBeNull();
	expect(button("Builder")?.getAttribute("aria-pressed")).toBe("true");
});

it("switches roles and keeps the transcript read-only", async () => {
	await render({
		sessions,
		activity: activityWith({ "designer-1": { ended: true } }),
	});
	await act(async () => button("Scoping agent")?.click());
	expect(button("Scoping agent")?.getAttribute("aria-pressed")).toBe("true");
	// The chosen lane is drawn apart from the others, not only on hover.
	expect(button("Scoping agent")?.className).not.toBe(
		button("Builder")?.className,
	);
	expect(container.textContent).toContain("Here is the plan");
	expect(container.textContent).not.toContain("Editing the exporter");
	expect(stateLine()).toBe("Scoping agent finished");
	expect(
		container.querySelector('button[aria-label="Restore checkpoint"]'),
	).toBeNull();
	expect(
		container.querySelector('button[aria-label="Edit user message"]'),
	).toBeNull();
	expect(
		container.querySelector('button[aria-label="Fork session"]'),
	).toBeNull();
});

it("hides the switcher for a single session and opens it in chat", async () => {
	const onOpenInChat = vi.fn();
	await render({ sessions: [sessions[1] as FactoryLiveSession], onOpenInChat });
	expect(container.querySelector("fieldset")).toBeNull();
	// It opens in the app, so it carries no outside-link arrow.
	expect(button("Open in chat")?.querySelector("svg")).toBeNull();
	await act(async () => button("Open in chat")?.click());
	expect(onOpenInChat).toHaveBeenCalledWith("builder-1");
});

it("numbers repeated roles and says when a session is gone", async () => {
	await render({
		sessions: [
			{ sessionId: "checker-a", role: "plan_reviewer" },
			{ sessionId: "checker-b", role: "plan_reviewer" },
		],
	});
	expect(button("Plan checker 1")).toBeDefined();
	expect(button("Plan checker 2")?.getAttribute("aria-pressed")).toBe("true");
	expect(stateLine()).toBe("This session is no longer available.");
});

it("says when updates are paused for a reconnect", async () => {
	await render({
		sessions: [sessions[1] as FactoryLiveSession],
		activity: activityWith({ "builder-1": {} }, false),
	});
	expect(stateLine()).toBe("Reconnecting, updates paused");
});

it("renders compactly: no minimap, and the engine's opening prompt folded", async () => {
	await render({
		sessions,
		activity: activityWith({ "designer-1": { ended: true } }),
	});
	await act(async () => button("Scoping agent")?.click());
	// The task prompt is folded; the agent's answer shows.
	expect(container.textContent).toContain("Here is the plan");
	expect(container.textContent).not.toContain("Scope the export feature");
	expect(
		container.querySelector('nav[aria-label="Transcript outline"]'),
	).toBeNull();
	const toggle = button("Show the instructions this agent was given");
	expect(toggle?.getAttribute("aria-expanded")).toBe("false");
	await act(async () => toggle?.click());
	expect(container.textContent).toContain("Scope the export feature");
	expect(button("Hide the instructions")?.getAttribute("aria-expanded")).toBe(
		"true",
	);
	// The bubble uses the panel's full width in a narrow panel.
	const bubble = [...container.querySelectorAll('[data-role="user"] > *')].find(
		(node) => node.textContent?.includes("Scope the export feature"),
	);
	expect(bubble?.className).toContain("max-w-full");
});

it("does not fold a transcript that opens with the agent", async () => {
	await render({ sessions: [sessions[1] as FactoryLiveSession] });
	expect(container.textContent).toContain("Editing the exporter");
	expect(button("Show the instructions this agent was given")).toBeUndefined();
});

describe("FactoryAgentLanes", () => {
	const lanes = () =>
		[...container.querySelectorAll('[data-testid="factory-agent-lane"]')].map(
			(lane) => ({
				text: lane.textContent,
				running: lane.hasAttribute("data-running"),
				pressed: lane.getAttribute("aria-pressed"),
			}),
		);
	const renderLanes = (props: Parameters<typeof FactoryAgentLanes>[0]) =>
		act(async () => root.render(<FactoryAgentLanes {...props} />));

	it("lists running lanes first with role, model, activity and elapsed time", async () => {
		const startedAt = new Date(Date.now() - 125_000).toISOString();
		await renderLanes({
			sessions: [
				{
					sessionId: "designer-1",
					role: "designer",
					startedAt: "2026-01-01T00:00:00Z",
					endedAt: "2026-01-01T00:04:00Z",
				},
				{
					sessionId: "builder-1",
					role: "builder",
					startedAt,
					model: "anthropic/claude-x",
				},
			],
			runningIds: new Set(["builder-1"]),
			activity: activityWith({
				"builder-1": { lastTool: "Reading src/export.ts", at: Date.now() },
			}),
		});
		const [first, second] = lanes();
		expect(first?.running).toBe(true);
		expect(first?.text).toContain("Builder");
		expect(first?.text).toContain("anthropic/claude-x");
		expect(first?.text).toContain("Reading src/export.ts");
		expect(first?.text).toMatch(/2m \d+s/);
		// A finished lane folds to one line with how long it took.
		expect(second?.running).toBe(false);
		expect(second?.text).toBe("Scoping agent finished · 4m");
		expect(
			container.querySelector('[data-testid="factory-agents-idle"]'),
		).toBeNull();
		// The running lane's transcript shows below.
		expect(first?.pressed).toBe("true");
		// The selected lane says the builder is live; no second "Live" line.
		expect(stateLine()).toBeUndefined();
		expect(container.querySelector("fieldset")).toBeNull();
	});

	it("shows a selected lane's transcript", async () => {
		await renderLanes({
			sessions,
			runningIds: new Set(["builder-1"]),
			activity: activityWith({ "builder-1": {} }),
		});
		const scoping = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Show the scoping agent\'s conversation"]',
		);
		await act(async () => scoping?.click());
		expect(scoping?.getAttribute("aria-pressed")).toBe("true");
		expect(container.textContent).toContain("Here is the plan");
		expect(container.textContent).not.toContain("Editing the exporter");
	});

	it("says the last fact when nothing is running", async () => {
		const endedAt = new Date(Date.now() - 4 * 60_000 - 5000).toISOString();
		await renderLanes({
			sessions: [
				{
					sessionId: "builder-1",
					role: "builder",
					startedAt: "2026-01-01T00:00:00Z",
					endedAt,
				},
			],
			runningIds: new Set(),
		});
		expect(
			container.querySelector('[data-testid="factory-agents-idle"]')
				?.textContent,
		).toBe("No agent on this card. Builder finished 4m ago.");
		expect(container.textContent).not.toContain("Nothing is running");
	});

	it("labels a repository stage's lane by the stage's name, not its role", () => {
		expect(
			factoryAgentLanes(
				[
					{ sessionId: "reviewer-1", role: "reviewer" },
					{ sessionId: "stage-1", role: "reviewer", stage: "Security scan" },
					{ sessionId: "stage-2", role: "builder", stage: "Docs update" },
				],
				new Set(["reviewer-1", "stage-1", "stage-2"]),
				undefined,
			).map((lane) => lane.label),
		).toEqual(["Code reviewer", "Security scan", "Docs update"]);
	});

	it("treats a session live activity saw end as finished, and shows a slot wait", async () => {
		expect(
			factoryAgentLanes(
				[{ sessionId: "builder-1", role: "builder" }],
				new Set(["builder-1"]),
				activityWith({ "builder-1": { ended: true, at: 42 } }),
			).map((lane) => [lane.running, lane.endedAt]),
		).toEqual([[false, 42]]);
		await renderLanes({
			sessions: [{ sessionId: "builder-1", role: "builder" }],
			runningIds: new Set(),
			waiting: "Waiting for a free slot",
		});
		expect(
			container.querySelector('[data-testid="factory-agents-idle"]')
				?.textContent,
		).toBe("Waiting for a free slot");
	});
});
