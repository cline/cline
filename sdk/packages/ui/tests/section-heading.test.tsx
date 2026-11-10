// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SectionHeading } from "../components/section-heading.js";
import { createDomFixture } from "./dom-test-utils.js";

const dom = createDomFixture();
const { render } = dom;

describe("SectionHeading", () => {
	it("defaults to an h2 and keeps a zero count visible outside the heading", async () => {
		await render(<SectionHeading title="Skills" count={0} />);
		expect(dom.container.querySelector("h2")?.textContent).toBe("Skills");
		expect(
			dom.container.querySelector('[data-slot="section-heading-count"]')
				?.textContent,
		).toBe("0");
		expect(
			dom.container.querySelector("h2 [data-slot='section-heading-count']"),
		).toBeNull();
		expect(
			dom.container.querySelector('[data-slot="section-heading-actions"]'),
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
		expect(dom.container.querySelector("h4 em")?.textContent).toBe(
			"Connected accounts",
		);
		expect(dom.container.querySelector("h2")).toBeNull();
		expect(
			dom.container.querySelector('[data-slot="section-heading-count"]'),
		).toBeNull();
	});
});
