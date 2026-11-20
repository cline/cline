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
	it.each([
		"complete",
		"failed",
	] as const)("shows a new preparation after %s without losing the previous task or draft", (previous) => {
		const draft = {
			text: "Saved follow-up",
			attachments: [new File(["image"], "test.png")],
		};
		let state = cloudHandoffUiReducer(
			{},
			previous === "complete"
				? {
						type: "complete",
						sourceSessionId: "local",
						sessionId: "cloud",
						dashboardUrl: "https://app.cline.bot/agents/cloud",
						unsentDraft: draft,
					}
				: {
						type: "failed",
						sourceSessionId: "local",
						message: "Previous failure",
						retryDraft: draft.text,
						retryAttachments: draft.attachments,
					},
		);
		const previousEntry = state.local;
		state = cloudHandoffUiReducer(state, {
			type: "prepare",
			sourceSessionId: "local",
		});
		expect(state.local).toMatchObject({ ...previousEntry, preparing: true });
		const status = () => (
			<CloudHandoffStatus
				state={state.local}
				onOpenCloud={vi.fn()}
				onConnectGitHub={vi.fn()}
				onRestoreDraft={vi.fn()}
				onDismiss={vi.fn()}
			/>
		);
		const view = render(status());
		expect(view.textContent).toContain("Preparing cloud handoff");
		expect(view.querySelector(".animate-spin")).not.toBeNull();
		expect(view.textContent).not.toContain("Restore draft");
		expect(view.textContent).not.toContain("with draft");
		if (previous === "complete")
			expect(view.textContent).toContain("Open cloud task");
		state = cloudHandoffUiReducer(state, {
			type: "preparation_failed",
			sourceSessionId: "local",
			message: "Cloud preparation cancelled.",
			retryDraft: "Edited retry",
			retryAttachments: draft.attachments,
		});
		act(() => root?.render(status()));
		expect(view.querySelector(".animate-spin")).toBeNull();
		expect(view.textContent).toContain("Restore draft");
		if (previous === "complete") {
			expect(state.local).toMatchObject({
				sessionId: "cloud",
				unsentDraft: draft,
			});
			expect(view.textContent).toContain("Open cloud task with draft");
		}
	});
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
		state = cloudHandoffUiReducer(state, {
			type: "preparation_failed",
			sourceSessionId: "local",
			message: "Retry preview failed",
			retryDraft: "Edited retry",
			retryAttachments: [],
		});
		const restorePreparation = vi.fn(() => {
			state = cloudHandoffUiReducer(state, {
				type: "preparation_draft_restored",
				sourceSessionId: "local",
			});
			root?.render(status());
		});
		const status = () => (
			<CloudHandoffStatus
				state={state.local}
				onOpenCloud={open}
				onConnectGitHub={vi.fn()}
				onRestoreDraft={(destination) =>
					destination === "cloud" ? restore() : restorePreparation()
				}
				onDismiss={vi.fn()}
			/>
		);
		const view = render(status());
		expect(
			view.querySelector('[aria-label="Dismiss cloud handoff status"]'),
		).toBeNull();
		act(() =>
			Array.from(view.querySelectorAll("button"))
				.find((button) => button.textContent === "Restore draft")
				?.click(),
		);
		expect(restorePreparation).toHaveBeenCalledOnce();
		expect(state.local).toMatchObject({
			status: "complete",
			unsentDraft: draft,
		});
		expect(view.textContent).not.toContain("Retry preview failed");
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
		expect(
			view.querySelector('[aria-label="Dismiss cloud handoff status"]'),
		).not.toBeNull();
	});
	it.each([
		"provisioning",
		"complete",
		"warning",
	] as const)("offers a user-clicked cloud link during %s", (phase) => {
		const onOpenCloud = vi.fn();
		const view = render(
			<CloudHandoffStatus
				state={
					phase !== "provisioning"
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
				onConnectGitHub={vi.fn()}
				onDismiss={vi.fn()}
				onRestoreDraft={vi.fn()}
			/>,
		);
		expect(view.textContent).toContain(
			phase === "complete"
				? "Cloud task ready"
				: phase === "warning"
					? "Check the cloud task"
					: "Preparing the cloud workspace",
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
	it.each([
		["Connect GitHub to continue.", "Cloud handoff needs attention"],
		[
			"Couldn't complete the push. Check GitHub write access, branch rules (including required signatures), pre-push hooks, and your connection.",
			"Couldn't push the checkpoint",
		],
	])("shows details for %s without automatically restoring the saved draft", (message, label) => {
		const failure = {
			type: "failed",
			sourceSessionId: "local",
			message,
			connectUrl: "https://app.cline.bot/settings/github",
			retryDraft: "continue",
			retryAttachments: [],
		} as const;
		let state = cloudHandoffUiReducer({}, { ...failure, retryAttachments: [] });
		const connect = vi.fn();
		const restore = vi.fn(() => {
			state = cloudHandoffUiReducer(state, {
				type: "dismiss",
				sourceSessionId: "local",
			});
			root?.render(status());
		});
		const status = (key = "initial") =>
			state.local ? (
				<CloudHandoffStatus
					key={key}
					state={state.local}
					onOpenCloud={vi.fn()}
					onRestoreDraft={restore}
					onConnectGitHub={connect}
					onDismiss={vi.fn()}
				/>
			) : null;
		const view = render(status());
		expect(view.textContent).toContain(label);
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		act(() =>
			Array.from(view.querySelectorAll("button"))
				.find((button) => button.textContent === "Details")
				?.click(),
		);
		expect(document.querySelector('[role="dialog"]')?.textContent).toBe(
			message,
		);
		expect(restore).not.toHaveBeenCalled();
		expect(
			view.querySelector('[aria-label="Dismiss cloud handoff status"]'),
		).toBeNull();
		act(() =>
			Array.from(view.querySelectorAll("button"))
				.find((button) => button.textContent === "Connect GitHub")
				?.click(),
		);
		expect(connect).toHaveBeenCalledWith(failure.connectUrl);
		expect(restore).not.toHaveBeenCalled();
		act(() =>
			Array.from(view.querySelectorAll("button"))
				.find((button) => button.textContent === "Restore draft")
				?.click(),
		);
		expect(restore).toHaveBeenCalledOnce();
		expect(view.textContent).not.toContain("Restore draft");
		act(() => root?.render(status("remount")));
		expect(view.textContent).not.toContain("Restore draft");
		state = cloudHandoffUiReducer(state, {
			...failure,
			retryDraft: "new attempt",
			retryAttachments: [],
		});
		act(() => root?.render(status("remount")));
		expect(view.textContent).toContain("Restore draft");
	});
	it("allows dismissal when a bare /cloud invocation has no text or images to recover", () => {
		const dismiss = vi.fn();
		const view = render(
			<CloudHandoffStatus
				state={{
					status: "failed",
					message: "Cloud preparation cancelled.",
					retryDraft: "",
					retryAttachments: [],
				}}
				onOpenCloud={vi.fn()}
				onRestoreDraft={vi.fn()}
				onConnectGitHub={vi.fn()}
				onDismiss={dismiss}
			/>,
		);
		expect(view.textContent).toContain("Cloud preparation cancelled.");
		expect(view.textContent).not.toContain("Cloud handoff stopped");
		act(() =>
			view
				.querySelector<HTMLButtonElement>(
					'[aria-label="Dismiss cloud handoff status"]',
				)
				?.click(),
		);
		expect(dismiss).toHaveBeenCalledOnce();
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
		expect(dialog?.textContent).toContain("You can keep working locally");
		expect(onDecision).not.toHaveBeenCalled();
		act(() =>
			Array.from(dialog?.querySelectorAll("button") ?? [])
				.find((button) => button.textContent === label)
				?.click(),
		);
		expect(onDecision.mock.calls[0]).toEqual([label !== "Cancel"]);
	});

	it("discloses local commits without changed-file details for a clean checkout", () => {
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
		expect(dialog?.textContent).not.toContain("will be committed");
		expect(dialog?.textContent).toContain(
			"1 local commit not confirmed on the remote",
		);
	});
});
