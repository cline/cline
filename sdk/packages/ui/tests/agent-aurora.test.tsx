// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentAurora } from "../components/index.js";

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
});

describe("AgentAurora", () => {
	it("renders the deterministic decorative field", async () => {
		await act(async () => root.render(<AgentAurora />));

		const aurora = container.querySelector(".cline-ui-agent-aurora");
		expect(aurora?.getAttribute("aria-hidden")).toBe("true");
		expect(
			aurora?.querySelectorAll(".cline-ui-agent-aurora__star"),
		).toHaveLength(32);
		const markup = aurora?.innerHTML;

		await act(async () => root.render(<AgentAurora />));
		expect(aurora?.innerHTML).toBe(markup);
	});

	it("disables animation for reduced motion", () => {
		const css = readFileSync(
			join(process.cwd(), "components/agent-aurora.css"),
			"utf8",
		);

		expect(css).toContain("@media (prefers-reduced-motion: reduce)");
		expect(css).toContain("animation: none !important");
	});
});
