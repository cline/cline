// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "../components/segmented-control.js";

const options = [
	{ value: "system", label: "System", icon: <svg /> },
	{ value: "light", label: "Light", icon: <svg /> },
	{ value: "dark", label: "Dark", icon: <svg /> },
] as const;

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

function input(value: string, scope: ParentNode = container) {
	const element = Array.from(
		scope.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
	).find((radio) => radio.value === value);
	if (!element) throw new Error(`Expected option ${value}`);
	return element;
}

function fieldset() {
	const element = container.querySelector("fieldset");
	if (!element) throw new Error("Expected a segmented control fieldset");
	return element;
}

function form() {
	const element = container.querySelector("form");
	if (!element) throw new Error("Expected a form");
	return element;
}

describe("SegmentedControl", () => {
	it.each([
		false,
		true,
	])("labels native radios with iconOnly=%s and hides duplicate visual content", async (iconOnly) => {
		await render(
			<SegmentedControl
				aria-label="Color theme"
				defaultValue="system"
				iconOnly={iconOnly}
				options={options}
			/>,
		);
		expect(fieldset().getAttribute("aria-label")).toBe("Color theme");
		for (const option of options) {
			expect(input(option.value).labels?.[0]?.textContent).toBe(option.label);
		}
		const overlay = container.querySelector(
			'[data-slot="segmented-control-active"]',
		);
		expect(overlay?.getAttribute("aria-hidden")).toBe("true");
		expect(overlay?.querySelector("input, button, a")).toBeNull();
		await act(async () => input("dark").labels?.[0]?.click());
		expect(input("dark").checked).toBe(true);
	});

	it("selects one uncontrolled option and leaves it selected on reselection", async () => {
		const onValueChange = vi.fn();
		await render(
			<SegmentedControl
				aria-label="Color theme"
				defaultValue="system"
				onValueChange={onValueChange}
				options={options}
			/>,
		);
		expect(input("system").checked).toBe(true);
		await act(async () => input("light").click());
		expect(input("light").checked).toBe(true);
		expect(input("system").checked).toBe(false);
		expect(onValueChange).toHaveBeenCalledExactlyOnceWith("light");
		await act(async () => input("light").click());
		expect(input("light").checked).toBe(true);
		expect(onValueChange).toHaveBeenCalledOnce();
	});

	it("keeps controlled selection owned by the consumer", async () => {
		const onValueChange = vi.fn();
		const control = (value: string) => (
			<SegmentedControl
				aria-label="Color theme"
				onValueChange={onValueChange}
				options={options}
				value={value}
			/>
		);
		await render(control("system"));
		await act(async () => input("dark").click());
		expect(onValueChange).toHaveBeenCalledExactlyOnceWith("dark");
		expect(input("system").checked).toBe(true);
		expect(input("dark").checked).toBe(false);
		await render(control("dark"));
		expect(input("system").checked).toBe(false);
		expect(input("dark").checked).toBe(true);
	});

	it("retains selection when the selected option is removed and restored", async () => {
		const onValueChange = vi.fn();
		const control = (includeDark: boolean) => (
			<SegmentedControl
				aria-label="Color theme"
				defaultValue="system"
				onValueChange={onValueChange}
				options={includeDark ? options : options.slice(0, 2)}
			/>
		);
		await render(control(true));
		await act(async () => input("dark").click());
		await render(control(false));
		expect(container.querySelector("input:checked")).toBeNull();
		expect(
			container.querySelector('[data-slot="segmented-control-active"]'),
		).toBeNull();

		await render(control(true));
		expect(input("dark").checked).toBe(true);
		expect(input("system").checked).toBe(false);
		expect(
			container.querySelector('[data-slot="segmented-control-active"]'),
		).not.toBeNull();
		expect(
			fieldset().style.getPropertyValue("--cline-ui-segmented-index"),
		).toBe("2");
		expect(onValueChange).toHaveBeenCalledExactlyOnceWith("dark");
	});

	it.each([
		false,
		true,
	])("prevents disabled choices with group disabled=%s", async (disabled) => {
		const onValueChange = vi.fn();
		await render(
			<SegmentedControl
				aria-label="Color theme"
				defaultValue="system"
				disabled={disabled}
				onValueChange={onValueChange}
				options={[options[0], { ...options[1], disabled: true }, options[2]]}
			/>,
		);
		expect(input("light").matches(":disabled")).toBe(true);
		expect(input("dark").matches(":disabled")).toBe(disabled);
		await act(async () => input("light").click());
		if (disabled) await act(async () => input("dark").click());
		expect(onValueChange).not.toHaveBeenCalled();
		expect(input("system").checked).toBe(true);
	});

	it("keeps independently generated radio groups separate", async () => {
		await render(
			<>
				<SegmentedControl
					aria-label="Editor theme"
					defaultValue="system"
					options={options}
				/>
				<SegmentedControl
					aria-label="Preview theme"
					defaultValue="system"
					options={options}
				/>
			</>,
		);
		const groups = container.querySelectorAll("fieldset");
		const first = groups[0];
		const second = groups[1];
		if (!first || !second) throw new Error("Expected two segmented controls");
		expect(input("system", first).name).not.toBe("");
		expect(input("system", first).name).not.toBe(input("system", second).name);
		expect(input("light", first).name).toBe(input("system", first).name);
		await act(async () => input("dark", first).click());
		expect(input("dark", first).checked).toBe(true);
		expect(input("system", second).checked).toBe(true);
	});

	it("supports an external form, explicit field name, and required validation", async () => {
		await render(
			<>
				<form id="preferences" />
				<SegmentedControl
					aria-label="Color theme"
					form="preferences"
					name="theme"
					options={options}
					required
				/>
			</>,
		);
		expect(form().checkValidity()).toBe(false);
		expect(new FormData(form()).has("theme")).toBe(false);
		for (const option of options) {
			expect(input(option.value).name).toBe("theme");
			expect(input(option.value).form).toBe(form());
		}
		await act(async () => input("light").click());
		expect(form().checkValidity()).toBe(true);
		expect(new FormData(form()).getAll("theme")).toEqual(["light"]);
	});

	it("resets uncontrolled selection to its default without emitting a user change", async () => {
		const onValueChange = vi.fn();
		await render(
			<form>
				<SegmentedControl
					aria-label="Color theme"
					defaultValue="system"
					name="theme"
					onValueChange={onValueChange}
					options={options}
				/>
			</form>,
		);
		await act(async () => input("dark").click());
		expect(new FormData(form()).get("theme")).toBe("dark");
		await act(async () => form().reset());
		expect(input("system").checked).toBe(true);
		expect(input("dark").checked).toBe(false);
		expect(new FormData(form()).get("theme")).toBe("system");
		expect(
			fieldset().style.getPropertyValue("--cline-ui-segmented-index"),
		).toBe("0");
		expect(onValueChange).toHaveBeenCalledExactlyOnceWith("dark");
	});

	it("preserves the current controlled value when its form resets", async () => {
		const onValueChange = vi.fn();
		const control = (value: string) => (
			<form>
				<SegmentedControl
					aria-label="Color theme"
					name="theme"
					onValueChange={onValueChange}
					options={options}
					value={value}
				/>
			</form>
		);
		await render(control("system"));
		await render(control("dark"));
		await act(async () => form().reset());
		expect(input("dark").checked).toBe(true);
		expect(input("system").checked).toBe(false);
		expect(new FormData(form()).get("theme")).toBe("dark");
		expect(
			fieldset().style.getPropertyValue("--cline-ui-segmented-index"),
		).toBe("2");
		expect(onValueChange).not.toHaveBeenCalled();
	});

	it("honors a canceled form reset", async () => {
		await render(
			<form onReset={(event) => event.preventDefault()}>
				<SegmentedControl
					aria-label="Color theme"
					defaultValue="system"
					options={options}
				/>
			</form>,
		);
		await act(async () => input("dark").click());
		await act(async () => form().reset());
		expect(input("dark").checked).toBe(true);
		expect(input("system").checked).toBe(false);
	});

	it("inherits disabled fieldset behavior and omits its form value", async () => {
		const onValueChange = vi.fn();
		await render(
			<form>
				<fieldset disabled>
					<SegmentedControl
						aria-label="Color theme"
						defaultValue="system"
						name="theme"
						onValueChange={onValueChange}
						options={options}
					/>
				</fieldset>
			</form>,
		);
		expect(input("dark").matches(":disabled")).toBe(true);
		await act(async () => input("dark").click());
		expect(input("system").checked).toBe(true);
		expect(onValueChange).not.toHaveBeenCalled();
		expect(new FormData(form()).has("theme")).toBe(false);
	});

	it("forwards fieldset attributes, styling, and its ref", async () => {
		let forwardedRef: HTMLFieldSetElement | null = null;
		await render(
			<>
				<span id="theme-label">Color theme</span>
				<SegmentedControl
					aria-describedby="theme-help"
					aria-labelledby="theme-label"
					className="consumer-class"
					dir="rtl"
					id="theme-control"
					options={options}
					ref={(node) => {
						forwardedRef = node;
					}}
					style={{ maxWidth: "20rem" }}
				/>
			</>,
		);
		expect(forwardedRef).toBe(fieldset());
		expect(fieldset().getAttribute("aria-labelledby")).toBe("theme-label");
		expect(fieldset().getAttribute("aria-describedby")).toBe("theme-help");
		expect(fieldset().classList.contains("consumer-class")).toBe(true);
		expect(fieldset().style.maxWidth).toBe("20rem");
		expect(fieldset().dir).toBe("rtl");
		expect(fieldset().id).toBe("theme-control");
	});

	it("runs a React 19 callback ref cleanup when the control unmounts", async () => {
		const cleanup = vi.fn();
		const ref = vi.fn((node: HTMLFieldSetElement | null) => {
			if (node) return () => cleanup(node);
			return undefined;
		});
		const control = (value: string) => (
			<SegmentedControl
				aria-label="Color theme"
				options={options}
				ref={ref}
				value={value}
			/>
		);
		await render(control("system"));
		const element = fieldset();
		expect(ref).toHaveBeenCalledExactlyOnceWith(element);
		await render(control("dark"));
		expect(ref).toHaveBeenCalledOnce();
		expect(cleanup).not.toHaveBeenCalled();
		await render(null);
		expect(cleanup).toHaveBeenCalledExactlyOnceWith(element);
		expect(ref).toHaveBeenCalledOnce();
	});
});
