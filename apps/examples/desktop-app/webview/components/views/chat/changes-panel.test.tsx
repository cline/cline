// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangesScope, SessionChanges } from "@/lib/session-changes";
import type { SessionFileDiff } from "@/lib/session-diff";
import { ChangesPanel } from "./changes-panel";

const { invokeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(async (command: string, args?: Record<string, unknown>) => {
		if (command === "read_session_change") {
			return {
				oldText: args?.oldOid ? "const a = 1;\n" : undefined,
				newText: "const a = 2;\n",
				binary: false,
				truncated: false,
			};
		}
		return {};
	}),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: invokeMock },
}));

const changes: SessionChanges = {
	root: "/repo",
	session: {
		files: [
			{
				path: "docs/hub.md",
				status: "M",
				additions: 9,
				deletions: 0,
				oldOid: "a".repeat(40),
				newOid: "b".repeat(40),
			},
			{
				path: "src/retry.ts",
				status: "A",
				additions: 68,
				deletions: 0,
				newOid: "c".repeat(40),
			},
		],
		omitted: 0,
	},
	lastTurn: {
		runCount: 2,
		files: [
			{
				path: "docs/hub.md",
				status: "M",
				additions: 9,
				deletions: 0,
				oldOid: "a".repeat(40),
				newOid: "b".repeat(40),
			},
		],
		omitted: 0,
	},
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	invokeMock.mockClear();
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

async function render(
	props: Partial<Parameters<typeof ChangesPanel>[0]> & { scope: ChangesScope },
) {
	await act(async () => {
		root.render(
			<ChangesPanel
				changes={changes}
				cwd="/repo"
				environmentId="local"
				fallbackFileDiffs={[]}
				onClose={vi.fn()}
				onOpenGit={vi.fn()}
				onScopeChange={vi.fn()}
				onSelectPath={vi.fn()}
				selectedPath={null}
				{...props}
			/>,
		);
	});
}

const tabs = () =>
	[...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].map(
		(tab) =>
			`${tab.textContent}${tab.getAttribute("aria-selected") === "true" ? "*" : ""}`,
	);

describe("ChangesPanel", () => {
	it("lists the session's files and diffs the first one from its blobs", async () => {
		await render({ scope: "session" });
		expect(tabs()).toEqual(["Last turn", "Session*"]);
		expect(container.textContent).toContain("+77 -0");
		expect(container.textContent).toContain(
			"2 files since the session started",
		);
		expect(invokeMock).toHaveBeenCalledWith("read_session_change", {
			environmentId: "local",
			cwd: "/repo",
			oldOid: "a".repeat(40),
			newOid: "b".repeat(40),
		});
		expect(container.querySelector('[data-testid="file-diff"]')).not.toBeNull();
	});

	it("scopes to the last turn", async () => {
		await render({ scope: "last-turn", selectedPath: "docs/hub.md" });
		expect(tabs()).toEqual(["Last turn*", "Session"]);
		expect(container.textContent).toContain("1 file in the last turn");
		expect(container.querySelector('[title="docs/hub.md"]')).not.toBeNull();
		expect(container.querySelector('[title="src/retry.ts"]')).toBeNull();
	});

	it("reads only the new side of an added file", async () => {
		await render({ scope: "session", selectedPath: "src/retry.ts" });
		expect(invokeMock).toHaveBeenCalledWith("read_session_change", {
			environmentId: "local",
			cwd: "/repo",
			oldOid: undefined,
			newOid: "c".repeat(40),
		});
	});

	it("reports scope, file, Git, and close interactions", async () => {
		const onScopeChange = vi.fn();
		const onSelectPath = vi.fn();
		const onOpenGit = vi.fn();
		const onClose = vi.fn();
		await render({
			scope: "session",
			onScopeChange,
			onSelectPath,
			onOpenGit,
			onClose,
		});
		const click = (element: Element | null | undefined) =>
			act(async () => (element as HTMLElement | null)?.click());
		await click([...container.querySelectorAll('[role="tab"]')][0]);
		expect(onScopeChange).toHaveBeenCalledWith("last-turn");
		await click(container.querySelector('[title="src/retry.ts"]'));
		expect(onSelectPath).toHaveBeenCalledWith("src/retry.ts");
		await click(
			[...container.querySelectorAll("button")].find(
				(b) => b.textContent === "All uncommitted changes",
			),
		);
		expect(onOpenGit).toHaveBeenCalledOnce();
		await click(container.querySelector('[aria-label="Hide changes"]'));
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("falls back to tool-event edits without git checkpoints", async () => {
		const fallbackFileDiffs: SessionFileDiff[] = [
			{
				path: "notes.txt",
				additions: 1,
				deletions: 0,
				hunks: [{ oldStart: 1, newStart: 1, old: "", new: "hello" }],
			},
		];
		await render({
			changes: { unavailableReason: "This workspace is not a git repository." },
			fallbackFileDiffs,
			scope: "last-turn",
		});
		expect(container.textContent).toContain("not a git repository");
		expect(container.textContent).toContain(
			"reconstructed from this session's tool calls",
		);
		expect(container.querySelector('[title="notes.txt"]')).not.toBeNull();
		// Tool events only describe the whole session.
		expect(tabs()).toEqual(["Last turn", "Session*"]);
		expect(invokeMock).not.toHaveBeenCalledWith(
			"read_session_change",
			expect.anything(),
		);
	});
});
