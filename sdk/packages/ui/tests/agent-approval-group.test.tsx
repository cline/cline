// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentApprovalGroup } from "../components/agent-approval-group";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

async function render(element: React.ReactNode) {
	await act(async () => root.render(element));
}

describe("@cline/ui agent approval group", () => {
	it("labels the section by its heading", async () => {
		await render(
			<AgentApprovalGroup title="Tool approval required">
				<div>card</div>
			</AgentApprovalGroup>,
		);

		const section = container.querySelector(
			"section.cline-ui-agent-approval-group",
		);
		const heading = container.querySelector(
			".cline-ui-agent-approval-group__heading",
		);
		expect(section?.getAttribute("aria-labelledby")).toBe(heading?.id);
		expect(heading?.textContent).toContain("Tool approval required");
	});

	it("renders the default shield icon and swaps it for the icon slot", async () => {
		await render(
			<AgentApprovalGroup title="Approvals">
				<div>card</div>
			</AgentApprovalGroup>,
		);
		expect(
			container.querySelector(".cline-ui-agent-approval-group__icon"),
		).not.toBeNull();

		await render(
			<AgentApprovalGroup
				icon={<span data-testid="custom-icon" />}
				title="Approvals"
			>
				<div>card</div>
			</AgentApprovalGroup>,
		);
		expect(
			container.querySelector(".cline-ui-agent-approval-group__icon"),
		).toBeNull();
		expect(
			container.querySelector('[data-testid="custom-icon"]'),
		).not.toBeNull();
		expect(
			container.querySelector(
				".cline-ui-agent-approval-group__heading [data-testid='custom-icon']",
			),
		).toBeNull();
	});

	it("renders the description only when provided and stacks children", async () => {
		await render(
			<AgentApprovalGroup title="Approvals">
				<div>first</div>
				<div>second</div>
			</AgentApprovalGroup>,
		);
		expect(
			container.querySelector(".cline-ui-agent-approval-group__intro"),
		).toBeNull();

		await render(
			<AgentApprovalGroup
				description="Review each tool call before execution."
				title="Approvals"
			>
				<div>first</div>
				<div>second</div>
			</AgentApprovalGroup>,
		);
		expect(
			container.querySelector(".cline-ui-agent-approval-group__intro")
				?.textContent,
		).toBe("Review each tool call before execution.");
		expect(
			container.querySelector(".cline-ui-agent-approval-group__items")?.children
				.length,
		).toBe(2);
	});
});
