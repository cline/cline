// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FactoryCardBoundary } from "./factory-card-boundary";
import { factoryWorkflowAgents } from "./factory-workflow-editor";

let root: Root;
let container: HTMLDivElement;
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

function Broken(): never {
	throw new Error("r[s].map is not a function");
}

it("keeps a card that cannot render to its own area, with the way back", async () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	const onBack = vi.fn();
	await act(async () =>
		root.render(
			<div>
				<nav>Rail</nav>
				<FactoryCardBoundary onBack={onBack}>
					<Broken />
				</FactoryCardBoundary>
			</div>,
		),
	);
	// The rest of the page is still there; the card says what happened.
	expect(container.textContent).toContain("Rail");
	const alert = container.querySelector('[role="alert"]');
	expect(alert?.textContent).toContain("This card could not be shown.");
	await act(async () => alert?.querySelector("button")?.click());
	expect(onBack).toHaveBeenCalledOnce();
});

it("reads a stored agents block without a role list as no agents in that role", () => {
	const partial = { designer: {}, reviewers: [{}] } as unknown as Parameters<
		typeof factoryWorkflowAgents
	>[0];
	expect(factoryWorkflowAgents(partial)).toMatchObject({
		implementers: [],
		planReviewers: [],
		reviewers: [{}],
	});
});
