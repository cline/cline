// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AgentQuickAction,
	AgentQuickActions,
} from "../components/index.js";

const action: AgentQuickAction = {
	description: "Review the current changes and call out anything risky.",
	id: "review-changes",
	label: "Review changes",
	value: "Review the current changes and call out anything risky.",
};

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

describe("AgentQuickActions", () => {
	it("reports the selected action without owning task state", async () => {
		const onSelect = vi.fn();
		await act(async () =>
			root.render(<AgentQuickActions actions={[action]} onSelect={onSelect} />),
		);

		await act(async () =>
			container.querySelector<HTMLButtonElement>("button")?.click(),
		);

		expect(onSelect).toHaveBeenCalledWith(action);
	});

	it("does not render empty actions and disables populated actions", async () => {
		await act(async () =>
			root.render(
				<AgentQuickActions actions={[action]} disabled onSelect={vi.fn()} />,
			),
		);
		expect(container.querySelector("button")?.disabled).toBe(true);

		await act(async () =>
			root.render(<AgentQuickActions actions={[]} onSelect={vi.fn()} />),
		);
		expect(container.firstElementChild).toBeNull();
	});
});
