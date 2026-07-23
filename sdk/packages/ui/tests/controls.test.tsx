// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, SessionStatus } from "../src/index.js";

afterEach(cleanup);

describe("@cline/ui controls", () => {
	it("names icon-only controls", () => {
		render(
			<Button aria-label="Create session" iconOnly>
				<span aria-hidden="true">+</span>
			</Button>,
		);
		expect(screen.getByRole("button", { name: "Create session" })).toBeTruthy();
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

	it("keeps slotted native buttons from submitting forms by default", () => {
		const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
		render(
			<form onSubmit={onSubmit}>
				<Button asChild>
					<button>Open</button>
				</Button>
			</form>,
		);

		const button = screen.getByRole("button", { name: "Open" });
		expect(button.getAttribute("type")).toBe("button");
		fireEvent.click(button);
		expect(onSubmit).not.toHaveBeenCalled();
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
