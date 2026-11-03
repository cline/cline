// @vitest-environment jsdom
import {
	act,
	createElement,
	createRef,
	Fragment,
	type ReactNode,
	useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Button } from "../components/button.js";
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
			container
				.querySelector('[data-slot="section-heading"]')
				?.getAttribute("data-size"),
		).toBe("lg");
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
		expect(
			container
				.querySelector('[data-slot="section-heading"]')
				?.getAttribute("data-size"),
		).toBe("2xl");
	});

	it("leaves actions and resulting content controlled by the consumer", async () => {
		function Example() {
			const [expanded, setExpanded] = useState(false);
			return (
				<>
					<SectionHeading
						title="Available skills"
						count={8}
						actions={
							<Button
								variant="ghost"
								tone="neutral"
								size="sm"
								aria-expanded={expanded}
								aria-controls="all-skills"
								onClick={() => setExpanded(!expanded)}
							>
								{expanded ? "Show less" : "View all"}
							</Button>
						}
					/>
					<div id="all-skills" hidden={!expanded}>
						All available skills
					</div>
				</>
			);
		}
		await render(<Example />);
		const action = container.querySelector<HTMLButtonElement>("button");
		expect(action?.closest("h2")).toBeNull();
		expect(action?.type).toBe("button");
		expect(action?.getAttribute("aria-expanded")).toBe("false");
		await act(async () => action?.click());
		expect(action?.textContent).toBe("Show less");
		expect(action?.getAttribute("aria-expanded")).toBe("true");
		expect(container.querySelector<HTMLElement>("#all-skills")?.hidden).toBe(
			false,
		);
		expect(container.querySelector("h2")?.textContent).toBe("Available skills");
	});

	it("forwards root refs, classes, styles and native attributes", async () => {
		const ref = createRef<HTMLDivElement>();
		await render(
			<SectionHeading
				ref={ref}
				title="Plugins"
				id="plugins-heading"
				className="host-heading"
				style={{ maxWidth: 320 }}
				aria-label="Plugin section"
				data-host="customize"
				hidden
			/>,
		);
		expect(ref.current).toBe(container.firstElementChild);
		expect(ref.current?.id).toBe("plugins-heading");
		expect(ref.current?.classList.contains("cline-ui-section-heading")).toBe(
			true,
		);
		expect(ref.current?.classList.contains("host-heading")).toBe(true);
		expect(ref.current?.style.maxWidth).toBe("320px");
		expect(ref.current?.getAttribute("aria-label")).toBe("Plugin section");
		expect(ref.current?.dataset.host).toBe("customize");
		expect(ref.current?.hidden).toBe(true);
	});

	it("omits empty composed slots and preserves numeric supporting content", async () => {
		await render(
			<SectionHeading
				title="Skills"
				description={createElement(Fragment, null, ["", null, false])}
				actions={createElement(
					Fragment,
					null,
					createElement(Fragment, null, false),
				)}
			/>,
		);
		expect(
			container.querySelector(
				"[data-slot='section-heading-description'], [data-slot='section-heading-actions']",
			),
		).toBeNull();
		await render(<SectionHeading title="Skills" description={0} />);
		expect(
			container.querySelector("[data-slot='section-heading-description']")
				?.textContent,
		).toBe("0");
	});
});
