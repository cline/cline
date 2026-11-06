// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SectionHeading } from "../components/section-heading.js";

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
async function render(node: ReactNode) {
	await act(async () => root.render(node));
}

describe("SectionHeading", () => {
	it("defaults to an h2 and keeps a zero count visible outside the heading", async () => {
		await render(<SectionHeading title="Skills" count={0} />);
		expect(container.querySelector("h2")?.textContent).toBe("Skills");
		expect(
			container.querySelector('[data-slot="section-heading-count"]')
				?.textContent,
		).toBe("0");
		expect(
			container.querySelector("h2 [data-slot='section-heading-count']"),
		).toBeNull();
		expect(
			container.querySelector('[data-slot="section-heading-actions"]'),
		).toBeNull();
	});

	it("keeps the heading hierarchy independent of visual size and supports composed titles", async () => {
		await render(
			<SectionHeading
				title={<em>Connected accounts</em>}
				size="2xl"
				headingLevel={4}
			/>,
		);
		expect(container.querySelector("h4 em")?.textContent).toBe(
			"Connected accounts",
		);
		expect(container.querySelector("h2")).toBeNull();
		expect(
			container.querySelector('[data-slot="section-heading-count"]'),
		).toBeNull();
	});
});
