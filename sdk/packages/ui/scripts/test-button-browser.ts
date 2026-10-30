import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { compile } from "@tailwindcss/node";
import { chromium, type Page } from "playwright";
import { type CSSProperties, createElement as h, type SVGProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge } from "../components/badge.js";
import {
	Button,
	type ButtonTone,
	type ButtonVariant,
	buttonVariants,
	IconButton,
	iconButtonVariants,
} from "../components/button.js";
import { PillSelector, PillSelectorItem } from "../components/pill-selector.js";
import { SegmentedControl } from "../components/segmented-control.js";
import { Switch } from "../components/switch.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const variants: ButtonVariant[] = ["primary", "secondary", "ghost"];
const tones: ButtonTone[] = ["accent", "neutral", "destructive"];
const sizes = [
	{
		size: "xs",
		height: 28,
		padding: 10,
		gap: 6,
		leadingPadding: 6,
		trailingPadding: 6,
		iconGap: 6,
		icon: 12,
		iconOnly: 14,
	},
	{
		size: "sm",
		height: 32,
		padding: 12,
		gap: 6,
		leadingPadding: 7.2,
		trailingPadding: 7.2,
		iconGap: 6,
		icon: 14,
		iconOnly: 16,
	},
	{
		size: "md",
		height: 36,
		padding: 14,
		gap: 8,
		leadingPadding: 8,
		trailingPadding: 8,
		iconGap: 8,
		icon: 16,
		iconOnly: 16,
	},
	{
		size: "lg",
		height: 40,
		padding: 16,
		gap: 10,
		leadingPadding: 10,
		trailingPadding: 12,
		iconGap: 10,
		icon: 16,
		iconOnly: 20,
	},
] as const;
const segmentedSizes = [
	{ size: "xs", height: 2, icon: 0.875 },
	{ size: "sm", height: 2.25, icon: 1 },
	{ size: "md", height: 2.5, icon: 1 },
	{ size: "lg", height: 2.5, icon: 1.25 },
] as const;
const utilities = [
	"h-7",
	"px-0",
	"gap-0",
	"whitespace-normal",
	"size-6",
	"inline-flex",
	"flex",
];
const unmanagedIcon = (position?: "leading" | "trailing", className?: string) =>
	h(
		"svg",
		{
			"aria-hidden": true,
			"data-icon": position,
			className,
			width: 48,
			height: 32,
			viewBox: "0 0 24 24",
		},
		h("path", { d: "M6 12h12M12 6v12", stroke: "currentColor" }),
	);
function FixtureIcon(props: SVGProps<SVGSVGElement>) {
	return h(
		"svg",
		{ viewBox: "0 0 24 24", width: 24, height: 24, ...props },
		h("path", { d: "M6 12h12M12 6v12", stroke: "currentColor" }),
	);
}
const matrix = variants.flatMap((variant) =>
	tones.map((tone) =>
		h(
			Button,
			{ id: `${variant}-${tone}`, key: `${variant}-${tone}`, tone, variant },
			`${variant} ${tone}`,
		),
	),
);
const fixture = renderToStaticMarkup(
	h(
		"div",
		{
			className: "cline-ui-theme",
			style: {
				fontFamily: "monospace",
				color: "var(--foreground)",
				backgroundColor: "var(--background)",
				padding: 16,
			},
		},
		h(
			"div",
			{
				id: "surface",
				style: {
					padding: 16,
					display: "flex",
					flexWrap: "wrap",
					gap: 12,
					backgroundColor: "var(--surface-1)",
				},
			},
			...matrix,
			...sizes.flatMap(({ size }) =>
				(["button", "icon"] as const).flatMap((kind) =>
					([false, true] as const).map((override) =>
						h(
							"button",
							{
								id: `helper-${kind}-${size}${override ? "-override" : ""}`,
								key: `helper-${kind}-${size}-${override}`,
								type: "button",
								"aria-label": "Helper icon",
								className: (kind === "button"
									? buttonVariants
									: iconButtonVariants)({ size }),
							},
							unmanagedIcon(undefined, override ? "size-6" : undefined),
						),
					),
				),
			),
			...(["accent", "neutral"] as const).map((tone) =>
				h(Switch, {
					id: `switch-${tone}`,
					key: tone,
					tone,
					defaultChecked: true,
					"aria-label": `${tone} switch`,
				}),
			),
			...sizes.flatMap(({ size }) => [
				h(
					Button,
					{ id: `text-${size}`, key: `text-${size}`, size },
					"Text only",
				),
				h(
					Button,
					{
						id: `leading-${size}`,
						key: `leading-${size}`,
						size,
						leadingIcon: FixtureIcon,
					},
					"Leading icon",
				),
				h(
					Button,
					{
						id: `trailing-${size}`,
						key: `trailing-${size}`,
						size,
						trailingIcon: FixtureIcon,
					},
					"Trailing icon",
				),
				h(
					Button,
					{
						id: `both-${size}`,
						key: `both-${size}`,
						size,
						leadingIcon: FixtureIcon,
						trailingIcon: FixtureIcon,
					},
					"Both icons",
				),
				h(
					Button,
					{ id: `unmarked-${size}`, key: `unmarked-${size}`, size },
					unmanagedIcon(),
					"Unmarked icon",
				),
				h(
					Button,
					{ id: `wrapped-${size}`, key: `wrapped-${size}`, size },
					h("span", { "data-icon": "leading" }, unmanagedIcon()),
					"Marked wrapper",
				),
				h(
					Button,
					{ id: `nested-${size}`, key: `nested-${size}`, size },
					h("span", null, unmanagedIcon("leading")),
					"Nested marker",
				),
				h(IconButton, {
					id: `icon-${size}`,
					key: `icon-${size}`,
					size,
					"aria-label": "Add",
					icon: FixtureIcon,
				}),
				h(
					IconButton,
					{
						id: `legacy-icon-${size}`,
						key: `legacy-icon-${size}`,
						size,
						"aria-label": "Add",
					},
					unmanagedIcon(),
				),
			]),
			h(IconButton, { id: "icon", "aria-label": "Add", icon: FixtureIcon }),
			h(
				Button,
				{ id: "legacy-size-override" },
				unmanagedIcon(undefined, "size-6"),
				"Custom child icon size",
			),
			h(
				IconButton,
				{ id: "legacy-icon-size-override", "aria-label": "Custom child icon" },
				unmanagedIcon(undefined, "size-6"),
			),
			h(
				IconButton,
				{ asChild: true, "aria-label": "Legacy link" },
				h("a", { id: "legacy-icon-link", href: "#example" }, unmanagedIcon()),
			),
			h(
				Button,
				{ id: "managed-with-preview", leadingIcon: FixtureIcon },
				h("span", null, unmanagedIcon()),
			),
			h(
				Button,
				{
					id: "override",
					className: "h-7 px-0 gap-0 whitespace-normal",
					leadingIcon: FixtureIcon,
					trailingIcon: FixtureIcon,
					style: { "--cline-ui-button-icon-size": "20px" } as CSSProperties,
				},
				"Custom spacing",
			),
			h(IconButton, {
				id: "icon-override",
				"aria-label": "Custom icon",
				className: "size-6",
				icon: FixtureIcon,
				style: { "--cline-ui-button-icon-size": "18px" } as CSSProperties,
			}),
			h(Button, { id: "no-scale", pressScale: false }, "No scaling"),
			h(Button, { id: "custom-scale", pressScale: 0.94 }, "Custom scaling"),
			h(Button, { id: "disabled", disabled: true }, "Disabled"),
			h(
				Button,
				{ id: "hidden-button", hidden: true, className: "inline-flex" },
				"Hidden button",
			),
			h(IconButton, {
				id: "hidden-icon-button",
				hidden: true,
				"aria-label": "Hidden icon button",
				icon: FixtureIcon,
			}),
			h(
				Badge,
				{
					id: "hidden-badge",
					hidden: true,
					interactive: true,
					onClick: () => {},
				},
				"Hidden badge",
			),
			h(
				Button,
				{ asChild: true, hidden: true },
				h("a", { id: "hidden-link", href: "#example" }, "Hidden link"),
			),
			h(Button, { id: "until-found", hidden: true }, "Findable button"),
			h(SegmentedControl, {
				id: "hidden-segmented",
				hidden: true,
				className: "inline-flex",
				"aria-label": "Hidden segmented control",
				options: [{ value: "day", label: "Day" }],
			}),
			h(
				PillSelector,
				{
					id: "hidden-pill-group",
					hidden: true,
					className: "flex",
					"aria-label": "Hidden categories",
				},
				h(PillSelectorItem, { value: "all" }, "All"),
			),
			h(
				PillSelector,
				{ "aria-label": "Categories with hidden option" },
				h(
					PillSelectorItem,
					{
						id: "hidden-pill-item",
						hidden: true,
						className: "inline-flex",
						value: "all",
					},
					"All",
				),
			),
			h(
				Button,
				{ asChild: true, variant: "ghost", trailingIcon: FixtureIcon },
				h("a", { id: "link", href: "#example" }, "Link"),
			),
			h(
				Button,
				{
					id: "padding-vars",
					style: {
						"--cline-ui-button-padding-inline": "11px",
					} as CSSProperties,
				},
				"Padding override",
			),
			h(
				Button,
				{
					id: "edge-vars",
					leadingIcon: FixtureIcon,
					trailingIcon: FixtureIcon,
					style: {
						"--cline-ui-button-leading-padding": "6px",
						"--cline-ui-button-trailing-padding": "9px",
					} as CSSProperties,
				},
				"Icon edge overrides",
			),
			h(
				"button",
				{
					id: "helper",
					type: "button",
					className: buttonVariants({ variant: "secondary", tone: "neutral" }),
				},
				"Variant helper",
			),
		),
		h(
			"div",
			{
				style: {
					display: "flex",
					flexWrap: "wrap",
					alignItems: "flex-start",
					gap: 16,
				},
			},
			...segmentedSizes.flatMap(({ size }) =>
				(["text", "icons", "mixed"] as const).map((mode) =>
					h(SegmentedControl, {
						id: `segmented-${size}-${mode}`,
						key: `${size}-${mode}`,
						size,
						"aria-label": `${size} ${mode}`,
						defaultValue: "day",
						iconOnly: mode === "icons",
						options: ["day", "week", "month"].map((value) => ({
							value,
							label: value,
							icon: mode === "text" ? undefined : h(FixtureIcon),
						})),
					}),
				),
			),
		),
	),
);

async function styles(page: Page, selector: string) {
	return page.locator(selector).evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			display: style.display,
			height: style.height,
			width: style.width,
			padding: style.padding,
			paddingInlineStart: style.paddingInlineStart,
			paddingInlineEnd: style.paddingInlineEnd,
			paddingLeft: style.paddingLeft,
			paddingRight: style.paddingRight,
			gap: style.gap,
			fontFamily: style.fontFamily,
			borderWidth: style.borderWidth,
			background: style.backgroundColor,
			whiteSpace: style.whiteSpace,
			textDecoration: style.textDecorationLine,
			outlineStyle: style.outlineStyle,
			outlineWidth: style.outlineWidth,
			focusVisible: element.matches(":focus-visible"),
			scale: style.scale,
		};
	});
}

async function contrast(
	page: Page,
	selector: string,
	property: "color" | "outlineColor",
) {
	return page.locator(selector).evaluate((element, property) => {
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = 1;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas unavailable");
		const rgba = (color: string) => {
			context.clearRect(0, 0, 1, 1);
			context.fillStyle = color;
			context.fillRect(0, 0, 1, 1);
			return Array.from(context.getImageData(0, 0, 1, 1).data);
		};
		const blend = (fg: number[], bg: number[]) =>
			fg
				.slice(0, 3)
				.map(
					(channel, i) => channel * (fg[3] / 255) + bg[i] * (1 - fg[3] / 255),
				);
		const luminance = (rgb: number[]) =>
			rgb.slice(0, 3).reduce((total, channel, i) => {
				const value = channel / 255;
				return (
					total +
					(value <= 0.04045
						? value / 12.92
						: ((value + 0.055) / 1.055) ** 2.4) *
						[0.2126, 0.7152, 0.0722][i]
				);
			}, 0);
		const surface = document.querySelector("#surface");
		if (!surface) throw new Error("Missing surface");
		const style = getComputedStyle(element);
		const behind = rgba(getComputedStyle(surface).backgroundColor);
		const background =
			property === "outlineColor"
				? behind
				: blend(rgba(style.backgroundColor), behind);
		const foreground = blend(rgba(style[property]), background);
		const a = luminance(foreground);
		const b = luminance(background);
		return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
	}, property);
}

async function switchColors(
	page: Page,
	id: string,
	background: string,
	thumb: string,
) {
	return page.locator(`#${id}`).evaluate(
		(input, { background, thumb }) => {
			const root = input.parentElement;
			const track = root?.querySelector(".cline-ui-switch__track");
			const knob = root?.querySelector(".cline-ui-switch__thumb");
			if (!root || !track || !knob) throw new Error("Missing switch fixture");
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = 1;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Canvas unavailable");
			const rgba = (color: string) => {
				assertColor(color);
				context.clearRect(0, 0, 1, 1);
				context.fillStyle = color;
				context.fillRect(0, 0, 1, 1);
				return Array.from(context.getImageData(0, 0, 1, 1).data);
			};
			function assertColor(color: string) {
				if (!CSS.supports("color", color))
					throw new Error(`Invalid switch color: ${color}`);
			}
			const token = (name: string) =>
				rgba(getComputedStyle(root).getPropertyValue(`--${name}`));
			return {
				track: rgba(getComputedStyle(track).backgroundColor),
				thumb: rgba(getComputedStyle(knob).backgroundColor),
				expectedTrack: token(background),
				expectedThumb: thumb === "white" ? rgba("white") : token(thumb),
			};
		},
		{ background, thumb },
	);
}

const browser = await chromium.launch();
try {
	const page = await browser.newPage({
		viewport: { width: 1400, height: 900 },
	});
	let checkedPairs = 0;
	let checkedLayouts = 0;
	let checkedSegmentedLayouts = 0;
	let checkedSwitchStates = 0;
	let minimumContrast = Infinity;
	for (const preflight of [true, false]) {
		const imports = preflight
			? '@import "tailwindcss";'
			: '@layer theme, base, components, utilities; @import "tailwindcss/theme.css" layer(theme); @import "tailwindcss/utilities.css" layer(utilities);';
		const compiled = await compile(
			`${imports} @import "./theme/scoped-tokens.css"; @import "./components.css";`,
			{ base: packageRoot, onDependency() {} },
		);
		await page.setContent(
			`<style>${compiled.build(utilities)}</style>${fixture}`,
		);
		await page.emulateMedia({
			reducedMotion: "no-preference",
			forcedColors: "none",
		});
		for (const id of [
			"hidden-button",
			"hidden-icon-button",
			"hidden-badge",
			"hidden-link",
			"hidden-segmented",
			"hidden-pill-group",
			"hidden-pill-item",
		]) {
			const control = page.locator(`#${id}`);
			assert.equal(
				(await styles(page, `#${id}`)).display,
				"none",
				`${id}/preflight=${preflight}`,
			);
			assert.equal(await control.boundingBox(), null);
			await control.evaluate((element) => element.removeAttribute("hidden"));
			assert.notEqual(
				await control.boundingBox(),
				null,
				`${id} can be shown again`,
			);
			await control.evaluate((element) =>
				element.setAttribute("hidden", "until-found"),
			);
			assert.notEqual(
				(await styles(page, `#${id}`)).display,
				"none",
				`${id} supports find-in-page visibility`,
			);
			await control.evaluate((element) => element.setAttribute("hidden", ""));
		}
		await page.locator("#until-found").evaluate((element) => {
			element.setAttribute("hidden", "until-found");
		});
		assert.notEqual((await styles(page, "#until-found")).display, "none");
		for (const rootSize of [15, 16, 20]) {
			await page.evaluate((size) => {
				document.documentElement.style.fontSize = `${size}px`;
			}, rootSize);
			for (const { size, height, icon } of segmentedSizes) {
				for (const mode of ["text", "icons", "mixed"]) {
					const selector = `#segmented-${size}-${mode}`;
					const context = `${selector}/root=${rootSize}/preflight=${preflight}`;
					assert.equal(
						(await styles(page, selector)).height,
						`${height * rootSize}px`,
						context,
					);
					if (mode !== "text") {
						const iconSize = await styles(
							page,
							`${selector} .cline-ui-segmented-control__option:first-child svg`,
						);
						assert.equal(iconSize.width, `${icon * rootSize}px`, context);
						assert.equal(iconSize.height, `${icon * rootSize}px`, context);
					}
					checkedSegmentedLayouts++;
				}
			}
		}
		await page.evaluate(() =>
			document.documentElement.style.removeProperty("font-size"),
		);
		const ghost = await styles(page, "#ghost-neutral");
		assert.equal(ghost.borderWidth, "0px");
		assert.equal(ghost.background, "rgba(0, 0, 0, 0)");
		assert.equal(ghost.fontFamily, "monospace");
		assert.equal((await styles(page, "#icon")).padding, "0px");
		assert.equal((await styles(page, "#link")).textDecoration, "none");
		assert.equal((await styles(page, "#helper")).height, "36px");
		assert.equal(
			(await styles(page, "#padding-vars")).paddingInlineStart,
			"11px",
		);
		assert.equal(
			(await styles(page, "#padding-vars")).paddingInlineEnd,
			"11px",
		);
		assert.equal((await styles(page, "#edge-vars")).paddingInlineStart, "6px");
		assert.equal((await styles(page, "#edge-vars")).paddingInlineEnd, "9px");
		for (const direction of ["ltr", "rtl"]) {
			await page.locator(".cline-ui-theme").evaluate((element, direction) => {
				element.setAttribute("dir", direction);
			}, direction);
			for (const size of sizes) {
				for (const [layout, start, end, gap] of [
					["text", size.padding, size.padding, size.gap],
					["leading", size.leadingPadding, size.padding, size.iconGap],
					["trailing", size.padding, size.trailingPadding, size.iconGap],
					["both", size.leadingPadding, size.trailingPadding, size.iconGap],
					["unmarked", size.padding, size.padding, size.gap],
					["wrapped", size.padding, size.padding, size.gap],
					["nested", size.padding, size.padding, size.gap],
				] as const) {
					const selector = `#${layout}-${size.size}`;
					const button = await styles(page, selector);
					const context = `${selector}/${direction}/preflight=${preflight}`;
					assert.equal(button.height, `${size.height}px`, context);
					assert.equal(button.paddingInlineStart, `${start}px`, context);
					assert.equal(button.paddingInlineEnd, `${end}px`, context);
					assert.equal(
						button.paddingLeft,
						`${direction === "rtl" ? end : start}px`,
						context,
					);
					assert.equal(
						button.paddingRight,
						`${direction === "rtl" ? start : end}px`,
						context,
					);
					assert.equal(button.gap, `${gap}px`, context);
					checkedLayouts++;
				}
				for (const layout of ["unmarked", "wrapped", "nested"]) {
					const svg = await styles(page, `#${layout}-${size.size} svg`);
					assert.equal(
						svg.width,
						`${size.icon}px`,
						`${layout} SVG width preserves the legacy size default`,
					);
					assert.equal(
						svg.height,
						`${size.icon}px`,
						`${layout} SVG height preserves the legacy size default`,
					);
				}
				for (const layout of ["icon", "legacy-icon"]) {
					const iconOnly = await styles(page, `#${layout}-${size.size}`);
					assert.equal(iconOnly.height, `${size.height}px`);
					assert.equal(iconOnly.width, `${size.height}px`);
					assert.equal(iconOnly.padding, "0px");
					assert.equal(iconOnly.gap, "0px");
					checkedLayouts++;
				}
				for (const [kind, expected] of [
					["button", size.icon],
					["icon", size.iconOnly],
				] as const) {
					for (const override of [false, true]) {
						const selector = `#helper-${kind}-${size.size}${override ? "-override" : ""} svg`;
						const svg = await styles(page, selector);
						const pixels = `${override ? 24 : expected}px`;
						assert.equal(svg.width, pixels, `${selector} width`);
						assert.equal(svg.height, pixels, `${selector} height`);
					}
				}
				for (const [selector, expected] of [
					[`#leading-${size.size} svg`, size.icon],
					[`#icon-${size.size} svg`, size.iconOnly],
					[`#legacy-icon-${size.size} svg`, size.iconOnly],
				] as const) {
					const svg = await styles(page, selector);
					assert.equal(svg.width, `${expected}px`);
					assert.equal(svg.height, `${expected}px`);
				}
			}
			const link = await styles(page, "#link");
			assert.equal(link.paddingInlineStart, "14px");
			assert.equal(link.paddingInlineEnd, "8px");
		}
		await page.locator(".cline-ui-theme").evaluate((element) => {
			element.setAttribute("dir", "ltr");
		});
		const override = await styles(page, "#override");
		assert.equal(override.height, "28px");
		assert.equal(override.padding, "0px");
		assert.equal(override.gap, "0px");
		assert.equal(override.whiteSpace, "normal");
		assert.equal(
			(await styles(page, "#override svg:first-child")).width,
			"20px",
		);
		assert.equal(
			(await styles(page, "#override svg:first-child")).height,
			"20px",
		);
		assert.equal((await styles(page, "#icon-override svg")).width, "18px");
		assert.equal((await styles(page, "#icon-override svg")).height, "18px");
		assert.equal((await styles(page, "#icon-override")).width, "24px");
		assert.equal((await styles(page, "#icon-override")).height, "24px");
		for (const id of ["legacy-size-override", "legacy-icon-size-override"]) {
			const svg = await styles(page, `#${id} svg`);
			assert.equal(svg.width, "24px", `${id} honors the explicit size class`);
			assert.equal(svg.height, "24px", `${id} honors the explicit size class`);
		}
		const legacyLink = await styles(page, "#legacy-icon-link");
		assert.equal(legacyLink.width, "32px");
		assert.equal(legacyLink.height, "32px");
		assert.equal((await styles(page, "#legacy-icon-link svg")).width, "16px");
		assert.equal((await styles(page, "#legacy-icon-link svg")).height, "16px");
		const preview = await styles(page, "#managed-with-preview span svg");
		assert.equal(preview.width, "48px");
		assert.equal(preview.height, "32px");

		for (const mode of ["light", "dark"]) {
			await page
				.locator(".cline-ui-theme")
				.evaluate(
					(element, dark) => element.classList.toggle("dark", dark),
					mode === "dark",
				);
			for (const surface of ["surface-1", "surface-2", "surface-3"]) {
				await page.locator("#surface").evaluate((element, surface) => {
					(element as HTMLElement).style.backgroundColor = `var(--${surface})`;
				}, surface);
				for (const variant of variants)
					for (const tone of tones) {
						const selector = `#${variant}-${tone}`;
						for (const hover of [false, true]) {
							if (hover) await page.locator(selector).hover();
							else await page.mouse.move(0, 0);
							const ratio = await contrast(page, selector, "color");
							assert.ok(
								ratio >= 4.5,
								`${mode}/${surface}/${variant}/${tone}/${hover ? "hover" : "rest"}: ${ratio.toFixed(2)}:1`,
							);
							minimumContrast = Math.min(minimumContrast, ratio);
							checkedPairs++;
						}
					}
				for (const tone of ["accent", "neutral"] as const) {
					const id = `switch-${tone}`;
					const input = page.locator(`#${id}`);
					const checkColors = async (
						state: string,
						background: string,
						thumb: string,
					) => {
						const colors = await switchColors(page, id, background, thumb);
						const context = `${id}/${mode}/${surface}/${state}/preflight=${preflight}`;
						assert.deepEqual(
							colors.track,
							colors.expectedTrack,
							`${context} track`,
						);
						assert.deepEqual(
							colors.thumb,
							colors.expectedThumb,
							`${context} thumb`,
						);
						checkedSwitchStates++;
					};
					for (const checked of [true, false]) {
						await input.setChecked(checked);
						for (const hover of [false, true]) {
							if (hover) await input.hover();
							else await page.mouse.move(0, 0);
							const background = checked
								? tone === "accent"
									? hover
										? "primary-emphasis"
										: "primary"
									: hover
										? "neutral-solid-hover"
										: "neutral-solid"
								: hover
									? "cline-ui-switch-off-hover-background"
									: "cline-ui-switch-off-background";
							const thumb = checked
								? tone === "accent"
									? "primary-foreground"
									: "neutral-contrast"
								: "white";
							await checkColors(
								`${checked ? "checked" : "unchecked"}/${hover ? "hover" : "rest"}`,
								background,
								thumb,
							);
						}
						await input.evaluate((element) => {
							(element as HTMLInputElement).disabled = true;
						});
						await checkColors(
							`${checked ? "checked" : "unchecked"}/disabled`,
							"surface-hover-darker",
							"cline-ui-switch-disabled-thumb-background",
						);
						await input.evaluate((element) => {
							(element as HTMLInputElement).disabled = false;
						});
					}
					await page.mouse.move(0, 0);
					await page.keyboard.press("Tab");
					await input.focus();
					const trackSelector = `#${id} + .cline-ui-switch__track`;
					const focus = await styles(page, trackSelector);
					assert.equal(focus.outlineStyle, "solid");
					assert.equal(focus.outlineWidth, "2px");
					assert.ok(
						(await contrast(page, trackSelector, "outlineColor")) >= 3,
						`${id} focus contrast`,
					);
				}
				await page.locator("#ghost-neutral").focus();
				assert.ok(
					(await contrast(page, "#ghost-neutral", "outlineColor")) >= 3,
				);
			}
		}

		await page.locator("#primary-accent").focus();
		await page.keyboard.press("Tab");
		const focused = page.locator(":focus");
		assert.ok(
			await focused.evaluate((element) => element.matches(":focus-visible")),
		);
		await page.emulateMedia({ forcedColors: "active" });
		const forced = await styles(page, ":focus");
		assert.equal(forced.outlineStyle, "solid");
		assert.equal(forced.outlineWidth, "2px");
		await page.emulateMedia({ forcedColors: "none" });

		for (const [selector, expected] of [
			["#primary-accent", "0.98"],
			["#custom-scale", "0.94"],
			["#no-scale", "none"],
			["#disabled", "none"],
		]) {
			const bounds = await page.locator(selector).boundingBox();
			assert.ok(bounds);
			await page.mouse.move(
				bounds.x + bounds.width / 2,
				bounds.y + bounds.height / 2,
			);
			await page.mouse.down();
			await page.waitForFunction(
				({ selector, expected }) =>
					getComputedStyle(document.querySelector(selector) as Element)
						.scale === expected,
				{ selector, expected },
			);
			await page.emulateMedia({ reducedMotion: "reduce" });
			assert.equal((await styles(page, selector)).scale, "none");
			await page.mouse.up();
			await page.emulateMedia({ reducedMotion: "no-preference" });
		}
	}
	console.log(
		`Button browser checks passed with and without Preflight: ${checkedLayouts} LTR/RTL icon layouts, ${checkedSegmentedLayouts} segmented layouts at three root sizes, ${checkedSwitchStates} accent/neutral switch states, ${checkedPairs} text contrast pairs (minimum ${minimumContrast.toFixed(2)}:1), hidden controls, focus, forced colors, overrides, and reduced motion.`,
	);
} finally {
	await browser.close();
}
