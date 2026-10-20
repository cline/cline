// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudHandoffUiReducer } from "@/lib/cloud-handoff-ui-state";
import {
	CloudHandoffGitConfirmation,
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
	it("offers explicit draft restoration once and keeps the task link", () => {
		const draft = {
			text: "Summary and follow-up",
			attachments: [new File(["image"], "test.png")],
		};
		let state = cloudHandoffUiReducer(
			{},
			{
				type: "complete",
				sourceSessionId: "local",
				sessionId: "cloud",
				dashboardUrl: "https://app.cline.bot/agents/cloud",
				message: "Not sent",
				unsentDraft: draft,
			},
		);
		const restore = vi.fn(() => {
			state = cloudHandoffUiReducer(state, {
				type: "cloud_draft_restored",
				sourceSessionId: "local",
				draft,
			});
			root?.render(status());
		});
		const open = vi.fn();
		const status = () => (
			<CloudHandoffStatus
				state={state.local}
				onOpenCloud={open}
				onRestoreDraft={restore}
				onDismiss={vi.fn()}
			/>
		);
		const view = render(status());
		expect(restore).not.toHaveBeenCalled();
		act(() =>
			Array.from(view.querySelectorAll("button"))
				.find((button) => button.textContent === "Open cloud task with draft")
				?.click(),
		);
		expect(restore).toHaveBeenCalledOnce();
		expect(open).not.toHaveBeenCalled();
		expect(view.textContent).not.toContain("with draft");
		expect(view.textContent).toContain("Open cloud task");
	});
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
			expect(view.textContent).not.toContain("with draft");
		}
		expect(onOpenCloud).not.toHaveBeenCalled();
		const button = Array.from(view.querySelectorAll("button")).find((item) =>
			item.textContent?.includes("Open cloud task"),
		);
		act(() => button?.click());
		expect(onOpenCloud).toHaveBeenCalledOnce();
	});
	it("shows preparation failure without automatically restoring the saved draft", () => {
		const failure = {
			type: "failed",
			sourceSessionId: "local",
			message: "Summary failed",
			retryDraft: "continue",
			retryAttachments: [],
		} as const;
		let state = cloudHandoffUiReducer({}, { ...failure, retryAttachments: [] });
		const restore = vi.fn(() => {
			state = cloudHandoffUiReducer(state, {
				type: "retry_restored",
				sourceSessionId: "local",
			});
			root?.render(status());
		});
		const status = (key = "initial") => (
			<CloudHandoffStatus
				key={key}
				state={state.local}
				onOpenCloud={vi.fn()}
				onRestoreDraft={restore}
				onDismiss={vi.fn()}
			/>
		);
		const view = render(status());
		expect(view.textContent).toContain("Summary failed");
		expect(restore).not.toHaveBeenCalled();
		act(() =>
			Array.from(view.querySelectorAll("button"))
				.find((button) => button.textContent === "Restore /cloud draft")
				?.click(),
		);
		expect(restore).toHaveBeenCalledOnce();
		expect(view.textContent).not.toContain("Restore /cloud draft");
		act(() => root?.render(status("remount")));
		expect(view.textContent).not.toContain("Restore /cloud draft");
		state = cloudHandoffUiReducer(state, {
			...failure,
			retryDraft: "new attempt",
			retryAttachments: [],
		});
		act(() => root?.render(status("remount")));
		expect(view.textContent).toContain("Restore /cloud draft");
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
