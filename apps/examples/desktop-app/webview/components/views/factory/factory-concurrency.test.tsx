// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactorySpendingField } from "./factory-concurrency";

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

function input(): HTMLInputElement {
	const found = container.querySelector("input");
	if (!found) throw new Error("Missing input");
	return found;
}
function type(value: string) {
	const field = input();
	Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set?.call(field, value);
	field.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("FactorySpendingField", () => {
	it("re-syncs when the saved value changes from outside", async () => {
		const onApply = vi.fn();
		const render = (value: number | null) =>
			root.render(
				<FactorySpendingField
					before="Stop a card after $"
					hint="hint"
					invalidMessage="bad"
					value={value}
					min={0.01}
					max={1000}
					disabled={false}
					showNoLimit
					onApply={onApply}
				/>,
			);
		await act(async () => render(10));
		expect(input().value).toBe("10");
		await act(async () => render(50));
		expect(input().value).toBe("50");
		await act(async () => type("0"));
		expect(container.textContent).toContain("bad");
		expect(onApply).not.toHaveBeenCalled();
		await act(async () => type("12.5"));
		expect(onApply).toHaveBeenCalledWith(12.5);
	});
});
