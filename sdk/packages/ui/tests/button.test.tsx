// @vitest-environment jsdom

import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { Plus, X } from "lucide-react";
import {
	act,
	type CSSProperties,
	createRef,
	type ReactNode,
	type SVGProps,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	Button,
	buttonVariants,
	IconButton,
	iconButtonVariants,
} from "../components/index.js";

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

function CustomIcon(props: SVGProps<SVGSVGElement>) {
	return (
		// biome-ignore lint/a11y/noSvgWithoutTitle: Button supplies aria-hidden to decorative icon components.
		<svg viewBox="0 0 24 24" {...props}>
			<path d="M4 12h16" />
		</svg>
	);
}

describe("Button", () => {
	it("defaults to a non-submitting button", async () => {
		await render(<Button>Continue</Button>);
		const button = container.querySelector("button");
		expect(button?.type).toBe("button");
		expect(button?.dataset.slot).toBe("button");
	});

	it("forwards native props, refs, and decisions", async () => {
		const onClick = vi.fn();
		const forwardedRef = createRef<HTMLButtonElement>();
		await render(
			<Button
				className="consumer-class"
				leadingIcon={Plus}
				onClick={onClick}
				ref={forwardedRef}
			>
				Delete
			</Button>,
		);
		const element = container.querySelector<HTMLButtonElement>("button");
		expect(forwardedRef.current).toBe(element);
		expect(element?.className).toContain("consumer-class");
		await act(async () => element?.click());
		expect(onClick).toHaveBeenCalledOnce();
	});

	it("supports explicit form submission", async () => {
		const onSubmit = vi.fn((event) => event.preventDefault());
		await render(
			<form onSubmit={onSubmit}>
				<Button leadingIcon={Plus} type="submit">
					Save
				</Button>
			</form>,
		);
		await act(async () => container.querySelector("button")?.click());
		expect(onSubmit).toHaveBeenCalledOnce();
	});

	it("supports composition through asChild", async () => {
		await render(
			<Button asChild leadingIcon={Plus} trailingIcon={X} variant="ghost">
				<a href="/settings">Settings</a>
			</Button>,
		);
		const link = container.querySelector("a");
		expect(link?.getAttribute("href")).toBe("/settings");
		expect(link?.dataset.slot).toBe("button");
		expect(container.querySelector("button")).toBeNull();
		expect(
			link?.querySelectorAll(":scope > .cline-ui-button__icon"),
		).toHaveLength(2);
	});
});

describe("IconButton", () => {
	it("preserves legacy child content, refs, and actions", async () => {
		const onClick = vi.fn();
		const forwardedRef = createRef<HTMLButtonElement>();
		await render(
			<IconButton aria-label="Add item" onClick={onClick} ref={forwardedRef}>
				<Plus className="size-5" data-testid="legacy-icon" />
			</IconButton>,
		);
		const button = container.querySelector("button");
		const icon = button?.querySelector("[data-testid=legacy-icon]");
		expect(forwardedRef.current).toBe(button);
		expect(button?.type).toBe("button");
		expect(icon?.classList.contains("size-5")).toBe(true);
		expect(icon?.hasAttribute("data-icon")).toBe(false);
		await act(async () => button?.click());
		expect(onClick).toHaveBeenCalledOnce();
	});

	it("preserves a legacy composed link's content and ref", async () => {
		const onClick = vi.fn((event) => event.preventDefault());
		const childRef = createRef<HTMLAnchorElement>();
		await render(
			<IconButton asChild aria-label="Close">
				<a href="/close" onClick={onClick} ref={childRef}>
					<X data-testid="legacy-icon" />
				</a>
			</IconButton>,
		);
		const link = container.querySelector("a");
		expect(childRef.current).toBe(link);
		expect(link?.getAttribute("aria-label")).toBe("Close");
		expect(link?.querySelector("[data-testid=legacy-icon]")).not.toBeNull();
		expect(container.querySelector("button")).toBeNull();
		await act(async () => link?.click());
		expect(onClick).toHaveBeenCalledOnce();
	});

	it("renders an accessible name with a managed icon", async () => {
		await render(<IconButton aria-label="Add item" icon={Plus} />);
		const button = container.querySelector("button");
		expect(button?.getAttribute("aria-label")).toBe("Add item");
		expect(button?.dataset.slot).toBe("icon-button");
		expect(button?.type).toBe("button");
	});

	it("does not invoke actions while disabled", async () => {
		const onClick = vi.fn();
		await render(
			<IconButton
				aria-label="Remove item"
				disabled
				icon={X}
				onClick={onClick}
			/>,
		);
		await act(async () => container.querySelector("button")?.click());
		expect(onClick).not.toHaveBeenCalled();
	});
});

describe("managed button icons", () => {
	it("renders Lucide and custom SVG components in order without adding accessible content", async () => {
		await render(
			<Button leadingIcon={Plus} trailingIcon={CustomIcon}>
				Continue
			</Button>,
		);
		const button = container.querySelector("button");
		expect(button?.childNodes).toHaveLength(3);
		expect(button?.childNodes[1].textContent).toBe("Continue");
		const icons = Array.from(button?.querySelectorAll(":scope > svg") ?? []);
		expect(icons.map((icon) => icon.getAttribute("data-icon"))).toEqual([
			"leading",
			"trailing",
		]);
		for (const icon of icons) {
			expect(icon.classList.contains("cline-ui-button__icon")).toBe(true);
			expect(icon.getAttribute("aria-hidden")).toBe("true");
			expect(icon.getAttribute("focusable")).toBe("false");
		}
		expect(button?.hasAttribute("leadingicon")).toBe(false);
		expect(button?.hasAttribute("trailingicon")).toBe(false);
	});

	it("preserves both child and wrapper refs when adding icons to a composed button", async () => {
		const childRef = createRef<HTMLButtonElement>();
		const wrapperRef = createRef<HTMLButtonElement>();
		await render(
			<Button asChild leadingIcon={Plus} ref={wrapperRef}>
				<button type="submit" ref={childRef}>
					Save
				</button>
			</Button>,
		);
		const button = container.querySelector("button");
		expect(childRef.current).toBe(button);
		expect(wrapperRef.current).toBe(button);
		expect(button?.type).toBe("submit");
		expect(
			button?.querySelector(":scope > [data-icon=leading]"),
		).not.toBeNull();
	});

	it("renders a named icon-only link through asChild while preserving its ref and handler", async () => {
		const onClick = vi.fn((event) => event.preventDefault());
		const childRef = createRef<HTMLAnchorElement>();
		await render(
			<IconButton asChild aria-label="Close" icon={X}>
				{/* biome-ignore lint/a11y/useAnchorContent: IconButton supplies the accessible name and icon. */}
				<a href="/close" onClick={onClick} ref={childRef} />
			</IconButton>,
		);
		const link = container.querySelector("a");
		expect(childRef.current).toBe(link);
		expect(link?.getAttribute("aria-label")).toBe("Close");
		expect(link?.querySelectorAll(":scope > [data-icon=icon]")).toHaveLength(1);
		expect(link?.textContent).toBe("");
		await act(async () => link?.click());
		expect(onClick).toHaveBeenCalledOnce();
	});

	for (const disabled of [false, true]) {
		it(`preserves ${disabled ? "disabled" : "enabled"} Radix action behavior with a managed icon`, async () => {
			const onOpenChange = vi.fn();
			await render(
				<AlertDialogPrimitive.Root defaultOpen onOpenChange={onOpenChange}>
					<AlertDialogPrimitive.Content>
						<AlertDialogPrimitive.Title>Continue?</AlertDialogPrimitive.Title>
						<AlertDialogPrimitive.Description>
							Confirm your action.
						</AlertDialogPrimitive.Description>
						<AlertDialogPrimitive.Action asChild>
							<Button disabled={disabled} leadingIcon={Plus}>
								Confirm
							</Button>
						</AlertDialogPrimitive.Action>
					</AlertDialogPrimitive.Content>
				</AlertDialogPrimitive.Root>,
			);
			const action = container.querySelector("button");
			expect(
				action?.querySelector(":scope > .cline-ui-button__icon"),
			).not.toBeNull();
			await act(async () => action?.click());
			expect(onOpenChange).toHaveBeenCalledTimes(disabled ? 0 : 1);
			if (!disabled) expect(onOpenChange).toHaveBeenCalledWith(false);
		});
	}
});

describe("shared button composition", () => {
	it("enforces disabled attributes and blocks child and wrapper activation", async () => {
		const wrapperAction = vi.fn();
		const childAction = vi.fn();
		await render(
			<Button
				leadingIcon={Plus}
				aria-label="Settings"
				aria-disabled={false}
				data-disabled="consumer-value"
				tabIndex={0}
				asChild
				disabled
				onClick={wrapperAction}
				onClickCapture={wrapperAction}
				onKeyDown={wrapperAction}
				onKeyDownCapture={wrapperAction}
				onKeyUp={wrapperAction}
				onKeyUpCapture={wrapperAction}
			>
				<a
					aria-disabled={false}
					data-disabled={undefined}
					href="/settings"
					onClick={childAction}
					onClickCapture={childAction}
					onKeyDown={childAction}
					onKeyDownCapture={childAction}
					onKeyUp={childAction}
					onKeyUpCapture={childAction}
					tabIndex={0}
				>
					Settings
				</a>
			</Button>,
		);
		const link = container.querySelector<HTMLAnchorElement>("a");
		expect(link?.getAttribute("aria-disabled")).toBe("true");
		expect(link?.getAttribute("data-disabled")).toBe("");
		expect(link?.tabIndex).toBe(-1);
		expect(link?.hasAttribute("disabled")).toBe(false);
		await act(async () => link?.click());
		for (const key of ["Enter", " "]) {
			for (const eventType of ["keydown", "keyup"]) {
				const event = new KeyboardEvent(eventType, {
					key,
					bubbles: true,
					cancelable: true,
				});
				await act(async () => {
					link?.dispatchEvent(event);
				});
				expect(event.defaultPrevented).toBe(true);
			}
		}
		expect(wrapperAction).not.toHaveBeenCalled();
		expect(childAction).not.toHaveBeenCalled();
	});

	it("preserves unrelated keyboard handling on disabled composed controls", async () => {
		const wrapperAction = vi.fn();
		const childAction = vi.fn();
		await render(
			<Button aria-label="Settings" asChild disabled onKeyDown={wrapperAction}>
				<a href="/settings" onKeyDown={childAction}>
					Settings
				</a>
			</Button>,
		);
		const event = new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		});
		await act(async () => {
			container.querySelector("a")?.dispatchEvent(event);
		});
		expect(event.defaultPrevented).toBe(false);
		expect(wrapperAction).toHaveBeenCalledOnce();
		expect(childAction).toHaveBeenCalledOnce();
	});

	it("applies native disabled behavior to a composed button", async () => {
		const onClick = vi.fn();
		await render(
			<Button aria-label="Save" asChild disabled onClick={onClick}>
				<button disabled={false} onClick={onClick} type="submit">
					Save
				</button>
			</Button>,
		);
		const button = container.querySelector("button");
		expect(button?.disabled).toBe(true);
		await act(async () => button?.click());
		expect(onClick).not.toHaveBeenCalled();
	});

	for (const [description, wrapperType, childType, expectedType] of [
		[
			"preserves implicit native form submission",
			undefined,
			undefined,
			"submit",
		],
		["forwards an explicit non-submitting type", "button", undefined, "button"],
		["forwards an explicit submitting type", "submit", undefined, "submit"],
		["preserves the child's explicit type", "button", "submit", "submit"],
	] as const) {
		it(`${description} when composed`, async () => {
			const onSubmit = vi.fn((event) => event.preventDefault());
			await render(
				<form onSubmit={onSubmit}>
					<Button aria-label="Save" asChild type={wrapperType}>
						<button type={childType}>Save</button>
					</Button>
				</form>,
			);
			const button = container.querySelector("button");
			expect(button?.type).toBe(expectedType);
			expect(button?.getAttribute("type")).toBe(
				childType ?? wrapperType ?? null,
			);
			await act(async () => button?.click());
			expect(onSubmit).toHaveBeenCalledTimes(expectedType === "submit" ? 1 : 0);
		});
	}
});

describe("shared button appearance API", () => {
	it.each([
		["fill", "primary"],
		["surface", "secondary"],
	] as const)("keeps %s as an alias for %s", (legacy, current) => {
		for (const variants of [buttonVariants, iconButtonVariants]) {
			expect(variants({ variant: legacy })).toBe(
				variants({ variant: current }),
			);
		}
	});
});

describe("shared button press feedback", () => {
	it.each([
		undefined,
		false,
		0.94,
	] as const)("forwards pressScale=%s and preserves unrelated styles", async (pressScale) => {
		await render(
			<Button
				aria-label="Continue"
				pressScale={pressScale}
				style={{ color: "red" }}
			>
				Continue
			</Button>,
		);
		const button = container.querySelector("button");
		expect(button?.getAttribute("data-press-scale")).toBe(
			pressScale === false ? "false" : null,
		);
		expect(
			button?.style.getPropertyValue("--cline-ui-button-press-scale"),
		).toBe(typeof pressScale === "number" ? String(pressScale) : "");
		expect(button?.style.color).toBe("red");
		expect(button?.hasAttribute("pressscale")).toBe(false);
	});

	it("preserves consumer style overrides and composed child styles", async () => {
		const style = {
			"--cline-ui-button-press-scale": 0.92,
			color: "red",
		} as CSSProperties;
		await render(
			<Button aria-label="Continue" asChild pressScale={0.94} style={style}>
				<a href="/continue" style={{ color: "blue" }}>
					Continue
				</a>
			</Button>,
		);
		const link = container.querySelector("a");
		expect(link?.style.getPropertyValue("--cline-ui-button-press-scale")).toBe(
			"0.92",
		);
		expect(link?.style.color).toBe("blue");
		expect(link?.hasAttribute("pressscale")).toBe(false);
		expect(container.querySelector("button")).toBeNull();
	});
});
