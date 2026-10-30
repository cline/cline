// @vitest-environment jsdom

import { act, type FocusEvent, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PillSelector, PillSelectorItem } from "../components/pill-selector.js";

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

async function render(node: ReactNode) {
	await act(async () => root.render(node));
}

function item(label: string) {
	const element = Array.from(
		container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
	).find((button) => button.textContent === label);
	if (!element) throw new Error(`Expected category ${label}`);
	return element;
}

async function pressKey(element: HTMLElement, key: string) {
	await act(async () => {
		element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
		// Radix moves roving focus after the key event has finished.
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

describe("PillSelector", () => {
	it("selects one uncontrolled category and emits an empty value on reselection", async () => {
		const onValueChange = vi.fn();
		await render(
			<PillSelector
				aria-label="Categories"
				defaultValue="all"
				onValueChange={onValueChange}
			>
				<PillSelectorItem value="all">All</PillSelectorItem>
				<PillSelectorItem value="skills">Skills</PillSelectorItem>
			</PillSelector>,
		);

		expect(
			container.querySelector('[role="group"]')?.getAttribute("aria-label"),
		).toBe("Categories");
		expect(item("All").getAttribute("aria-checked")).toBe("true");
		expect(item("Skills").type).toBe("button");
		await act(async () => item("Skills").click());
		expect(item("Skills").getAttribute("aria-checked")).toBe("true");
		expect(item("All").getAttribute("aria-checked")).toBe("false");
		expect(onValueChange).toHaveBeenNthCalledWith(1, "skills");

		await act(async () => item("Skills").click());
		expect(item("Skills").getAttribute("aria-checked")).toBe("false");
		expect(onValueChange).toHaveBeenNthCalledWith(2, "");
	});

	it("leaves controlled selection with the host, including rejected deselection", async () => {
		const onValueChange = vi.fn();
		const selector = (value: string) => (
			<PillSelector
				aria-label="Categories"
				onValueChange={onValueChange}
				value={value}
			>
				<PillSelectorItem value="all">All</PillSelectorItem>
				<PillSelectorItem value="skills">Skills</PillSelectorItem>
			</PillSelector>
		);
		await render(selector("all"));
		await act(async () => item("Skills").click());
		expect(onValueChange).toHaveBeenNthCalledWith(1, "skills");
		expect(item("All").getAttribute("aria-checked")).toBe("true");
		expect(item("Skills").getAttribute("aria-checked")).toBe("false");

		await render(selector("skills"));
		expect(item("Skills").getAttribute("aria-checked")).toBe("true");
		await act(async () => item("Skills").click());
		expect(onValueChange).toHaveBeenNthCalledWith(2, "");
		expect(item("Skills").getAttribute("aria-checked")).toBe("true");
	});

	it.each([
		false,
		true,
	])("prevents disabled activation with group disabled=%s", async (disabled) => {
		const onValueChange = vi.fn();
		await render(
			<PillSelector
				aria-label="Categories"
				defaultValue="all"
				disabled={disabled}
				onValueChange={onValueChange}
			>
				<PillSelectorItem value="all">All</PillSelectorItem>
				<PillSelectorItem disabled value="plugins">
					Plugins
				</PillSelectorItem>
			</PillSelector>,
		);
		expect(item("All").disabled).toBe(disabled);
		expect(item("Plugins").disabled).toBe(true);
		await act(async () => item("Plugins").click());
		if (disabled) await act(async () => item("All").click());
		expect(onValueChange).not.toHaveBeenCalled();
		expect(item("All").getAttribute("aria-checked")).toBe("true");
	});

	it("forwards group and item refs, attributes, and styling", async () => {
		let groupRef: HTMLDivElement | null = null;
		let itemRef: HTMLButtonElement | null = null;
		await render(
			<PillSelector
				aria-describedby="category-help"
				aria-label="Categories"
				className="consumer-group"
				dir="rtl"
				ref={(node) => {
					groupRef = node;
				}}
				style={{ maxWidth: "20rem" }}
			>
				<PillSelectorItem
					className="consumer-item"
					id="all-category"
					ref={(node) => {
						itemRef = node;
					}}
					style={{ paddingInline: "1rem" }}
					title="Every category"
					value="all"
				>
					All
				</PillSelectorItem>
			</PillSelector>,
		);
		const group = container.querySelector<HTMLElement>('[role="group"]');
		expect(groupRef).toBe(group);
		expect(itemRef).toBe(item("All"));
		expect(group?.dir).toBe("rtl");
		expect(group?.getAttribute("aria-describedby")).toBe("category-help");
		expect(group?.classList.contains("consumer-group")).toBe(true);
		expect(group?.style.maxWidth).toBe("20rem");
		expect(item("All").classList.contains("consumer-item")).toBe(true);
		expect(item("All").style.paddingInline).toBe("1rem");
		expect(item("All").id).toBe("all-category");
		expect(item("All").title).toBe("Every category");
	});

	it.each([
		false,
		true,
	])("forwards focus before scrolling unless prevented=%s", async (preventDefault) => {
		const calls: string[] = [];
		const onFocus = vi.fn((event: FocusEvent<HTMLButtonElement>) => {
			calls.push("focus");
			expect(event.currentTarget).toBe(item("Skills"));
			if (preventDefault) event.preventDefault();
		});
		await render(
			<PillSelector aria-label="Categories">
				<PillSelectorItem onFocus={onFocus} value="skills">
					Skills
				</PillSelectorItem>
			</PillSelector>,
		);
		// Mock only this DOM node so the global prototype needs no restoration.
		const scrollIntoView = vi.fn(() => {
			calls.push("scroll");
		});
		item("Skills").scrollIntoView = scrollIntoView;
		await act(async () => item("Skills").focus());
		expect(onFocus).toHaveBeenCalledOnce();
		if (preventDefault) {
			expect(scrollIntoView).not.toHaveBeenCalled();
			expect(calls).toEqual(["focus"]);
		} else {
			expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({
				block: "nearest",
				inline: "nearest",
			});
			expect(calls).toEqual(["focus", "scroll"]);
		}
	});

	it("moves keyboard focus past disabled items and loops without changing selection", async () => {
		const onValueChange = vi.fn();
		await render(
			<PillSelector
				aria-label="Categories"
				defaultValue="all"
				onValueChange={onValueChange}
			>
				<PillSelectorItem value="all">All</PillSelectorItem>
				<PillSelectorItem disabled value="plugins">
					Plugins
				</PillSelectorItem>
				<PillSelectorItem value="skills">Skills</PillSelectorItem>
				<PillSelectorItem value="mcp">MCP</PillSelectorItem>
			</PillSelector>,
		);
		await act(async () => item("All").focus());
		await pressKey(item("All"), "ArrowRight");
		expect(document.activeElement).toBe(item("Skills"));
		await pressKey(item("Skills"), "End");
		expect(document.activeElement).toBe(item("MCP"));
		await pressKey(item("MCP"), "ArrowRight");
		expect(document.activeElement).toBe(item("All"));
		await pressKey(item("All"), "ArrowLeft");
		expect(document.activeElement).toBe(item("MCP"));
		await pressKey(item("MCP"), "Home");
		expect(document.activeElement).toBe(item("All"));
		expect(item("All").getAttribute("aria-checked")).toBe("true");
		expect(onValueChange).not.toHaveBeenCalled();
	});
});
