// @vitest-environment jsdom

import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { Plus, X } from "lucide-react";
import {
	act,
	type CSSProperties,
	createRef,
	type ReactNode,
	type SVGProps,
	useEffect,
	useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageAction } from "../components/agent-chat/index.js";
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

	it.each([
		false,
		true,
	])("preserves composed icon link content, refs, and actions with managed=%s", async (managed) => {
		const onClick = vi.fn((event) => event.preventDefault());
		const childRef = createRef<HTMLAnchorElement>();
		await render(
			<IconButton asChild aria-label="Close" icon={managed ? X : undefined}>
				<a href="/close" onClick={onClick} ref={childRef}>
					{managed ? null : <X data-testid="legacy-icon" />}
				</a>
			</IconButton>,
		);
		const link = container.querySelector("a");
		expect(childRef.current).toBe(link);
		expect(link?.getAttribute("aria-label")).toBe("Close");
		expect(
			link?.querySelectorAll(
				managed ? ":scope > [data-icon=icon]" : "[data-testid=legacy-icon]",
			),
		).toHaveLength(1);
		expect(link?.textContent).toBe("");
		expect(container.querySelector("button")).toBeNull();
		await act(async () => link?.click());
		expect(onClick).toHaveBeenCalledOnce();
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
		const button = container.querySelector("button");
		expect(button?.getAttribute("aria-label")).toBe("Remove item");
		expect(button?.dataset.slot).toBe("icon-button");
		expect(button?.type).toBe("button");
		await act(async () => button?.click());
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

describe("controlled button loading", () => {
	it.each([
		false,
		true,
	])("preserves stateful label identity across loading changes with asChild=%s", async (asChild) => {
		const mounted = vi.fn();
		const unmounted = vi.fn();
		const labelState: { update?: (value: string) => void } = {};
		function StatefulLabel() {
			const [label, setLabel] = useState("Original label");
			labelState.update = setLabel;
			useEffect(() => {
				mounted();
				return unmounted;
			}, []);
			return <span data-testid="stateful-label">{label}</span>;
		}
		const renderButton = (loading: boolean) =>
			render(
				<Button asChild={asChild} loading={loading}>
					{asChild ? (
						<button type="button">
							<StatefulLabel />
						</button>
					) : (
						<StatefulLabel />
					)}
				</Button>,
			);

		await renderButton(false);
		await act(async () => labelState.update?.("Edited label"));
		const label = container.querySelector('[data-testid="stateful-label"]');
		for (const loading of [true, false, true, false]) {
			await renderButton(loading);
			expect(container.querySelector('[data-testid="stateful-label"]')).toBe(
				label,
			);
			expect(label?.textContent).toBe("Edited label");
			expect(mounted).toHaveBeenCalledOnce();
			expect(unmounted).not.toHaveBeenCalled();
		}
	});

	it("keeps a loading cancellation action enabled and restores its original content", async () => {
		const onClick = vi.fn();
		await render(
			<Button
				loading
				loadingLabel="Cancel upload"
				leadingIcon={Plus}
				onClick={onClick}
			>
				Upload
			</Button>,
		);
		const button = container.querySelector("button");
		expect(button?.disabled).toBe(false);
		expect(button?.getAttribute("aria-busy")).toBe("true");
		expect(button?.textContent).toBe("Cancel upload");
		expect(
			button?.querySelectorAll(".cline-ui-button__icon--loading"),
		).toHaveLength(1);
		expect(button?.querySelector(".lucide-plus")).toBeNull();
		await act(async () => button?.click());
		expect(onClick).toHaveBeenCalledOnce();

		await render(<Button leadingIcon={Plus}>Upload</Button>);
		expect(container.querySelector("button")).toBe(button);
		expect(button?.getAttribute("aria-busy")).toBeNull();
		expect(button?.textContent).toBe("Upload");
		expect(button?.querySelector(".cline-ui-button__icon--loading")).toBeNull();
		expect(button?.querySelector(".lucide-plus")).not.toBeNull();
	});

	it("preserves the label by default and honors explicit disabled while loading", async () => {
		const onClick = vi.fn();
		await render(
			<Button loading disabled onClick={onClick}>
				Save
			</Button>,
		);
		const button = container.querySelector("button");
		expect(button?.textContent).toBe("Save");
		expect(button?.disabled).toBe(true);
		await act(async () => button?.click());
		expect(onClick).not.toHaveBeenCalled();
	});

	it.each([
		false,
		true,
	])("preserves composed content, refs, native type, and busy state with loading=%s", async (loading) => {
		const wrapperRef = createRef<HTMLButtonElement>();
		const childRef = createRef<HTMLButtonElement>();
		const onClick = vi.fn();
		const type = loading ? "button" : "submit";
		await render(
			<Button
				asChild
				leadingIcon={Plus}
				loading={loading}
				loadingLabel="Cancel save"
				ref={wrapperRef}
			>
				<button aria-busy={false} type={type} ref={childRef} onClick={onClick}>
					Save
				</button>
			</Button>,
		);
		const button = container.querySelector("button");
		expect(container.querySelectorAll("button")).toHaveLength(1);
		expect(wrapperRef.current).toBe(button);
		expect(childRef.current).toBe(button);
		expect(button?.type).toBe(type);
		expect(button?.getAttribute("aria-busy")).toBe(String(loading));
		expect(button?.textContent).toBe(loading ? "Cancel save" : "Save");
		expect(
			button?.querySelector(":scope > [data-icon=leading]"),
		).not.toBeNull();
		await act(async () => button?.click());
		expect(onClick).toHaveBeenCalledOnce();
	});

	it("allows a custom loading icon without losing the icon-only control's accessible name", async () => {
		const onClick = vi.fn((event) => event.preventDefault());
		const childRef = createRef<HTMLAnchorElement>();
		await render(
			<IconButton
				asChild
				aria-label="Cancel refresh"
				loading
				loadingIcon={CustomIcon}
				icon={Plus}
			>
				{/* biome-ignore lint/a11y/useAnchorContent: IconButton supplies the accessible name and icon. */}
				<a href="/cancel" onClick={onClick} ref={childRef} />
			</IconButton>,
		);
		const link = container.querySelector("a");
		expect(childRef.current).toBe(link);
		expect(link?.getAttribute("aria-label")).toBe("Cancel refresh");
		expect(link?.getAttribute("aria-busy")).toBe("true");
		const icon = link?.querySelector("svg");
		expect(icon?.getAttribute("data-icon")).toBe("icon");
		expect(icon?.getAttribute("aria-hidden")).toBe("true");
		expect(icon?.classList.contains("cline-ui-button__icon--loading")).toBe(
			true,
		);
		expect(icon?.querySelector("path")?.getAttribute("d")).toBe("M4 12h16");
		await act(async () => link?.click());
		expect(onClick).toHaveBeenCalledOnce();
	});

	it("still blocks composed actions explicitly disabled while loading", async () => {
		const onClick = vi.fn();
		await render(
			<IconButton asChild aria-label="Refresh" loading disabled>
				<a href="/refresh" onClick={onClick}>
					Refresh
				</a>
			</IconButton>,
		);
		const link = container.querySelector("a");
		expect(link?.getAttribute("aria-disabled")).toBe("true");
		await act(async () => link?.click());
		expect(onClick).not.toHaveBeenCalled();
	});

	it("forwards loading through MessageAction without changing its accessible name or chat sizing", async () => {
		const onClick = vi.fn();
		await render(
			<MessageAction
				label="Fork session"
				icon={Plus}
				loading
				disabled
				onClick={onClick}
			/>,
		);
		const button = container.querySelector("button");
		expect(button?.getAttribute("aria-label")).toBe("Fork session");
		expect(button?.getAttribute("aria-busy")).toBe("true");
		expect(button?.classList.contains("cline-ui-button-xs")).toBe(true);
		expect(
			button?.querySelector(".cline-ui-button__icon--loading"),
		).not.toBeNull();
		await act(async () => button?.click());
		expect(onClick).not.toHaveBeenCalled();

		await render(
			<MessageAction label="Fork session" icon={Plus} onClick={onClick} />,
		);
		expect(button?.getAttribute("aria-busy")).toBeNull();
		expect(button?.querySelector(".lucide-plus")).not.toBeNull();
		await act(async () => button?.click());
		expect(onClick).toHaveBeenCalledOnce();
	});

	it("reserves icon tone for managed icons without forwarding component props to the DOM", async () => {
		await render(
			<Button iconTone="muted" leadingIcon={Plus}>
				Add
			</Button>,
		);
		const button = container.querySelector("button");
		expect(button?.getAttribute("data-icon-tone")).toBe("muted");
		expect(button?.getAttribute("icontone")).toBeNull();
		expect(button?.getAttribute("loading")).toBeNull();
		expect(button?.getAttribute("loadinglabel")).toBeNull();
	});
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

describe("Button content width transitions", () => {
	type WidthAnimation = {
		playState: AnimationPlayState;
		currentTime: number | null;
		width: number;
		cancel: ReturnType<typeof vi.fn>;
		play: ReturnType<typeof vi.fn>;
	};
	let naturalWidth: number;
	let activeAnimation: WidthAnimation | undefined;
	let animations: WidthAnimation[];
	let animate: ReturnType<typeof vi.fn<Element["animate"]>>;
	let originalAnimate: PropertyDescriptor | undefined;
	let motion: EventTarget & { matches: boolean };

	beforeEach(() => {
		naturalWidth = 100;
		activeAnimation = undefined;
		animations = [];
		motion = Object.assign(new EventTarget(), { matches: false });
		vi.stubGlobal(
			"matchMedia",
			vi.fn(() => motion),
		);
		vi.stubGlobal(
			"getComputedStyle",
			vi.fn(() => ({
				width: `${activeAnimation?.playState === "running" ? activeAnimation.width : naturalWidth}px`,
			})),
		);
		animate = vi.fn<Element["animate"]>((keyframes) => {
			const firstFrame = (keyframes as Keyframe[])[0];
			const animation: WidthAnimation = {
				playState: "running",
				currentTime: 0,
				width: Number.parseFloat(String(firstFrame.width)),
				cancel: vi.fn(() => {
					animation.playState = "idle";
					animation.currentTime = null;
				}),
				play: vi.fn(() => {
					animation.playState = "running";
				}),
			};
			animations.push(animation);
			activeAnimation = animation;
			return animation as unknown as Animation;
		});
		originalAnimate = Object.getOwnPropertyDescriptor(
			Element.prototype,
			"animate",
		);
		Object.defineProperty(Element.prototype, "animate", {
			configurable: true,
			value: animate,
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		if (originalAnimate) {
			Object.defineProperty(Element.prototype, "animate", originalAnimate);
		} else {
			Reflect.deleteProperty(Element.prototype, "animate");
		}
	});

	it("expands and contracts when a loading label changes the content width", async () => {
		await render(<Button>Save</Button>);
		expect(animate).not.toHaveBeenCalled();
		expect(container.querySelector("button")?.style.width).toBe("");
		naturalWidth = 160;
		await render(<Button disabled>Saving changes…</Button>);
		expect(animate.mock.calls[0]?.[0]).toEqual([
			expect.objectContaining({ width: "100px" }),
			expect.objectContaining({ width: "160px" }),
		]);
		animations[0].playState = "finished";
		naturalWidth = 100;
		await render(<Button>Save</Button>);
		expect(animate.mock.calls[1]?.[0]).toEqual([
			expect.objectContaining({ width: "160px" }),
			expect.objectContaining({ width: "100px" }),
		]);
		expect(container.querySelector("button")?.style.width).toBe("");
	});

	it("continues from the visible width when loading changes before the animation finishes", async () => {
		await render(<Button>Save</Button>);
		naturalWidth = 160;
		await render(<Button disabled>Saving changes…</Button>);
		animations[0].width = 125;
		naturalWidth = 100;
		await render(<Button>Save</Button>);
		expect(animations[0].cancel).toHaveBeenCalledOnce();
		expect(animate.mock.calls[1]?.[0]).toEqual([
			expect.objectContaining({ width: "125px" }),
			expect.objectContaining({ width: "100px" }),
		]);
	});

	it("preserves animation progress when the same loading content rerenders", async () => {
		await render(<Button>Save</Button>);
		naturalWidth = 160;
		await render(<Button disabled>Saving changes…</Button>);
		animations[0].width = 125;
		animations[0].currentTime = 75;
		await render(<Button disabled>Saving changes…</Button>);
		expect(animate).toHaveBeenCalledOnce();
		expect(animations[0].currentTime).toBe(75);
		expect(animations[0].playState).toBe("running");
	});

	it("changes content immediately when reduced motion is preferred", async () => {
		motion.matches = true;
		await render(<Button>Save</Button>);
		naturalWidth = 160;
		await render(<Button disabled>Saving changes…</Button>);
		expect(animate).not.toHaveBeenCalled();
		expect(container.querySelector("button")?.textContent).toBe(
			"Saving changes…",
		);
	});

	it("cancels an active transition when reduced motion is enabled", async () => {
		await render(<Button>Save</Button>);
		naturalWidth = 160;
		await render(<Button disabled>Saving changes…</Button>);
		motion.matches = true;
		motion.dispatchEvent(new Event("change"));
		expect(animations[0].cancel).toHaveBeenCalledOnce();
	});

	it("preserves styles without animating when measured width is unchanged", async () => {
		await render(<Button style={{ width: 100 }}>Save</Button>);
		await render(<Button style={{ width: 100 }}>Saving…</Button>);
		expect(animate).not.toHaveBeenCalled();
		expect(container.querySelector("button")?.style.width).toBe("100px");
	});

	it("cancels the animation when the button unmounts", async () => {
		await render(<Button>Save</Button>);
		naturalWidth = 160;
		await render(<Button disabled>Saving changes…</Button>);
		await render(null);
		expect(animations[0].cancel).toHaveBeenCalledOnce();
	});
});
