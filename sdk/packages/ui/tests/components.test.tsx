// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AgentActivity,
	AgentApprovalCard,
	AgentComposer,
	AgentQuickActions,
	AgentSurface,
	Button,
	ConfirmDialog,
	SearchCombobox,
	SessionStatus,
} from "../src/index.js";

class TestResizeObserver implements ResizeObserver {
	disconnect() {}
	observe() {}
	unobserve() {}
}

globalThis.ResizeObserver = TestResizeObserver;
Element.prototype.scrollIntoView = vi.fn();

afterEach(cleanup);

describe("@cline/ui agent components", () => {
	it("submits the composer with Enter while preserving Shift + Enter", () => {
		const onSubmit = vi.fn();
		render(
			<AgentComposer
				onSubmit={onSubmit}
				onValueChange={vi.fn()}
				value="Build the feature"
			/>,
		);

		fireEvent.keyDown(screen.getByRole("textbox"), {
			key: "Enter",
			shiftKey: true,
		});
		expect(onSubmit).not.toHaveBeenCalled();

		fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
		expect(onSubmit).toHaveBeenCalledOnce();
	});

	it("renders a stop action while an agent is running", () => {
		const onStop = vi.fn();
		render(
			<AgentComposer
				onStop={onStop}
				onSubmit={vi.fn()}
				onValueChange={vi.fn()}
				running
				value=""
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Stop the current run" }),
		);
		expect(onStop).toHaveBeenCalledOnce();
	});

	it("disables every composer action when the composer is disabled", () => {
		const onSubmit = vi.fn();
		render(
			<AgentComposer
				disabled
				onSubmit={onSubmit}
				onValueChange={vi.fn()}
				value="Build the feature"
			/>,
		);

		const submit = screen.getByRole("button", { name: "Send message" });
		expect((submit as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(submit);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("selects a searchable option", () => {
		const onValueChange = vi.fn();
		render(
			<SearchCombobox
				ariaLabel="Repository"
				onValueChange={onValueChange}
				options={[
					{ label: "cline/cline", value: "https://github.com/cline/cline" },
					{
						label: "cline/core-platform",
						value: "https://github.com/cline/core-platform",
					},
				]}
			/>,
		);

		const trigger = screen.getByRole("combobox", { name: "Repository" });
		expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
		fireEvent.click(trigger);
		const search = document.querySelector(".cline-ui-combobox__search");
		expect(search?.closest(".cline-ui-theme")).toBeTruthy();
		if (!search) throw new Error("Search input was not rendered");
		fireEvent.change(search, {
			target: { value: "core-platform" },
		});
		fireEvent.click(screen.getByText("cline/core-platform"));
		expect(onValueChange).toHaveBeenCalledWith(
			"https://github.com/cline/core-platform",
		);
	});

	it("exposes activity details through an accessible disclosure", () => {
		render(<AgentActivity detail="npm test" label="Running command" />);
		const trigger = screen.getByRole("button", { name: "Running command" });
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("npm test")).toBeTruthy();
	});

	it("renders activity without details as status text instead of a button", () => {
		render(<AgentActivity label="Checking repository" />);
		expect(
			screen.queryByRole("button", { name: "Checking repository" }),
		).toBeNull();
		const label = screen.getByText("Checking repository");
		expect(label).toBeTruthy();
		expect(label.closest(".cline-ui-activity__trigger--static")).toBeTruthy();
	});

	it("routes approval decisions without owning transport", () => {
		const onApprove = vi.fn();
		const onReject = vi.fn();
		render(
			<AgentApprovalCard
				onApprove={onApprove}
				onReject={onReject}
				title="Run a command?"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Approve" }));
		fireEvent.click(screen.getByRole("button", { name: "Reject" }));
		expect(onApprove).toHaveBeenCalledOnce();
		expect(onReject).toHaveBeenCalledOnce();
	});

	it("confirms destructive actions without owning state", () => {
		const onConfirm = vi.fn();
		const onOpenChange = vi.fn();
		render(
			<ConfirmDialog
				danger
				description="This cannot be undone."
				onConfirm={onConfirm}
				onOpenChange={onOpenChange}
				open
				title="Delete session?"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
		expect(onConfirm).toHaveBeenCalledOnce();
		expect(screen.getByText("This cannot be undone.")).toBeTruthy();
		expect(
			screen.getByRole("dialog").classList.contains("cline-ui-theme"),
		).toBe(true);
	});

	it("keeps a loading confirmation dialog open during dismissal attempts", () => {
		const onOpenChange = vi.fn();
		const { rerender } = render(
			<ConfirmDialog
				loading
				onConfirm={vi.fn()}
				onOpenChange={onOpenChange}
				open
				title="Delete session?"
			/>,
		);

		fireEvent.keyDown(document, { key: "Escape" });
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(screen.getByRole("dialog")).toBeTruthy();

		rerender(
			<ConfirmDialog
				onConfirm={vi.fn()}
				onOpenChange={onOpenChange}
				open
				title="Delete session?"
			/>,
		);
		fireEvent.keyDown(document, { key: "Escape" });
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("provides composable surface, status, button, and quick actions", () => {
		const onSelect = vi.fn();
		render(
			<AgentSurface>
				<SessionStatus label="Running" tone="running" />
				<Button>New session</Button>
				<AgentQuickActions
					actions={[
						{
							description: "Inspect the selected repository",
							id: "review",
							label: "Review this repository",
							value: "Review this repository",
						},
					]}
					onSelect={onSelect}
				/>
			</AgentSurface>,
		);

		expect(screen.getByText("Running")).toBeTruthy();
		fireEvent.click(screen.getByText("Review this repository"));
		expect(onSelect).toHaveBeenCalledWith(
			expect.objectContaining({ id: "review" }),
		);
	});

	it("composes link buttons through a single slot child", () => {
		render(
			<Button asChild>
				<a href="/integrations">Connect GitHub</a>
			</Button>,
		);
		expect(screen.getByRole("link", { name: "Connect GitHub" })).toBeTruthy();
	});

	it("prevents disabled slot links from navigating or firing handlers", () => {
		const onClick = vi.fn();
		render(
			<Button asChild disabled>
				<a href="/integrations" onClick={onClick}>
					Connect GitHub
				</a>
			</Button>,
		);
		const link = screen.getByRole("link", { name: "Connect GitHub" });
		expect(link.getAttribute("aria-disabled")).toBe("true");
		expect(link.getAttribute("tabindex")).toBe("-1");
		fireEvent.click(link);
		expect(onClick).not.toHaveBeenCalled();
	});

	it("shows progress and removes slot links from tab order while loading", () => {
		render(
			<Button asChild loading>
				<a href="/integrations">Connecting GitHub</a>
			</Button>,
		);

		const link = screen.getByRole("link", { name: "Connecting GitHub" });
		expect(link.getAttribute("aria-busy")).toBe("true");
		expect(link.getAttribute("tabindex")).toBe("-1");
		expect(link.querySelector(".cline-ui-spinner")).toBeTruthy();
	});
});
