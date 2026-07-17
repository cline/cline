import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AgentActivity,
	AgentApprovalCard,
	AgentComposer,
	AgentQuickActions,
	AgentSurface,
	Button,
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

		fireEvent.click(screen.getByRole("button", { name: "Repository" }));
		fireEvent.change(screen.getByRole("combobox"), {
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
});
