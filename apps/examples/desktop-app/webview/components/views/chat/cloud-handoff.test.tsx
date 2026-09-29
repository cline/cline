// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CloudHandoffGitConfirmation,
	CloudHandoffProgress,
	CloudHandoffReceipt,
	CloudHandoffRecoveryNotice,
} from "./cloud-handoff";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({ toast: toastMock }));

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
	act(() => root?.unmount());
	root = null;
	container?.remove();
	container = null;
	toastMock.mockReset();
});

function render(node: React.ReactNode) {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	act(() => root?.render(node));
	return container;
}

describe("CloudHandoffProgress", () => {
	it("shows a truthful phase and an optional early external link", () => {
		const onOpenCloud = vi.fn();
		const view = render(
			<CloudHandoffProgress
				dashboardUrl="https://staging-app.cline.bot/agents?sessionId=cloud-1"
				onOpenCloud={onOpenCloud}
				phase="seeding"
			/>,
		);
		expect(view.textContent).toContain("Transferring the conversation");
		expect(view.textContent).toContain("available to watch");
		expect(view.textContent).not.toContain("ready to open");
		const button = Array.from(view.querySelectorAll("button")).find((item) =>
			item.textContent?.includes("Open Cloud"),
		);
		act(() => button?.click());
		expect(onOpenCloud).toHaveBeenCalledOnce();
	});
});

describe("CloudHandoffGitConfirmation", () => {
	it.each([
		"Cancel",
		"Prepare and continue",
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
		expect(dialog?.textContent).toContain("new.txt");
		expect(dialog?.textContent).toContain("abc local commit");
		expect(dialog?.textContent).toContain(
			"staging selections will be replaced",
		);
		expect(onDecision).not.toHaveBeenCalled();
		act(() =>
			Array.from(dialog?.querySelectorAll("button") ?? [])
				.find((button) => button.textContent === label)
				?.click(),
		);
		expect(onDecision.mock.calls[0]).toEqual([label !== "Cancel"]);
	});
});

describe("CloudHandoffReceipt", () => {
	it("explains the local copy and offers cloud and local-fork actions", () => {
		const onOpenCloud = vi.fn();
		const onForkLocally = vi.fn();
		const view = render(
			<CloudHandoffReceipt
				onForkLocally={onForkLocally}
				onOpenCloud={onOpenCloud}
				receipt={{
					targetSessionId: "cloud-1",
					dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
				}}
				showRecoveryUrl
			/>,
		);
		expect(view.textContent).toContain("read-only history");
		expect(view.textContent).toContain("sessionId=cloud-1");
		const buttons = Array.from(view.querySelectorAll("button"));
		act(() =>
			buttons.find((item) => item.textContent?.includes("Open Cloud"))?.click(),
		);
		act(() =>
			buttons
				.find((item) => item.textContent?.includes("Fork Locally"))
				?.click(),
		);
		expect(onOpenCloud).toHaveBeenCalledOnce();
		expect(onForkLocally).toHaveBeenCalledOnce();
	});

	it("keeps the dashboard URL out of the in-app receipt", () => {
		const view = render(
			<CloudHandoffReceipt
				onForkLocally={() => undefined}
				onOpenCloud={() => undefined}
				receipt={{
					targetSessionId: "cloud-1",
					dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
				}}
			/>,
		);
		expect(view.textContent).not.toContain("sessionId=cloud-1");
		expect(view.textContent).not.toContain("Copy recovery link");
	});

	it.each([
		"unavailable",
		"rejected",
	] as const)("explains when clipboard copying is %s", async (failure) => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value:
				failure === "rejected"
					? { writeText: vi.fn().mockRejectedValue(new Error("denied")) }
					: undefined,
		});
		const view = render(
			<CloudHandoffReceipt
				onForkLocally={() => undefined}
				onOpenCloud={() => undefined}
				receipt={{
					targetSessionId: "cloud-1",
					dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
				}}
				showRecoveryUrl
			/>,
		);
		await act(async () => {
			Array.from(view.querySelectorAll("button"))
				.find((item) => item.textContent?.includes("Copy recovery link"))
				?.click();
			await Promise.resolve();
		});

		expect(toastMock).toHaveBeenCalledExactlyOnceWith({
			title: "Copy failed",
			description: "Use Open Cloud or select the recovery link above.",
			variant: "destructive",
		});
	});
});

describe("CloudHandoffRecoveryNotice", () => {
	it("retains a non-spinning link after handoff progress stops", () => {
		const onOpenCloud = vi.fn();
		const onDismiss = vi.fn();
		const view = render(
			<CloudHandoffRecoveryNotice
				dashboardUrl="https://app.cline.bot/agents?sessionId=orphan-1"
				onDismiss={onDismiss}
				onOpenCloud={onOpenCloud}
			/>,
		);
		expect(view.textContent).toContain("Handoff interrupted");
		expect(view.textContent).toContain(
			"A cloud session was created and may still be available",
		);
		expect(view.textContent).toContain("sessionId=orphan-1");
		expect(view.querySelector(".animate-spin")).toBeNull();
		act(() =>
			Array.from(view.querySelectorAll("button"))
				.find((button) => button.textContent?.includes("Open Cloud"))
				?.click(),
		);
		expect(onOpenCloud).toHaveBeenCalledOnce();
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
