// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMessages } from "../chat-messages";
import {
	parseGuidanceDiff,
	readFactoryGuidanceApproval,
} from "./factory-guidance-approval";
import type { ToolApprovalRequestItem } from "./tool-approval-panel";

// The real diff renders into @pierre/diffs' shadow DOM asynchronously; the
// stand-in exposes exactly what the card hands it.
vi.mock("@cline/ui/components/agent-chat/tool-diff", () => ({
	ToolFileDiff: ({
		oldText,
		newText,
		path,
	}: {
		oldText?: string;
		newText: string;
		path: string;
	}) => (
		<div
			data-new={newText}
			data-old={oldText}
			data-path={path}
			data-testid="tool-file-diff"
		/>
	),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	HTMLElement.prototype.scrollTo = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

const DIFF = [
	"--- a/builder.md",
	"+++ b/builder.md",
	"@@ -1,3 +1,3 @@",
	" # Builder guidance",
	" ",
	"-Run the unit tests.",
	"+Run the unit tests and the type checker.",
].join("\n");

function guidanceItem(
	input: unknown,
	requestId = "approval-1",
): ToolApprovalRequestItem {
	return {
		requestId,
		sessionId: "session-1",
		createdAt: "2026-11-11T10:00:00.000Z",
		toolCallId: "call-1",
		toolName: "factory_guidance",
		input,
	};
}

function roleInput(overrides: Record<string, unknown> = {}) {
	return {
		action: "apply",
		question: "Save this change to your Factory builder guidance?",
		role: "builder",
		scope: "user",
		path: "/Users/me/.cline/factory/guidance/builder.md",
		summary: "Builders also run the type checker.",
		diff: DIFF,
		...overrides,
	};
}

async function renderApprovals(
	items: ToolApprovalRequestItem[],
	overrides: Partial<Parameters<typeof ChatMessages>[0]> = {},
) {
	await act(async () => {
		root.render(
			<ChatMessages
				chatTransportState="connected"
				error={null}
				messages={[
					{
						id: "user-1",
						sessionId: "session-1",
						role: "user",
						content: "Builders should also run the type checker.",
						createdAt: 1,
					},
				]}
				onAnswerAskQuestion={vi.fn()}
				onApproveToolApproval={vi.fn()}
				onRejectToolApproval={vi.fn()}
				pendingAskQuestions={[]}
				pendingToolApprovals={items}
				sessionId="session-1"
				status="running"
				{...overrides}
			/>,
		);
	});
}

function card() {
	return container.querySelector<HTMLElement>(
		"[data-factory-guidance-approval]",
	);
}

function heading() {
	return card()?.querySelector("h3")?.textContent;
}

function buttons() {
	return [...(card()?.querySelectorAll("button") ?? [])].map(
		(button) => button.textContent,
	);
}

function button(label: string) {
	const found = [...container.querySelectorAll("button")].find(
		(candidate) => candidate.textContent === label,
	);
	if (!found) throw new Error(`No button ${label}`);
	return found;
}

describe("parseGuidanceDiff", () => {
	it("splits hunks into old and new text and counts changed lines", () => {
		expect(parseGuidanceDiff(DIFF)).toEqual({
			hunks: [
				{
					oldStart: 1,
					newStart: 1,
					oldText: "# Builder guidance\n\nRun the unit tests.",
					newText:
						"# Builder guidance\n\nRun the unit tests and the type checker.",
				},
			],
			additions: 1,
			removals: 1,
		});
	});

	it("rejects text that is not a diff with changes", () => {
		expect(parseGuidanceDiff("")).toBeUndefined();
		expect(parseGuidanceDiff("Builders should also lint.")).toBeUndefined();
		expect(parseGuidanceDiff("@@ -1,1 +1,1 @@\n same")).toBeUndefined();
	});
});

describe("readFactoryGuidanceApproval", () => {
	it("refuses input without a diff, summary, known role or scope", () => {
		expect(readFactoryGuidanceApproval(undefined)).toBeUndefined();
		expect(readFactoryGuidanceApproval("save it")).toBeUndefined();
		expect(
			readFactoryGuidanceApproval(roleInput({ diff: undefined })),
		).toBeUndefined();
		expect(
			readFactoryGuidanceApproval(roleInput({ summary: "  " })),
		).toBeUndefined();
		expect(
			readFactoryGuidanceApproval(roleInput({ role: "planner" })),
		).toBeUndefined();
		expect(
			readFactoryGuidanceApproval(roleInput({ scope: "global" })),
		).toBeUndefined();
	});
});

describe("Factory guidance approval card", () => {
	it("shows a role change with its summary, scope, path and diff", async () => {
		await renderApprovals([guidanceItem(roleInput())]);

		expect(heading()).toBe("Change how Factory's builder works?");
		const text = card()?.textContent ?? "";
		expect(text).toContain("For all your projects");
		expect(text).toContain("Builders also run the type checker.");
		expect(text).toContain("1 line added, 1 removed");
		expect(text).toContain("/Users/me/.cline/factory/guidance/builder.md");
		expect(text).toContain("Nothing is saved until you choose.");
		// The Hub's question and the raw input are not what is shown.
		expect(text).not.toContain("Save this change to your Factory");
		expect(text).not.toContain('"diff"');
		const diff = card()?.querySelector<HTMLElement>(
			"[data-testid='tool-file-diff']",
		);
		expect(diff?.dataset.old).toContain("Run the unit tests.");
		expect(diff?.dataset.new).toContain(
			"Run the unit tests and the type checker.",
		);
		expect(buttons()).toEqual(["Save this guidance", "Don't save"]);
		// Not the generic tool card.
		expect(container.textContent).not.toContain("Tool approval required");
	});

	it("is keyboard-focusable and described by the not-saved notice", async () => {
		await renderApprovals([guidanceItem(roleInput())]);

		const section = card();
		expect(section?.tabIndex).toBe(0);
		const notice = document.getElementById(
			section?.getAttribute("aria-describedby") ?? "",
		);
		expect(notice?.textContent).toBe("Nothing is saved until you choose.");
		expect(
			document.getElementById(section?.getAttribute("aria-labelledby") ?? "")
				?.textContent,
		).toBe("Change how Factory's builder works?");
	});

	it("names the plan checker role from the shared role labels", async () => {
		await renderApprovals([guidanceItem(roleInput({ role: "plan_reviewer" }))]);
		expect(heading()).toBe("Change how Factory's plan checker works?");
	});

	it("words a change to the manager readme", async () => {
		await renderApprovals([guidanceItem(roleInput({ role: "manager" }))]);
		expect(heading()).toBe("Change the Factory manager's readme?");
	});

	it("words a routing change and repository scope", async () => {
		await renderApprovals([
			guidanceItem(
				roleInput({
					role: "factory",
					scope: "repository",
					workspaceRoot: "/Users/me/code/acme-api/",
					path: undefined,
					summary: "Docs-only work skips the tester.",
				}),
			),
		]);

		expect(heading()).toBe("Change how Factory routes work?");
		const text = card()?.textContent ?? "";
		expect(text).toContain("For acme-api");
		expect(text).toContain("Docs-only work skips the tester.");
	});

	it("falls back to this repository without a workspace root", async () => {
		await renderApprovals([guidanceItem(roleInput({ scope: "repository" }))]);
		expect(card()?.textContent).toContain("For this repository");
	});

	it("says when accepting a file changed outside Factory", async () => {
		await renderApprovals([guidanceItem(roleInput({ action: "accept" }))]);
		expect(heading()).toBe(
			"This guidance file was changed outside Factory. Use this version?",
		);
		expect(buttons()).toEqual(["Save this guidance", "Don't save"]);
	});

	it("says when discarding a change made outside Factory", async () => {
		await renderApprovals([guidanceItem(roleInput({ action: "discard" }))]);
		expect(heading()).toBe(
			"Discard the outside change and keep Factory's version?",
		);
	});

	it.each([
		["no diff", roleInput({ diff: undefined })],
		["prose instead of a diff", roleInput({ diff: "I updated the builder." })],
		["no input", undefined],
	])("offers only Don't save for %s", async (_label, input) => {
		await renderApprovals([guidanceItem(input)]);

		expect(heading()).toBe(
			"Factory could not show this change, so it cannot be saved.",
		);
		expect(buttons()).toEqual(["Don't save"]);
		expect(card()?.querySelector("[data-testid='tool-file-diff']")).toBeNull();
		expect(card()?.textContent).not.toContain("I updated the builder.");
	});

	it("approves and rejects through the existing callbacks", async () => {
		const onApproveToolApproval = vi.fn();
		const onRejectToolApproval = vi.fn();
		await renderApprovals([guidanceItem(roleInput(), "approval-7")], {
			onApproveToolApproval,
			onRejectToolApproval,
		});

		await act(async () => button("Save this guidance").click());
		expect(onApproveToolApproval).toHaveBeenCalledWith("approval-7");
		expect(onRejectToolApproval).not.toHaveBeenCalled();

		await act(async () => button("Don't save").click());
		expect(onRejectToolApproval).toHaveBeenCalledWith("approval-7");
	});

	it("rejects an unreadable change through the existing callback", async () => {
		const onRejectToolApproval = vi.fn();
		await renderApprovals([guidanceItem({ action: "apply" }, "approval-9")], {
			onRejectToolApproval,
		});

		await act(async () => button("Don't save").click());
		expect(onRejectToolApproval).toHaveBeenCalledWith("approval-9");
	});

	it("keeps the generic card for other tools alongside it", async () => {
		await renderApprovals([
			guidanceItem(roleInput()),
			{
				...guidanceItem({ command: "ls" }, "approval-2"),
				toolName: "run_commands",
			},
		]);

		expect(card()).not.toBeNull();
		expect(container.textContent).toContain("Tool approval required");
		expect(container.textContent).toContain("run_commands");
		expect(container.textContent).toContain('"command": "ls"');
		expect(button("Approve")).toBeDefined();
		expect(button("Reject")).toBeDefined();
	});

	it("leaves a generic approval unchanged when no guidance is pending", async () => {
		await renderApprovals([
			{
				...guidanceItem({ path: "a.txt" }, "approval-3"),
				toolName: "read_files",
			},
		]);

		expect(card()).toBeNull();
		expect(container.textContent).toContain("Tool approval required");
		expect(container.textContent).toContain("Request approval-3");
		expect(container.textContent).toContain('"path": "a.txt"');
	});

	it("is hidden in read-only mode", async () => {
		await renderApprovals([guidanceItem(roleInput())], { readOnly: true });

		expect(card()).toBeNull();
		expect(container.textContent).not.toContain("Save this guidance");
	});
});

describe("Factory stages approval card", () => {
	const STAGES_DIFF = [
		"--- a/.cline/factory/stages.json",
		"+++ b/.cline/factory/stages.json",
		"@@ -0,0 +1,3 @@",
		"+{",
		'+  "schemaVersion": 1',
		"+}",
	].join("\n");
	const stagesItem = (overrides: Record<string, unknown> = {}) => ({
		...guidanceItem(
			{
				action: "apply",
				question: "Change acme-api's Factory stages?",
				project: "acme-api",
				workspaceRoot: "/Users/me/code/acme-api",
				path: ".cline/factory/stages.json",
				summary: 'Add repository stage "Lint"',
				diff: STAGES_DIFF,
				warnings: ["This command will run on your machine as you."],
				...overrides,
			},
			"approval-stages",
		),
		toolName: "factory_stages",
	});

	it("shows the project's stages change with its warning and diff", async () => {
		await renderApprovals([stagesItem()]);

		expect(heading()).toBe("Change this project's Factory stages?");
		const text = card()?.textContent ?? "";
		expect(text).toContain("For acme-api");
		expect(text).toContain('Add repository stage "Lint"');
		expect(text).toContain("This command will run on your machine as you.");
		expect(text).toContain("3 lines added, 0 removed");
		expect(text).toContain(".cline/factory/stages.json");
		expect(text).toContain(
			"Nothing is saved, approved or run until you choose.",
		);
		expect(text).not.toContain("Change acme-api's Factory stages?");
		expect(
			card()?.querySelector<HTMLElement>("[data-testid='tool-file-diff']")
				?.dataset.new,
		).toContain('"schemaVersion": 1');
		expect(buttons()).toEqual(["Save and approve", "Don't save"]);
		expect(container.textContent).not.toContain("Tool approval required");
	});

	it("answers the approval through the existing callbacks", async () => {
		const onApproveToolApproval = vi.fn();
		const onRejectToolApproval = vi.fn();
		await renderApprovals([stagesItem({ warnings: [] })], {
			onApproveToolApproval,
			onRejectToolApproval,
		});
		expect(card()?.textContent).not.toContain("on your machine");

		await act(async () => button("Save and approve").click());
		expect(onApproveToolApproval).toHaveBeenCalledWith("approval-stages");
		await act(async () => button("Don't save").click());
		expect(onRejectToolApproval).toHaveBeenCalledWith("approval-stages");
	});

	it("cannot be saved without a named project", async () => {
		expect(
			readFactoryGuidanceApproval(
				{ summary: "Add", diff: STAGES_DIFF },
				"factory_stages",
			),
		).toBeUndefined();
		await renderApprovals([stagesItem({ project: undefined })]);
		expect(buttons()).toEqual(["Don't save"]);
	});
});
