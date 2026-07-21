// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, ConfirmDialog, SessionStatus } from "../src/index.js";

afterEach(cleanup);

describe("@cline/ui controls", () => {
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
		expect(screen.getByRole("dialog").classList).toContain("cline-ui-theme");
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

	it("supports an accessible dot-only session status", () => {
		render(<SessionStatus label="Running" showLabel={false} tone="running" />);
		expect(screen.getByRole("status", { name: "Running" })).toBeTruthy();
		expect(screen.getByText("Running").classList).toContain("cline-ui-sr-only");
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
