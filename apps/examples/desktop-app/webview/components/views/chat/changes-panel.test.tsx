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
	turns: [
		{
			runCount: 1,
			files: [
				{
					path: "src/retry.ts",
					status: "A",
					additions: 62,
					deletions: 0,
					newOid: "d".repeat(40),
				},
			],
			omitted: 0,
		},
		{
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
	],
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
		await render({ scope: { kind: "session" } });
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

	it("scopes to the latest turn by default and labels an older turn", async () => {
		await render({ scope: { kind: "turn" } });
		expect(tabs()).toEqual(["Last turn*", "Session"]);
		expect(container.textContent).toContain("1 file in turn 2");
		expect(container.querySelector('[title="docs/hub.md"]')).not.toBeNull();
		expect(container.querySelector('[title="src/retry.ts"]')).toBeNull();

		await render({
			scope: { kind: "turn", runCount: 1 },
			selectedPath: "src/retry.ts",
		});
		expect(tabs()).toEqual(["Turn 1*", "Last turn", "Session"]);
		expect(container.textContent).toContain("in turn 1");
		// An added file has no old side to read.
		expect(invokeMock).toHaveBeenCalledWith("read_session_change", {
			environmentId: "local",
			cwd: "/repo",
			oldOid: undefined,
			newOid: "d".repeat(40),
		});
	});

	it("reports scope, file, Git, and close interactions", async () => {
		const onScopeChange = vi.fn();
		const onSelectPath = vi.fn();
		const onOpenGit = vi.fn();
		const onClose = vi.fn();
		await render({
			scope: { kind: "session" },
			onScopeChange,
			onSelectPath,
			onOpenGit,
			onClose,
		});
		const click = (element: Element | null | undefined) =>
			act(async () => (element as HTMLElement | null)?.click());
		await click([...container.querySelectorAll('[role="tab"]')][0]);
		expect(onScopeChange).toHaveBeenCalledWith({ kind: "turn" });
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
			scope: { kind: "turn" },
		});
		expect(container.textContent).toContain("not a git repository");
		expect(container.textContent).toContain(
			"reconstructed from this session's tool calls",
		);
		expect(container.querySelector('[title="notes.txt"]')).not.toBeNull();
		expect(invokeMock).not.toHaveBeenCalledWith(
			"read_session_change",
			expect.anything(),
		);
	});
});
