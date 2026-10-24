// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentTeamMember } from "../components/agent-team-activity.js";
import { AgentTeamPanel } from "../components/agent-team-panel.js";

let container: HTMLDivElement;
let root: Root;

const START = Date.parse("2026-10-20T20:00:00.000Z");

const running: AgentTeamMember[] = [
	{
		agentId: "ui-dev",
		sessionId: "s-ui",
		task: "Add a theme toggle",
		phase: "editing",
		step: "Editing files",
		startedAt: START,
	},
	{
		agentId: "reviewer",
		sessionId: "s-review",
		task: "Review both changes",
		phase: "reading",
		step: "Reading files",
		startedAt: START + 5_000,
	},
];

const finished: AgentTeamMember[] = running.map((member) => ({
	...member,
	phase: "done",
	step: undefined,
	endedAt: START + 135_000,
}));

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

function rows() {
	return [...container.querySelectorAll<HTMLButtonElement>("li button")];
}

it("lists each teammate with its phase, step, and elapsed time", async () => {
	await act(async () =>
		root.render(
			<AgentTeamPanel
				members={running}
				now={START + 65_000}
				onOpenSession={() => {}}
				teamName="team-Shp9t"
			/>,
		),
	);

	const header = container.querySelector("button[aria-expanded]");
	expect(header?.textContent).toContain("team-Shp9t");
	expect(header?.textContent).toContain("1 planning · 1 acting");
	expect(header?.textContent).toContain("1m 5s");
	expect(rows().map((row) => row.textContent)).toEqual([
		"ui-devEditingEditing files1m 5s",
		"reviewerReadingReading files1m 0s",
	]);
});

it("opens a teammate's session and highlights the one on screen", async () => {
	const onOpenSession = vi.fn();
	await act(async () =>
		root.render(
			<AgentTeamPanel
				activeSessionId="s-review"
				members={running}
				now={START}
				onOpenSession={onOpenSession}
			/>,
		),
	);

	expect(rows().map((row) => row.getAttribute("aria-current"))).toEqual([
		null,
		"true",
	]);
	await act(async () => rows()[0]?.click());
	expect(onOpenSession).toHaveBeenCalledWith("s-ui");
});

it("folds to a summary when the team finishes and opens when it resumes", async () => {
	await act(async () =>
		root.render(
			<AgentTeamPanel members={running} now={START} onOpenSession={() => {}} />,
		),
	);
	await act(async () =>
		root.render(
			<AgentTeamPanel
				members={finished}
				now={START + 200_000}
				onOpenSession={() => {}}
			/>,
		),
	);

	const header = container.querySelector("button[aria-expanded]");
	expect(header?.getAttribute("aria-expanded")).toBe("false");
	expect(header?.textContent).toContain("2 done");
	expect(header?.textContent).toContain("2m 15s");
	expect(rows()).toHaveLength(0);

	await act(async () => (header as HTMLButtonElement).click());
	expect(rows()).toHaveLength(2);

	await act(async () =>
		root.render(
			<AgentTeamPanel
				members={[
					...finished,
					{
						agentId: "fixer",
						sessionId: "s-fix",
						phase: "editing",
						startedAt: START + 205_000,
					},
				]}
				now={START + 210_000}
				onOpenSession={() => {}}
			/>,
		),
	);
	expect(
		container
			.querySelector("button[aria-expanded]")
			?.getAttribute("aria-expanded"),
	).toBe("true");
});

it("renders nothing without teammates", async () => {
	await act(async () =>
		root.render(<AgentTeamPanel members={[]} onOpenSession={() => {}} />),
	);
	expect(container.innerHTML).toBe("");
});
