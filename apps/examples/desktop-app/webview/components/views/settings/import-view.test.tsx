// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportContent } from "./import-view";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, subscribe: vi.fn(() => () => {}) },
}));

vi.mock("@/components/import-sessions-dialog", () => ({
	ImportSessionsDialog: ({
		open,
		onOpenChange,
	}: {
		open: boolean;
		onOpenChange: (open: boolean) => void;
	}) =>
		open ? (
			<div data-testid="import-dialog">
				<button onClick={() => onOpenChange(false)} type="button">
					stub-close
				</button>
			</div>
		) : null,
}));

function session(tool: string, alreadyImportedSessionId?: string) {
	return {
		tool,
		sourceId: `${tool}-${Math.random()}`,
		sourcePath: "/tmp/x",
		title: "t",
		cwd: "/tmp",
		startedAtMs: 0,
		updatedAtMs: 0,
		messageCount: 1,
		alreadyImportedSessionId,
	};
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	invoke.mockReset();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

async function render() {
	await act(async () => {
		root.render(<ImportContent />);
	});
	await act(async () => {
		await Promise.resolve();
	});
}

function click(label: string) {
	const button = [...container.querySelectorAll("button")].find((element) =>
		element.textContent?.includes(label),
	);
	if (!button) throw new Error(`no button "${label}"`);
	act(() => button.click());
}

describe("ImportContent", () => {
	it("summarizes each tool from the scan", async () => {
		invoke.mockResolvedValue({
			installedTools: ["claude-code", "codex"],
			sessions: [
				session("claude-code"),
				session("claude-code", "existing"),
				session("claude-code"),
			],
		});
		await render();
		expect(invoke).toHaveBeenCalledWith(
			"list_importable_sessions",
			{},
			expect.anything(),
		);
		const text = container.textContent ?? "";
		expect(text).toContain("Claude Code");
		expect(text).toContain("3 sessions found · 1 already imported");
		expect(text).toContain("No sessions found");
		expect(text).toContain("Not detected on this machine");
	});

	it("opens the import dialog and rescans when it closes", async () => {
		invoke.mockResolvedValue({ installedTools: [], sessions: [] });
		await render();
		expect(invoke).toHaveBeenCalledTimes(1);

		click("Import sessions");
		expect(container.querySelector("[data-testid=import-dialog]")).not.toBe(
			null,
		);

		click("stub-close");
		await act(async () => {
			await Promise.resolve();
		});
		expect(container.querySelector("[data-testid=import-dialog]")).toBe(null);
		expect(invoke).toHaveBeenCalledTimes(2);
	});

	it("reports a failed scan", async () => {
		invoke.mockRejectedValue(new Error("disk on fire"));
		await render();
		expect(container.textContent).toContain(
			"Couldn't scan for sessions: disk on fire",
		);
	});
});
