// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Switch } from "../components/index.js";

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

function input() {
	const element = container.querySelector<HTMLInputElement>("input");
	if (!element) throw new Error("Expected a switch input");
	return element;
}

function form() {
	const element = container.querySelector("form");
	if (!element) throw new Error("Expected a form");
	return element;
}

describe("Switch", () => {
	it("toggles uncontrolled state and reports the new boolean", async () => {
		const onCheckedChange = vi.fn();
		await render(
			<Switch aria-label="Notifications" onCheckedChange={onCheckedChange} />,
		);
		expect(input().type).toBe("checkbox");
		expect(input().getAttribute("role")).toBe("switch");
		expect(input().checked).toBe(false);
		await act(async () => input().click());
		expect(input().checked).toBe(true);
		expect(onCheckedChange).toHaveBeenNthCalledWith(1, true);
		await act(async () => input().click());
		expect(input().checked).toBe(false);
		expect(onCheckedChange).toHaveBeenNthCalledWith(2, false);
	});

	it("keeps controlled state owned by the consumer", async () => {
		const onCheckedChange = vi.fn();
		await render(<Switch checked={false} onCheckedChange={onCheckedChange} />);
		await act(async () => input().click());
		expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(true);
		expect(input().checked).toBe(false);
		await render(<Switch checked onCheckedChange={onCheckedChange} />);
		expect(input().checked).toBe(true);
	});

	it("supports external labels and label activation", async () => {
		await render(
			<>
				<Switch id="notifications" />
				<label htmlFor="notifications">Enable notifications</label>
			</>,
		);
		expect(input().labels?.[0]?.textContent).toBe("Enable notifications");
		await act(async () => input().labels?.[0]?.click());
		expect(input().checked).toBe(true);
	});

	it.each([false, true])("preserves disabled checked=%s", async (checked) => {
		const onCheckedChange = vi.fn();
		await render(
			<Switch
				defaultChecked={checked}
				disabled
				onCheckedChange={onCheckedChange}
			/>,
		);
		await act(async () => input().click());
		expect(input().checked).toBe(checked);
		expect(onCheckedChange).not.toHaveBeenCalled();
	});

	it("inherits disabled fieldset behavior", async () => {
		const onCheckedChange = vi.fn();
		await render(
			<form>
				<fieldset disabled>
					<Switch
						defaultChecked
						name="notifications"
						onCheckedChange={onCheckedChange}
					/>
				</fieldset>
			</form>,
		);
		expect(input().matches(":disabled")).toBe(true);
		await act(async () => input().click());
		expect(input().checked).toBe(true);
		expect(onCheckedChange).not.toHaveBeenCalled();
		expect(new FormData(form()).has("notifications")).toBe(false);
	});

	it("participates in forms and resets uncontrolled state", async () => {
		await render(
			<form>
				<Switch defaultChecked name="notifications" value="enabled" />
			</form>,
		);
		expect(new FormData(form()).get("notifications")).toBe("enabled");
		await act(async () => input().click());
		expect(new FormData(form()).has("notifications")).toBe(false);
		await act(async () => form().reset());
		expect(input().checked).toBe(true);
		expect(new FormData(form()).get("notifications")).toBe("enabled");
	});

	it("supports required validation and an external form", async () => {
		await render(
			<>
				<form id="preferences" />
				<Switch form="preferences" name="consent" required />
			</>,
		);
		expect(form().checkValidity()).toBe(false);
		await act(async () => input().click());
		expect(form().checkValidity()).toBe(true);
		expect(new FormData(form()).get("consent")).toBe("on");
	});

	it("forwards input attributes and ref, with wrapper customization", async () => {
		let forwardedRef: HTMLInputElement | null = null;
		await render(
			<Switch
				aria-describedby="help"
				aria-label="Notifications"
				className="consumer-class"
				ref={(node) => {
					forwardedRef = node;
				}}
				style={{ marginInlineStart: 8 }}
				tabIndex={-1}
			/>,
		);
		expect(forwardedRef).toBe(input());
		expect(input().getAttribute("aria-label")).toBe("Notifications");
		expect(input().getAttribute("aria-describedby")).toBe("help");
		expect(input().tabIndex).toBe(-1);
		expect(input().parentElement?.classList.contains("consumer-class")).toBe(
			true,
		);
		expect(input().parentElement?.style.marginInlineStart).toBe("8px");
	});

	it("calls native onChange before onCheckedChange", async () => {
		const changes: string[] = [];
		await render(
			<Switch
				onChange={(event) =>
					changes.push(`native:${event.currentTarget.checked}`)
				}
				onCheckedChange={(checked) => changes.push(`checked:${checked}`)}
			/>,
		);
		await act(async () => input().click());
		expect(changes).toEqual(["native:true", "checked:true"]);
	});

	it.each([
		"ltr",
		"rtl",
	])("applies explicit %s direction to the visual wrapper and input", async (dir) => {
		await render(<Switch aria-label="Notifications" dir={dir} />);
		expect(input().dir).toBe(dir);
		expect(input().parentElement?.dir).toBe(dir);
	});
});
