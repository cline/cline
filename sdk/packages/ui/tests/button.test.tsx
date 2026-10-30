// @vitest-environment jsdom

import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { Plus, X } from "lucide-react";
import {
	act,
	type CSSProperties,
	type ReactElement,
	type ReactNode,
	type SVGProps,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	expectTypeOf,
	it,
	vi,
} from "vitest";
import {
	Button,
	type ButtonIcon,
	type ButtonProps,
	type ButtonSize,
	type ButtonTone,
	type ButtonVariant,
	buttonVariants,
	IconButton,
	type IconButtonProps,
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

// Shared behavior should also hold when the component inserts its own icons.
function ButtonWithIcon(props: ButtonProps) {
	return <Button leadingIcon={Plus} {...props} />;
}

function IconButtonWithIcon({ children, asChild, ...props }: ButtonProps) {
	return asChild ? (
		<IconButton aria-label="Action" {...props} icon={Plus} asChild>
			{children as ReactElement}
		</IconButton>
	) : (
		<IconButton aria-label="Action" {...props} icon={Plus} />
	);
}

function IconButtonWithChildren(props: ButtonProps) {
	return <IconButton aria-label="Action" {...props} />;
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
	it("defaults to a non-submitting medium primary accent button", async () => {
		await render(<Button>Continue</Button>);
		const button = container.querySelector("button");
		expect(button?.type).toBe("button");
		expect(button?.dataset.slot).toBe("button");
		expect(Array.from(button?.classList ?? [])).toEqual(
			expect.arrayContaining([
				"cline-ui-button-primary",
				"cline-ui-button-accent",
				"cline-ui-button-md",
			]),
		);
	});

	it("forwards native props, refs, and decisions", async () => {
		const onClick = vi.fn();
		let forwardedRef: HTMLButtonElement | null = null;
		await render(
			<Button
				className="consumer-class"
				leadingIcon={Plus}
				onClick={onClick}
				ref={(node) => {
					forwardedRef = node;
				}}
				size="lg"
				tone="destructive"
				variant="secondary"
			>
				Delete
			</Button>,
		);
		const element = container.querySelector<HTMLButtonElement>("button");
		expect(forwardedRef).toBe(element);
		expect(element?.className).toContain("consumer-class");
		expect(element?.className).toContain("cline-ui-button-destructive");
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

	it("prevents activation when a composed link is disabled", async () => {
		const onClick = vi.fn();
		const onClickCapture = vi.fn();
		await render(
			<Button
				aria-disabled={false}
				asChild
				data-disabled="consumer-value"
				disabled
				onClick={onClick}
				tabIndex={0}
			>
				<a href="/settings" onClick={onClick} onClickCapture={onClickCapture}>
					Settings
				</a>
			</Button>,
		);
		const link = container.querySelector<HTMLAnchorElement>("a");
		expect(link?.getAttribute("aria-disabled")).toBe("true");
		expect(link?.getAttribute("data-disabled")).toBe("");
		expect(link?.getAttribute("disabled")).toBeNull();
		expect(link?.tabIndex).toBe(-1);
		await act(async () => link?.click());
		expect(onClick).not.toHaveBeenCalled();
		expect(onClickCapture).not.toHaveBeenCalled();
	});
});

describe("IconButton", () => {
	it("preserves legacy child content, refs, and actions", async () => {
		const onClick = vi.fn();
		let forwardedRef: HTMLButtonElement | null = null;
		await render(
			<IconButton
				aria-label="Add item"
				onClick={onClick}
				ref={(node) => {
					forwardedRef = node;
				}}
			>
				<Plus className="size-5" data-testid="legacy-icon" />
			</IconButton>,
		);
		const button = container.querySelector("button");
		const icon = button?.querySelector("[data-testid=legacy-icon]");
		expect(forwardedRef).toBe(button);
		expect(button?.type).toBe("button");
		expect(button?.classList.contains("cline-ui-button-legacy-icons")).toBe(
			true,
		);
		expect(icon?.classList.contains("size-5")).toBe(true);
		expect(icon?.hasAttribute("data-icon")).toBe(false);
		await act(async () => button?.click());
		expect(onClick).toHaveBeenCalledOnce();
	});

	it("preserves a legacy composed link's content and ref", async () => {
		const onClick = vi.fn((event) => event.preventDefault());
		let childRef: HTMLAnchorElement | null = null;
		await render(
			<IconButton asChild aria-label="Close">
				<a
					href="/close"
					onClick={onClick}
					ref={(node) => {
						childRef = node;
					}}
				>
					<X data-testid="legacy-icon" />
				</a>
			</IconButton>,
		);
		const link = container.querySelector("a");
		expect(childRef).toBe(link);
		expect(link?.getAttribute("aria-label")).toBe("Close");
		expect(link?.querySelector("[data-testid=legacy-icon]")).not.toBeNull();
		expect(container.querySelector("button")).toBeNull();
		await act(async () => link?.click());
		expect(onClick).toHaveBeenCalledOnce();
	});

	it("defaults to a small neutral ghost button with an accessible name", async () => {
		await render(<IconButton aria-label="Add item" icon={Plus} />);
		const button = container.querySelector("button");
		expect(button?.getAttribute("aria-label")).toBe("Add item");
		expect(button?.dataset.slot).toBe("icon-button");
		expect(button?.type).toBe("button");
		expect(Array.from(button?.classList ?? [])).toEqual(
			expect.arrayContaining([
				"cline-ui-icon-button",
				"cline-ui-button-ghost",
				"cline-ui-button-neutral",
				"cline-ui-button-sm",
			]),
		);
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

	it("prevents activation when a composed link is disabled", async () => {
		const onClick = vi.fn();
		const onClickCapture = vi.fn();
		await render(
			<IconButton
				aria-disabled={false}
				aria-label="Remove item"
				icon={X}
				asChild
				data-disabled="consumer-value"
				disabled
				onClick={onClick}
				tabIndex={0}
			>
				<a href="/remove" onClick={onClick} onClickCapture={onClickCapture}>
					−
				</a>
			</IconButton>,
		);
		const link = container.querySelector<HTMLAnchorElement>("a");
		expect(link?.getAttribute("aria-disabled")).toBe("true");
		expect(link?.getAttribute("data-disabled")).toBe("");
		expect(link?.getAttribute("disabled")).toBeNull();
		expect(link?.tabIndex).toBe(-1);
		await act(async () => link?.click());
		expect(onClick).not.toHaveBeenCalled();
		expect(onClickCapture).not.toHaveBeenCalled();
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
		expect(button?.classList.contains("cline-ui-button-legacy-icons")).toBe(
			false,
		);
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

	it("leaves unrelated SVG content untouched", async () => {
		await render(
			<Button leadingIcon={Plus}>
				<span>
					Preview <svg data-testid="preview" width="48" height="32" />
				</span>
			</Button>,
		);
		const preview = container.querySelector("[data-testid=preview]");
		expect(preview?.getAttribute("width")).toBe("48");
		expect(preview?.getAttribute("height")).toBe("32");
		expect(preview?.classList.contains("cline-ui-button__icon")).toBe(false);
		expect(preview?.hasAttribute("data-icon")).toBe(false);
	});

	it("preserves both child and wrapper refs when adding icons to a composed button", async () => {
		let childRef: HTMLButtonElement | null = null;
		let wrapperRef: HTMLButtonElement | null = null;
		await render(
			<Button
				asChild
				leadingIcon={Plus}
				ref={(node) => {
					wrapperRef = node;
				}}
			>
				<button
					type="submit"
					ref={(node) => {
						childRef = node;
					}}
				>
					Save
				</button>
			</Button>,
		);
		const button = container.querySelector("button");
		expect(childRef).toBe(button);
		expect(wrapperRef).toBe(button);
		expect(button?.type).toBe("submit");
		expect(
			button?.querySelector(":scope > [data-icon=leading]"),
		).not.toBeNull();
	});

	it("renders a named icon-only link through asChild while preserving its ref and handler", async () => {
		const onClick = vi.fn((event) => event.preventDefault());
		let childRef: HTMLAnchorElement | null = null;
		await render(
			<IconButton asChild aria-label="Close" icon={X}>
				{/* biome-ignore lint/a11y/useAnchorContent: IconButton supplies the accessible name and icon. */}
				<a
					href="/close"
					onClick={onClick}
					ref={(node) => {
						childRef = node;
					}}
				/>
			</IconButton>,
		);
		const link = container.querySelector("a");
		expect(childRef).toBe(link);
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

	it("accepts component references and keeps icon sizing outside the prop API", () => {
		expectTypeOf<typeof Plus>().toExtend<ButtonIcon>();
		expectTypeOf<typeof CustomIcon>().toExtend<ButtonIcon>();
		expectTypeOf<ButtonProps["leadingIcon"]>().toEqualTypeOf<
			ButtonIcon | undefined
		>();
		expectTypeOf<ButtonProps["trailingIcon"]>().toEqualTypeOf<
			ButtonIcon | undefined
		>();
		expectTypeOf<IconButtonProps["icon"]>().toEqualTypeOf<
			ButtonIcon | undefined
		>();
		// @ts-expect-error Slots accept components, not pre-sized elements.
		const elementIcon: ButtonProps = { leadingIcon: <Plus size={32} /> };
		// @ts-expect-error The button size owns icon dimensions.
		const iconSize: ButtonProps = { iconSize: 32 };
		const legacyChildren: IconButtonProps = {
			"aria-label": "Add",
			children: <Plus />,
		};
		void [elementIcon, iconSize, legacyChildren];
	});
});

describe("shared button composition", () => {
	for (const [name, Component] of [
		["Button", ButtonWithIcon],
		["IconButton", IconButtonWithIcon],
		["IconButton with legacy children", IconButtonWithChildren],
	] as const) {
		it(`${name} enforces disabled attributes and blocks child and wrapper activation`, async () => {
			const wrapperAction = vi.fn();
			const childAction = vi.fn();
			await render(
				<Component
					aria-label="Settings"
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
				</Component>,
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

		it(`${name} preserves unrelated keyboard handling on disabled composed controls`, async () => {
			const wrapperAction = vi.fn();
			const childAction = vi.fn();
			await render(
				<Component
					aria-label="Settings"
					asChild
					disabled
					onKeyDown={wrapperAction}
				>
					<a href="/settings" onKeyDown={childAction}>
						Settings
					</a>
				</Component>,
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

		it(`${name} applies native disabled behavior to a composed button`, async () => {
			const onClick = vi.fn();
			await render(
				<Component aria-label="Save" asChild disabled onClick={onClick}>
					<button disabled={false} onClick={onClick} type="submit">
						Save
					</button>
				</Component>,
			);
			const button = container.querySelector("button");
			expect(button?.disabled).toBe(true);
			await act(async () => button?.click());
			expect(onClick).not.toHaveBeenCalled();
		});

		for (const scenario of [
			{
				description: "defaults to a non-submitting button",
				wrapperType: undefined,
				childType: undefined,
				expectedType: "button",
			},
			{
				description: "forwards an explicit non-submitting type",
				wrapperType: "button",
				childType: undefined,
				expectedType: "button",
			},
			{
				description: "forwards an explicit submitting type",
				wrapperType: "submit",
				childType: undefined,
				expectedType: "submit",
			},
			{
				description: "preserves the child's explicit type",
				wrapperType: "button",
				childType: "submit",
				expectedType: "submit",
			},
		] as const) {
			it(`${name} ${scenario.description} when composed`, async () => {
				const onSubmit = vi.fn((event) => event.preventDefault());
				await render(
					<form onSubmit={onSubmit}>
						<Component aria-label="Save" asChild type={scenario.wrapperType}>
							<button type={scenario.childType}>Save</button>
						</Component>
					</form>,
				);
				const button = container.querySelector("button");
				expect(button?.type).toBe(scenario.expectedType);
				await act(async () => button?.click());
				expect(onSubmit).toHaveBeenCalledTimes(
					scenario.expectedType === "submit" ? 1 : 0,
				);
			});
		}
	}
});

describe("shared button appearance API", () => {
	it("keeps legacy SVG defaults in the exported variant helpers", () => {
		for (const variants of [buttonVariants, iconButtonVariants]) {
			expect(variants().split(" ")).toContain("cline-ui-button-legacy-icons");
		}
	});

	it("exposes emphasis variants and legacy aliases with independent tone and size", () => {
		expectTypeOf<ButtonVariant>().toEqualTypeOf<
			"primary" | "secondary" | "ghost" | "fill" | "surface"
		>();
		expectTypeOf<ButtonTone>().toEqualTypeOf<
			"accent" | "neutral" | "destructive"
		>();
		expectTypeOf<ButtonSize>().toEqualTypeOf<"xs" | "sm" | "md" | "lg">();
		expectTypeOf<
			NonNullable<ButtonProps["variant"]>
		>().toEqualTypeOf<ButtonVariant>();
		expectTypeOf<
			NonNullable<IconButtonProps["variant"]>
		>().toEqualTypeOf<ButtonVariant>();
		expectTypeOf<
			NonNullable<IconButtonProps["tone"]>
		>().toEqualTypeOf<ButtonTone>();
		expectTypeOf<
			NonNullable<IconButtonProps["size"]>
		>().toEqualTypeOf<ButtonSize>();
		expectTypeOf<ButtonProps["pressScale"]>().toEqualTypeOf<
			number | false | undefined
		>();
		expectTypeOf<IconButtonProps["pressScale"]>().toEqualTypeOf<
			ButtonProps["pressScale"]
		>();
		expectTypeOf<
			NonNullable<Parameters<typeof buttonVariants>[0]>["variant"]
		>().toEqualTypeOf<ButtonProps["variant"]>();
		expectTypeOf<
			NonNullable<Parameters<typeof iconButtonVariants>[0]>["variant"]
		>().toEqualTypeOf<IconButtonProps["variant"]>();
	});

	for (const [legacy, current] of [
		["fill", "primary"],
		["surface", "secondary"],
	] as const) {
		it(`supports ${legacy} in components and exported variant helpers`, async () => {
			for (const tone of ["accent", "neutral", "destructive"] as const) {
				expect(buttonVariants({ variant: legacy, tone })).toBe(
					buttonVariants({ variant: current, tone }),
				);
				expect(iconButtonVariants({ variant: legacy, tone })).toBe(
					iconButtonVariants({ variant: current, tone }),
				);
				await render(
					<>
						<Button variant={legacy} tone={tone}>
							Continue
						</Button>
						<IconButton aria-label="Add" variant={legacy} tone={tone}>
							<Plus />
						</IconButton>
					</>,
				);
				for (const button of container.querySelectorAll("button")) {
					expect(button.classList.contains(`cline-ui-button-${current}`)).toBe(
						true,
					);
					expect(button.classList.contains(`cline-ui-button-${tone}`)).toBe(
						true,
					);
				}
			}
		});
	}

	for (const [name, Component] of [
		["Button", ButtonWithIcon],
		["IconButton", IconButtonWithIcon],
	] as const) {
		it(`${name} selects the neutral primary appearance`, async () => {
			await render(
				<Component aria-label="Continue" tone="neutral" variant="primary">
					Continue
				</Component>,
			);
			expect(
				Array.from(container.querySelector("button")?.classList ?? []),
			).toEqual(
				expect.arrayContaining([
					"cline-ui-button-primary",
					"cline-ui-button-neutral",
				]),
			);
		});

		it(`${name} selects the neutral secondary appearance`, async () => {
			await render(
				<Component aria-label="Cancel" tone="neutral" variant="secondary">
					Cancel
				</Component>,
			);
			expect(
				Array.from(container.querySelector("button")?.classList ?? []),
			).toEqual(
				expect.arrayContaining([
					"cline-ui-button-secondary",
					"cline-ui-button-neutral",
				]),
			);
		});
	}
});

describe("shared button press feedback", () => {
	it("includes press feedback when consumers use the exported variant helpers", () => {
		expect(buttonVariants().split(" ")).toContain("cline-ui-button");
		expect(iconButtonVariants().split(" ")).toContain("cline-ui-button");
	});

	for (const [name, Component] of [
		["Button", ButtonWithIcon],
		["IconButton", IconButtonWithIcon],
	] as const) {
		it(`${name} uses the stylesheet default without an inline scale`, async () => {
			await render(
				<Component aria-label="Continue" style={{ color: "red" }}>
					Continue
				</Component>,
			);
			const button = container.querySelector("button");
			expect(button?.classList.contains("cline-ui-button")).toBe(true);
			expect(button?.hasAttribute("data-press-scale")).toBe(false);
			expect(
				button?.style.getPropertyValue("--cline-ui-button-press-scale"),
			).toBe("");
			expect(button?.style.color).toBe("red");
		});

		it(`${name} opts out without forwarding pressScale to the DOM`, async () => {
			await render(
				<Component aria-label="Continue" pressScale={false}>
					Continue
				</Component>,
			);
			const button = container.querySelector("button");
			expect(button?.getAttribute("data-press-scale")).toBe("false");
			expect(button?.hasAttribute("pressscale")).toBe(false);
		});

		it(`${name} supports a custom scale and preserves unrelated styles`, async () => {
			await render(
				<Component
					aria-label="Continue"
					pressScale={0.94}
					style={{ color: "red" }}
				>
					Continue
				</Component>,
			);
			const button = container.querySelector("button");
			expect(
				button?.style.getPropertyValue("--cline-ui-button-press-scale"),
			).toBe("0.94");
			expect(button?.style.color).toBe("red");
			expect(button?.hasAttribute("pressscale")).toBe(false);
		});

		it(`${name} preserves consumer style overrides and composed child styles`, async () => {
			const style = {
				"--cline-ui-button-press-scale": 0.92,
				color: "red",
			} as CSSProperties;
			await render(
				<Component
					aria-label="Continue"
					asChild
					pressScale={0.94}
					style={style}
				>
					<a href="/continue" style={{ color: "blue" }}>
						Continue
					</a>
				</Component>,
			);
			const link = container.querySelector("a");
			expect(
				link?.style.getPropertyValue("--cline-ui-button-press-scale"),
			).toBe("0.92");
			expect(link?.style.color).toBe("blue");
			expect(link?.hasAttribute("pressscale")).toBe(false);
			expect(container.querySelector("button")).toBeNull();
		});
	}
});
