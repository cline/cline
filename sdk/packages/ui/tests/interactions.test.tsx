// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentApprovalCard, AgentComposer } from "../src/index.js";

afterEach(cleanup);

describe("@cline/ui agent interactions", () => {
	it("submits with Enter while preserving Shift + Enter", () => {
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

		fireEvent.keyDown(screen.getByRole("textbox"), {
			isComposing: true,
			key: "Enter",
		});
		expect(onSubmit).not.toHaveBeenCalled();

		fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
		expect(onSubmit).toHaveBeenCalledOnce();
		expect(screen.getByRole("textbox").getAttribute("autocomplete")).toBe(
			"off",
		);
		expect(screen.getByRole("textbox").getAttribute("name")).toBe("prompt");
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
		expect(screen.getByRole("region", { name: "Run a command?" })).toBeTruthy();
	});
});
