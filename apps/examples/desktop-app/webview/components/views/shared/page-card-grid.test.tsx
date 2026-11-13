// @vitest-environment jsdom

import { act, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PageCardGrid } from "./page-card-grid";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

it("omits nested fragments that contain no cards", async () => {
	await act(async () =>
		root.render(
			<PageCardGrid>
				<Fragment key="empty">{false}</Fragment>
			</PageCardGrid>,
		),
	);
	expect(container.childElementCount).toBe(0);
});

it("renders nested fragment content", async () => {
	await act(async () =>
		root.render(
			<PageCardGrid>
				<Fragment key="card">
					<div>Card</div>
				</Fragment>
			</PageCardGrid>,
		),
	);
	expect(container.textContent).toBe("Card");
});
