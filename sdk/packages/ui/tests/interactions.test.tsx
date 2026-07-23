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

		const textbox = screen.getByRole("textbox");
		fireEvent.compositionStart(textbox);
		fireEvent.compositionEnd(textbox);
		fireEvent.keyDown(textbox, {
			key: "Enter",
			keyCode: 229,
		});
		expect(onSubmit).not.toHaveBeenCalled();

		fireEvent.keyDown(screen.getByRole("textbox"), {
			key: "Enter",
			repeat: true,
		});
		expect(onSubmit).not.toHaveBeenCalled();

		fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
		expect(onSubmit).toHaveBeenCalledOnce();
		expect(screen.getByRole("textbox").getAttribute("autocomplete")).toBe(
			"off",
		);
		expect(screen.getByRole("textbox").getAttribute("name")).toBe("prompt");
		expect(screen.getByRole("textbox").getAttribute("enterkeyhint")).toBe(
			"send",
		);
	});

	it("supports multiline Enter semantics", () => {
		const onSubmit = vi.fn();
		render(
			<AgentComposer
				onSubmit={onSubmit}
				onValueChange={vi.fn()}
				submitOnEnter={false}
				value="Build the feature"
			/>,
		);

		const textbox = screen.getByRole("textbox");
		expect(fireEvent.keyDown(textbox, { key: "Enter" })).toBe(true);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(textbox.getAttribute("enterkeyhint")).toBe("enter");
	});

	it("auto-resizes as its controlled value grows", () => {
		const { rerender } = render(
			<AgentComposer
				onSubmit={vi.fn()}
				onValueChange={vi.fn()}
				value="One line"
			/>,
		);
		const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
		Object.defineProperty(textbox, "scrollHeight", {
			configurable: true,
			value: 120,
		});

		rerender(
			<AgentComposer
				onSubmit={vi.fn()}
				onValueChange={vi.fn()}
				value={"One line\nTwo lines"}
			/>,
		);
		expect(textbox.style.height).toBe("120px");
	});

	it("preserves draft focus while loading", () => {
		const props = {
			onSubmit: vi.fn(),
			onValueChange: vi.fn(),
			value: "Build the feature",
		};
		const { rerender } = render(<AgentComposer {...props} />);
		const textbox = screen.getByRole("textbox") as HTMLTextAreaElement;
		textbox.focus();

		rerender(<AgentComposer {...props} loading />);

		expect(document.activeElement).toBe(textbox);
		expect(textbox.disabled).toBe(false);
		expect(textbox.readOnly).toBe(true);
		expect(textbox.getAttribute("aria-busy")).toBe("true");
	});

	it("renders a stop action while an agent is running", () => {
		const onStop = vi.fn();
		render(
			<AgentComposer
				onStop={onStop}
				onSubmit={vi.fn()}
				onValueChange={vi.fn()}
				running
				stopLabel="Stop generation"
				value=""
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Stop generation" }));
		expect(onStop).toHaveBeenCalledOnce();
	});

	it("allows a newline instead of swallowing Enter while running", () => {
		const onKeyDown = vi.fn();
		const onSubmit = vi.fn();
		render(
			<AgentComposer
				onKeyDown={onKeyDown}
				onSubmit={onSubmit}
				onValueChange={vi.fn()}
				running
				value="Continue working"
			/>,
		);

		const accepted = fireEvent.keyDown(screen.getByRole("textbox"), {
			key: "Enter",
		});
		expect(accepted).toBe(true);
		expect(onKeyDown.mock.calls[0][0].defaultPrevented).toBe(false);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("does not show a disabled stop control when stopping is unsupported", () => {
		render(
			<AgentComposer
				onSubmit={vi.fn()}
				onValueChange={vi.fn()}
				running
				value="Continue working"
			/>,
		);

		expect(screen.queryByRole("button")).toBeNull();
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(
			false,
		);
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

	it("disables empty submissions", () => {
		render(
			<AgentComposer onSubmit={vi.fn()} onValueChange={vi.fn()} value="   " />,
		);
		expect(
			(
				screen.getByRole("button", {
					name: "Send message",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("claims one approval decision without owning transport", () => {
		const onApprove = vi.fn();
		const onReject = vi.fn();
		const first = render(
			<AgentApprovalCard
				onApprove={onApprove}
				onReject={onReject}
				title="Run a command?"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Approve" }));
		fireEvent.click(screen.getByRole("button", { name: "Approve" }));
		fireEvent.click(screen.getByRole("button", { name: "Reject" }));
		expect(onApprove).toHaveBeenCalledOnce();
		expect(onReject).not.toHaveBeenCalled();
		expect(screen.getByRole("region", { name: "Run a command?" })).toBeTruthy();

		first.unmount();
		render(
			<AgentApprovalCard
				onApprove={onApprove}
				onReject={onReject}
				title="Delete a file?"
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Reject" }));
		expect(onReject).toHaveBeenCalledOnce();
	});

	it.each([
		["approve", "Approve", "Reject"],
		["reject", "Reject", "Approve"],
	] as const)("shows progress on the %s action", (responding, busyAction, inactiveAction) => {
		render(
			<AgentApprovalCard
				onApprove={vi.fn()}
				onReject={vi.fn()}
				responding={responding}
				title="Run a command?"
			/>,
		);

		expect(
			screen
				.getByRole("button", { name: busyAction })
				.getAttribute("aria-busy"),
		).toBe("true");
		expect(
			(
				screen.getByRole("button", {
					name: inactiveAction,
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});
});
