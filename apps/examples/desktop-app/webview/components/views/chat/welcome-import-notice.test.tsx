// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markOnboardingCompleted, resetOnboarding } from "@/lib/onboarding";
import {
	dismissImportNotice,
	isImportNoticeDismissed,
} from "@/lib/session-import";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, subscribe: vi.fn(() => () => {}) },
}));

// The real dialog runs its own scan and import flow; a stub exposes the two
// callbacks the notice reacts to.
vi.mock("@/components/import-sessions-dialog", () => ({
	ImportSessionsDialog: ({
		open,
		onImported,
		onOpenChange,
	}: {
		open: boolean;
		onImported?: () => void;
		onOpenChange: (open: boolean) => void;
	}) =>
		open ? (
			<div data-testid="import-dialog">
				<button onClick={() => onImported?.()} type="button">
					stub-import
				</button>
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
	window.localStorage.clear();
	markOnboardingCompleted();
	invoke.mockReset();
	// The scan result is cached per module instance; a fresh module per test
	// keeps the scenarios independent.
	vi.resetModules();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	resetOnboarding();
});

async function renderNotice() {
	const { WelcomeImportNotice } = await import("./welcome-import-notice");
	await act(async () => {
		root.render(<WelcomeImportNotice />);
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

describe("WelcomeImportNotice", () => {
	it("renders nothing when no un-imported sessions exist", async () => {
		invoke.mockResolvedValue({
			installedTools: ["claude-code"],
			sessions: [session("claude-code", "already")],
		});
		await renderNotice();
		expect(invoke).toHaveBeenCalledWith(
			"list_importable_sessions",
			{},
			expect.anything(),
		);
		expect(container.textContent).toBe("");
	});

	it("names the tools and counts the sessions it found", async () => {
		invoke.mockResolvedValue({
			installedTools: ["claude-code", "codex"],
			sessions: [
				session("codex"),
				session("claude-code"),
				session("claude-code"),
			],
		});
		await renderNotice();
		expect(container.textContent).toContain(
			"Bring your history from Claude Code and Codex",
		);
		expect(container.textContent).toContain("Cline found 3 sessions");
	});

	it("does not scan once dismissed, and remembers the dismissal", async () => {
		invoke.mockResolvedValue({
			installedTools: ["opencode"],
			sessions: [session("opencode")],
		});
		await renderNotice();
		expect(container.textContent).toContain("opencode");

		click("Not now");
		expect(container.textContent).toBe("");
		expect(isImportNoticeDismissed()).toBe(true);

		invoke.mockClear();
		await act(async () => root.unmount());
		root = createRoot(container);
		await renderNotice();
		expect(invoke).not.toHaveBeenCalled();
		expect(container.textContent).toBe("");
	});

	it("stays up until the import dialog closes, then goes away for good", async () => {
		invoke.mockResolvedValue({
			installedTools: ["codex"],
			sessions: [session("codex")],
		});
		await renderNotice();
		click("Import sessions");
		expect(container.querySelector("[data-testid=import-dialog]")).not.toBe(
			null,
		);

		click("stub-import");
		expect(isImportNoticeDismissed()).toBe(true);
		expect(container.textContent).toContain("Bring your history from Codex");

		click("stub-close");
		expect(container.textContent).toBe("");
	});

	it("leaves the scan to onboarding while onboarding is still in progress", async () => {
		resetOnboarding();
		invoke.mockResolvedValue({
			installedTools: ["codex"],
			sessions: [session("codex")],
		});
		await renderNotice();
		expect(invoke).not.toHaveBeenCalled();
		expect(container.textContent).toBe("");
	});

	it("is a no-op when onboarding already recorded the user's decision", async () => {
		dismissImportNotice();
		await renderNotice();
		expect(invoke).not.toHaveBeenCalled();
	});
});
