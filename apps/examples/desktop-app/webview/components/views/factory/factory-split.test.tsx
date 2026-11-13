// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactoryParentLink, FactoryPartsPanel } from "./factory-split";

vi.mock("@/lib/desktop-client", () => ({ openExternalUrl: vi.fn() }));

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

const button = (text: string) => {
	const found = [...document.querySelectorAll("button")].find(
		(item) => item.textContent?.trim() === text,
	);
	if (!found) throw new Error(`Missing button ${text}`);
	return found;
};

describe("FactoryPartsPanel", () => {
	it("opens a part from its id and title together, with a plain status and a red cancel that confirms", async () => {
		const onOpenCard = vi.fn();
		const onCancelRemaining = vi.fn();
		await act(async () =>
			root.render(
				<FactoryPartsPanel
					rows={[
						{
							number: 1,
							title: "Add CSV export",
							card: {
								taskId: "p1",
								shortId: "F41",
								title: "Add CSV export",
								label: "Start anyway or cancel",
								tone: "attention",
							},
						},
						{ number: 2, title: "Link the export", missing: "Being created" },
					]}
					summary={{
						total: 2,
						delivered: 0,
						merged: 0,
						open: 2,
						needsYou: 1,
						stopped: 0,
						closed: 0,
					}}
					busy={false}
					onOpenCard={onOpenCard}
					onCancelRemaining={onCancelRemaining}
				/>,
			),
		);
		await act(async () => button("F41Add CSV export").click());
		expect(onOpenCard).toHaveBeenCalledWith("p1");
		expect(() => button("Link the export")).toThrow();

		const status = [...container.querySelectorAll("span")].find(
			(item) => item.textContent === "Start anyway or cancel",
		);
		expect(status?.className).toContain("text-muted-foreground");
		expect(status?.className).not.toContain("amber");

		const cancel = button("Cancel remaining parts…");
		expect(cancel.className).toContain("text-error-text");
		await act(async () => cancel.click());
		expect(onCancelRemaining).not.toHaveBeenCalled();
		await act(async () => button("Cancel parts").click());
		expect(onCancelRemaining).toHaveBeenCalledTimes(1);
	});
});

describe("FactoryParentLink", () => {
	it("is drawn in the link colour, not muted", async () => {
		await act(async () =>
			root.render(
				<FactoryParentLink
					parent={{ taskId: "parent", shortId: "F40", title: "Export" }}
					onOpen={vi.fn()}
				/>,
			),
		);
		const link = container.querySelector("[data-factory-parent]");
		expect(link?.className).toContain("text-accent-foreground");
		expect(link?.className).not.toContain("text-muted-foreground");
	});
});
