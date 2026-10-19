// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CloudHandoffGitConfirmation,
	CloudHandoffRecoveryNotice,
	CloudHandoffStatus,
} from "./cloud-handoff";

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
	act(() => root?.unmount());
	root = null;
	container?.remove();
	container = null;
});

function render(node: React.ReactNode) {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	act(() => root?.render(node));
	return container;
}

describe("CloudHandoffStatus", () => {
	it.each([
		"sending",
		"complete",
		"warning",
	] as const)("offers a user-clicked cloud link during %s", (phase) => {
		const onOpenCloud = vi.fn();
		const view = render(
			<CloudHandoffStatus
				state={
					phase !== "sending"
						? {
								status: "complete",
								sessionId: "cloud-1",
								dashboardUrl: "https://app.cline.bot/agents/cloud-1",
								message:
									phase === "warning"
										? "Check delivery before resending."
										: undefined,
							}
						: {
								status: "progress",
								phase,
								sessionId: "cloud-1",
								dashboardUrl: "https://app.cline.bot/agents/cloud-1",
							}
				}
				onOpenCloud={onOpenCloud}
				onDismiss={vi.fn()}
				onRestoreDraft={vi.fn()}
			/>,
		);
		expect(view.textContent).toContain(
			phase === "complete"
				? "Cloud task ready"
				: phase === "warning"
					? "Check the cloud task"
					: "Sending the cloud task",
		);
		if (phase === "warning") {
			expect(view.textContent).toContain("Check delivery before resending.");
		}
		expect(onOpenCloud).not.toHaveBeenCalled();
		const button = Array.from(view.querySelectorAll("button")).find((item) =>
			item.textContent?.includes("Open cloud task"),
		);
		act(() => button?.click());
		expect(onOpenCloud).toHaveBeenCalledOnce();
	});
	it("shows preparation failure without automatically restoring the saved draft", () => {
		const restore = vi.fn();
		const view = render(
			<CloudHandoffStatus
				state={{
					status: "failed",
					message: "Summary failed",
					retryDraft: "continue",
					retryAttachments: [],
				}}
				onOpenCloud={vi.fn()}
				onRestoreDraft={restore}
				onDismiss={vi.fn()}
			/>,
		);
		expect(view.textContent).toContain("Summary failed");
		expect(restore).not.toHaveBeenCalled();
		act(() =>
			Array.from(view.querySelectorAll("button"))
				.find((button) => button.textContent === "Restore /cloud draft")
				?.click(),
		);
		expect(restore).toHaveBeenCalledOnce();
	});
});

describe("CloudHandoffGitConfirmation", () => {
	it.each([
		"Cancel",
		"Push and continue",
	])("discloses scope and requires an explicit %s decision", (label) => {
		const onDecision = vi.fn();
		render(
			<CloudHandoffGitConfirmation
				plan={{
					id: "plan",
					repoUrl: "https://github.com/cline/todo-app",
					remote: "origin",
					sourceBranch: "main",
					branch: "cline/handoff-test",
					files: [{ path: "new.txt", status: "??" }],
					commits: ["abc local commit"],
				}}
				onDecision={onDecision}
			/>,
		);
		const dialog = document.querySelector('[role="alertdialog"]');
		expect(dialog?.textContent).toContain("https://github.com/cline/todo-app");
		expect(dialog?.textContent).toContain("cline/handoff-test");
		expect(dialog?.textContent).toContain(
			"1 changed/new file will be committed",
		);
		const details = dialog?.querySelector("details");
		expect(dialog?.textContent).toContain(
			"1 local commit not confirmed on the remote",
		);
		expect(details?.textContent).not.toContain("1 local commit");
		expect(details?.open).toBe(false);
		expect(details?.textContent).toContain("new.txt");
		expect(details?.textContent).toContain("abc local commit");
		expect(dialog?.textContent).toContain("staging stay unchanged");
		act(() => details?.querySelector("summary")?.click());
		expect(details?.open).toBe(true);
		expect(onDecision).not.toHaveBeenCalled();
		act(() => details?.querySelector("summary")?.click());
		expect(details?.open).toBe(false);
		expect(onDecision).not.toHaveBeenCalled();
		act(() =>
			Array.from(dialog?.querySelectorAll("button") ?? [])
				.find((button) => button.textContent === label)
				?.click(),
		);
		expect(onDecision.mock.calls[0]).toEqual([label !== "Cancel"]);
	});

	it("omits file and staging warnings for a clean checkout", () => {
		render(
			<CloudHandoffGitConfirmation
				plan={{
					id: "plan",
					repoUrl: "https://github.com/cline/todo-app",
					remote: "origin",
					sourceBranch: "main",
					branch: "cline/handoff-test",
					files: [],
					commits: ["abc local commit"],
				}}
				onDecision={vi.fn()}
			/>,
		);
		const dialog = document.querySelector('[role="alertdialog"]');
		expect(dialog?.textContent).not.toContain("changed/new");
		expect(dialog?.textContent).toContain("staging stay unchanged");
		expect(dialog?.textContent).not.toContain("will be committed");
		expect(dialog?.textContent).toContain(
			"1 local commit not confirmed on the remote",
		);
		expect(dialog?.querySelector("details")?.textContent).not.toContain(
			"1 local commit",
		);
		expect(dialog?.querySelector("details")?.textContent).toContain(
			"abc local commit",
		);
		expect(dialog?.textContent).toContain("Push and continue");
	});
});

describe("CloudHandoffRecoveryNotice", () => {
	it("requires an explicit restore or dismiss for uncertain delivery", () => {
		const onRestoreDraft = vi.fn();
		const onDismiss = vi.fn();
		const view = render(
			<CloudHandoffRecoveryNotice
				onRestoreDraft={onRestoreDraft}
				onDismiss={onDismiss}
			/>,
		);
		expect(view.textContent).toContain("Check this conversation");
		expect(onRestoreDraft).not.toHaveBeenCalled();
		act(() =>
			Array.from(view.querySelectorAll("button"))
				.find((button) => button.textContent?.includes("Restore saved draft"))
				?.click(),
		);
		expect(onRestoreDraft).toHaveBeenCalledOnce();
		act(() =>
			view
				.querySelector<HTMLButtonElement>(
					'[aria-label="Dismiss handoff recovery"]',
				)
				?.click(),
		);
		expect(onDismiss).toHaveBeenCalledOnce();
	});
});
