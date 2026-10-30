import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	FALLBACK_MERMAID_TOKENS,
	parseCssColor,
	type RgbaColor,
	rgbToHex,
} from "../components/mermaid-diagram";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const themeDir = join(packageRoot, "theme");
const componentsDir = join(packageRoot, "components");
const read = (name: string) => readFileSync(join(themeDir, name), "utf8");
const readComponent = (name: string) =>
	readFileSync(join(componentsDir, name), "utf8");

const paletteNames = [
	"neutral",
	"accent",
	"error",
	"success",
	"warning",
	"info",
] as const;

const visualRoleTokens = [
	"surface-1",
	"surface-2",
	"surface-3",
	"surface-hover",
	"surface-hover-lighter",
	"surface-hover-darker",
	"text-1",
	"text-2",
	"text-disabled",
	"border-1",
	"border-2",
	"focus-ring",
];

const statusRoleTokens = ["success", "warning", "error", "info"].flatMap(
	(status) =>
		["surface", "border", "solid", "text", "contrast"].map(
			(role) => `${status}-${role}`,
		),
);

const semanticTokens = [
	"background",
	"foreground",
	"card",
	"card-foreground",
	"popover",
	"popover-foreground",
	"primary",
	"primary-foreground",
	"primary-emphasis",
	"secondary",
	"secondary-foreground",
	"muted",
	"muted-foreground",
	"accent",
	"accent-foreground",
	"destructive",
	"destructive-foreground",
	"border",
	"input",
	"ring",
	"chart-1",
	"chart-2",
	"chart-3",
	"chart-4",
	"chart-5",
	"sidebar",
	"sidebar-foreground",
	"sidebar-primary",
	"sidebar-primary-foreground",
	"sidebar-accent",
	"sidebar-accent-foreground",
	"sidebar-border",
	"sidebar-ring",
	"scrollbar-thumb",
	"scrollbar-thumb-hover",
	"selection-background",
];

const brandTokens = [
	"brand-violet",
	"brand-lilac",
	"brand-magenta",
	"brand-periwinkle",
	"brand-cyan",
];

const mappedColorTokens = [
	...visualRoleTokens,
	...statusRoleTokens,
	...semanticTokens.filter(
		(token) =>
			![
				"scrollbar-thumb",
				"scrollbar-thumb-hover",
				"selection-background",
			].includes(token),
	),
	...brandTokens,
];

function removeComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function removeImports(source: string): string {
	return source.replace(/^\s*@import\s+["'][^"']+["'];\s*/gm, "");
}

function topLevelRules(source: string): Array<{
	selector: string;
	body: string;
}> {
	const css = removeImports(removeComments(source));
	const rules: Array<{ selector: string; body: string }> = [];
	let cursor = 0;
	while (cursor < css.length) {
		while (/\s/.test(css[cursor] ?? "")) cursor += 1;
		if (cursor >= css.length) break;
		const open = css.indexOf("{", cursor);
		if (open < 0) throw new Error("Unexpected text outside a CSS rule");
		const selector = css.slice(cursor, open).trim();
		let depth = 1;
		let close = open + 1;
		while (close < css.length && depth > 0) {
			if (css[close] === "{") depth += 1;
			if (css[close] === "}") depth -= 1;
			close += 1;
		}
		if (depth !== 0) throw new Error(`Unclosed ${selector} rule`);
		rules.push({ selector, body: css.slice(open + 1, close - 1) });
		cursor = close;
	}
	return rules;
}

function block(source: string, selector: string): string {
	const start = source.indexOf(`${selector} {`);
	if (start < 0) throw new Error(`Missing ${selector} block`);
	const bodyStart = source.indexOf("{", start) + 1;
	let depth = 1;
	for (let index = bodyStart; index < source.length; index += 1) {
		if (source[index] === "{") depth += 1;
		if (source[index] === "}") depth -= 1;
		if (depth === 0) return source.slice(bodyStart, index);
	}
	throw new Error(`Unclosed ${selector} block`);
}

function expectVariableOnlyRules(source: string): void {
	for (const rule of topLevelRules(source)) {
		const declarations = rule.body
			.split(";")
			.map((declaration) => declaration.trim())
			.filter(Boolean);
		expect(declarations.length).toBeGreaterThan(0);
		for (const declaration of declarations) {
			expect(declaration).toMatch(/^--[a-z0-9-]+\s*:/);
		}
	}
}

function declarations(source: string): Record<string, string> {
	return Object.fromEntries(
		Array.from(
			removeComments(source).matchAll(/--([\w-]+):\s*([^;]+);/g),
			([, name, value]) => [name, value.trim()],
		),
	);
}

function themeValues(selector: ":root" | ".dark"): Record<string, string> {
	const palette = read("palette.css");
	const tokens = read("tokens.css");
	return {
		...declarations(block(palette, ":root")),
		...declarations(block(palette, selector)),
		...declarations(block(tokens, ":root")),
		...declarations(block(tokens, selector)),
		...declarations(block(tokens, ":root,\n.dark")),
	};
}

function tokenColor(
	values: Record<string, string>,
	token: string,
	visited = new Set<string>(),
): RgbaColor {
	if (visited.has(token)) throw new Error(`Circular color token ${token}`);
	visited.add(token);
	const value = values[token];
	if (!value) throw new Error(`Missing color token ${token}`);
	const alias = /^var\(--([\w-]+)\)$/.exec(value)?.[1];
	if (alias) return tokenColor(values, alias, visited);
	const mix =
		/^color-mix\(\s*in srgb,\s*var\(--([\w-]+)\)\s+(\d+)%,\s*(#[\da-f]+|var\(--([\w-]+)\))\s*\)$/.exec(
			value,
		);
	if (mix) {
		const base = tokenColor(values, mix[1], new Set(visited));
		const other = mix[4]
			? tokenColor(values, mix[4], new Set(visited))
			: parseCssColor(mix[3]);
		if (!other || base.a !== 1 || other.a !== 1) {
			throw new Error(`Unsupported mixed color token ${token}: ${value}`);
		}
		const weight = Number(mix[2]) / 100;
		return {
			r: base.r * weight + other.r * (1 - weight),
			g: base.g * weight + other.g * (1 - weight),
			b: base.b * weight + other.b * (1 - weight),
			a: 1,
		};
	}
	const color = parseCssColor(value);
	if (!color) throw new Error(`Invalid color token ${token}: ${value}`);
	return color;
}

function colorRgb(color: RgbaColor, background?: number[]): number[] {
	if (color.a !== 1 && !background) {
		throw new Error("Alpha color needs a compositing background");
	}
	return [color.r, color.g, color.b].map(
		(channel, index) =>
			(channel / 255) * color.a + (background?.[index] ?? 0) * (1 - color.a),
	);
}

function luminance(channels: number[]): number {
	const [red, green, blue] = channels.map((value) =>
		value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
	);
	return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrastRatio(first: number[], second: number[]): number {
	const values = [luminance(first), luminance(second)];
	return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

describe("@cline/ui theme contract", () => {
	it("owns complete Cline brand and Radix solid and alpha palettes", () => {
		const palette = read("palette.css");
		const light = block(palette, ":root");
		const dark = block(palette, ".dark");

		expect(palette).toContain("Radix Colors 3.0.0");
		for (const name of ["Iris", "Vermilion", "Emerald"]) {
			expect(palette).toContain(name);
		}
		expect(palette).not.toContain("display-p3");
		expect(palette).not.toMatch(
			/--(?:slate|violet|ruby|green|amber|sky)-(?:a)?\d+:/,
		);
		for (const mode of [light, dark]) {
			const values = declarations(mode);
			for (const paletteName of paletteNames) {
				for (let step = 1; step <= 12; step += 1) {
					expect(mode).toContain(`--${paletteName}-${step}:`);
					expect(mode).toContain(`--${paletteName}-a${step}:`);
					for (const alpha of ["", "a"]) {
						const token = `${paletteName}-${alpha}${step}`;
						const color = tokenColor(values, token);
						expect(color.a).toBeGreaterThanOrEqual(0);
						expect(color.a).toBeLessThanOrEqual(1);
						if (!alpha) expect(color.a).toBe(1);
						if (["accent", "error", "success"].includes(paletteName)) {
							expect(values[token]).toMatch(/^oklch\(/);
						}
					}
				}
			}
			expect(
				Array.from(mode.matchAll(/--[a-z]+-(?:a)?(?:[1-9]|1[0-2]):/g)),
			).toHaveLength(144);
		}
		expect(topLevelRules(palette).map((rule) => rule.selector)).toEqual([
			":root",
			".dark",
		]);
		expectVariableOnlyRules(palette);
	});

	it("maps readable roles onto the palettes and preserves shadcn names", () => {
		const tokens = read("tokens.css");
		const shared = block(tokens, ":root,\n.dark");
		const root = block(tokens, ":root");
		const dark = block(tokens, ".dark");

		expect(tokens).toContain('@import "@cline/ui/theme/palette.css";');
		expect(tokens).not.toContain("--cline-");
		for (const token of [
			...visualRoleTokens,
			...statusRoleTokens,
			...semanticTokens,
		]) {
			if (
				[
					"primary",
					"success-solid",
					"error-solid",
					"success-text",
					"error-text",
					"warning-contrast",
					"info-contrast",
				].includes(token)
			) {
				expect(root).toContain(`--${token}:`);
				expect(dark).toContain(`--${token}:`);
				expect(shared).not.toContain(`--${token}:`);
			} else {
				expect(shared).toContain(`--${token}:`);
			}
		}
		for (const token of brandTokens) {
			expect(root).toContain(`--${token}:`);
			expect(dark).toContain(`--${token}:`);
		}
		for (const [token, value] of [
			["normal", 480],
			["medium", 560],
			["semibold", 640],
			["bold", 640],
		] as const) {
			expect(root).toContain(`--font-weight-${token}: ${value};`);
		}
		for (const [token, value] of [
			["normal", 400],
			["medium", 500],
			["semibold", 600],
			["bold", 600],
		] as const) {
			expect(dark).toContain(`--font-weight-${token}: ${value};`);
		}
		for (const token of [
			"--font-sans:",
			"--font-mono:",
			"--font-weight-normal:",
			"--font-weight-bold:",
			"--text-xs:",
			"--text-6xl:",
		]) {
			expect(root).toContain(token);
		}

		expect(root).toContain("--primary: var(--accent-9);");
		expect(dark).toContain(
			"--primary: color-mix(in srgb, var(--accent-8) 60%, var(--accent-7));",
		);
		expect(shared).toMatch(
			/--primary-emphasis:\s*color-mix\(\s*in srgb,\s*var\(--primary\) 90%,\s*#000\s*\);/,
		);
		expect(shared).toContain("--primary-foreground: #fff;");
		expect(shared).toContain("--sidebar-primary: var(--primary);");
		expect(shared).toContain(
			"--sidebar-primary-foreground: var(--primary-foreground);",
		);
		for (const status of ["success", "error"]) {
			expect(root).toContain(
				`--${status}-solid: var(--${status}-${status === "success" ? 10 : 9});`,
			);
			expect(dark).toContain(`--${status}-solid: var(--${status}-6);`);
			expect(root).toContain(`--${status}-text: var(--${status}-10);`);
			expect(dark).toContain(`--${status}-text: var(--${status}-9);`);
			expect(shared).toContain(`--${status}-contrast: #fff;`);
		}
		for (const mode of [root, dark]) {
			expect(mode).toContain("--brand-violet: var(--accent-9);");
			expect(mode).toContain("--brand-violet-surface-foreground: #fff;");
		}
		expect(root).toContain("--brand-violet-surface: var(--accent-9);");
		expect(dark).toMatch(
			/--brand-violet-surface:\s*color-mix\(\s*in srgb,\s*var\(--accent-8\) 60%,\s*var\(--accent-7\)\s*\);/,
		);
		expect(shared).toContain("--accent-foreground: var(--accent-11);");
		expect(shared).toContain("--secondary: var(--surface-3);");
		expect(shared).toContain("--secondary-foreground: var(--text-1);");
		expect(shared).toContain("--ring: var(--focus-ring);");
		expect(shared).toContain("--destructive: var(--error-solid);");
		for (const status of ["success", "warning"]) {
			expect(shared).toContain(`--${status}-surface: var(--${status}-2);`);
			expect(shared).toContain(`--${status}-border: var(--${status}-a4);`);
		}
		for (const status of ["error", "info"]) {
			expect(shared).toContain(`--${status}-surface: var(--${status}-2);`);
			expect(shared).toContain(`--${status}-border: var(--${status}-a3);`);
		}
	});

	it.each([
		":root",
		".dark",
	] as const)("keeps labels above 4.5:1 on semantic fills in %s", (selector) => {
		const values = themeValues(selector);
		for (const [fill, foreground] of [
			["primary", "primary-foreground"],
			["sidebar-primary", "sidebar-primary-foreground"],
			["brand-violet-surface", "brand-violet-surface-foreground"],
			["error-solid", "error-contrast"],
			["destructive", "destructive-foreground"],
			["success-solid", "success-contrast"],
			["warning-solid", "warning-contrast"],
			["info-solid", "info-contrast"],
		]) {
			const solid = colorRgb(tokenColor(values, fill));
			const text = colorRgb(tokenColor(values, foreground));
			if (
				selector === ":root" ||
				!["warning-solid", "info-solid"].includes(fill)
			) {
				expect(text, foreground).toEqual([1, 1, 1]);
			}
			expect(contrastRatio(solid, text), fill).toBeGreaterThanOrEqual(4.5);
			// Primary/destructive hover uses an opaque 90% fill / 10% black mix.
			if (fill === "primary" || fill === "destructive") {
				const hover = solid.map((channel) => channel * 0.9);
				expect(
					contrastRatio(hover, text),
					`${fill} hover`,
				).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it.each([
		":root",
		".dark",
	] as const)("keeps small colored text above 4.5:1 on neutral and tinted surfaces in %s", (selector) => {
		const values = themeValues(selector);
		for (const [textToken, tintToken] of [
			["accent-foreground", "accent"],
			["error-text", "error-surface"],
			["success-text", "success-surface"],
			["warning-text", "warning-surface"],
			["info-text", "info-surface"],
		]) {
			const text = colorRgb(tokenColor(values, textToken));
			for (const surface of ["surface-1", "surface-2", "surface-3"]) {
				const background = colorRgb(tokenColor(values, surface));
				const tinted = colorRgb(tokenColor(values, tintToken), background);
				expect(
					contrastRatio(text, background),
					`${textToken} on ${surface}`,
				).toBeGreaterThanOrEqual(4.5);
				expect(
					contrastRatio(text, tinted),
					`${textToken} on ${tintToken} over ${surface}`,
				).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it.each([
		[":root", "light"],
		[".dark", "dark"],
	] as const)("matches Mermaid fallbacks to the %s semantic colors", (selector, mode) => {
		const values = themeValues(selector);
		for (const [mermaidToken, themeToken] of [
			["background", "card"],
			["border", "border"],
			["error", "destructive"],
			["foreground", "foreground"],
			["muted", "muted"],
			["mutedForeground", "muted-foreground"],
			["primary", "primary"],
		] as const) {
			expect(FALLBACK_MERMAID_TOKENS[mode][mermaidToken], mermaidToken).toBe(
				rgbToHex(tokenColor(values, themeToken)),
			);
		}
	});

	it("keeps palette and token sources framework-neutral", () => {
		const palette = read("palette.css");
		const tokens = read("tokens.css");
		const sourcesWithoutComments = removeComments(palette + tokens);
		expect(sourcesWithoutComments).not.toMatch(
			/@(apply|custom-variant|layer|theme|supports|media)\b/,
		);
		expect(topLevelRules(tokens).map((rule) => rule.selector)).toEqual([
			":root",
			".dark",
			":root,\n.dark",
		]);
		expectVariableOnlyRules(tokens);
	});

	it("generates a fully scoped palette and semantic theme", () => {
		const scoped = read("scoped-tokens.css");
		const rules = topLevelRules(scoped);

		expect(scoped).not.toContain("@import");
		expect(rules).toHaveLength(5);
		expect(rules.every((rule) => !rule.selector.includes(":root"))).toBe(true);
		expect(rules.every((rule) => rule.selector !== ".dark")).toBe(true);
		expect(scoped).toContain(".cline-ui-theme");
		expect(scoped).toContain(".dark .cline-ui-theme");
		expect(scoped).toContain(".cline-ui-theme.dark");
		for (const paletteName of paletteNames) {
			expect(scoped).toContain(`--${paletteName}-1:`);
			expect(scoped).toContain(`--${paletteName}-a12:`);
		}
		expect(scoped).toContain("--background: var(--surface-1);");
		const globalRules = [
			...topLevelRules(read("palette.css")),
			...topLevelRules(read("tokens.css")),
		];
		expect(rules.map((rule) => declarations(rule.body))).toEqual(
			globalRules.map((rule) => declarations(rule.body)),
		);
	});

	it("provides Tailwind mappings without registering raw palette steps", () => {
		const theme = read("theme.css");
		const componentTheme = read("component-theme.css");
		const base = read("base.css");
		const markdown = readComponent("markdown.css");
		const index = read("index.css");
		const components = readFileSync(
			join(packageRoot, "components.css"),
			"utf8",
		);

		expect(theme).not.toContain("tokens.css");
		expect(theme).toContain("@custom-variant dark");
		expect(theme).toContain("@theme inline");
		for (const size of [
			"xs",
			"sm",
			"md",
			"base",
			"lg",
			"xl",
			"2xl",
			"3xl",
			"4xl",
			"6xl",
		]) {
			expect(theme).toContain(
				`--text-${size}--letter-spacing: var(--text-${size}--letter-spacing);`,
			);
		}
		for (const token of mappedColorTokens) {
			expect(theme).toContain(`--color-${token}: var(--${token});`);
			expect(componentTheme).toMatch(
				new RegExp(
					`--color-cline-ui-${token}:\\s*var\\(\\s*--${token}\\s*\\);`,
				),
			);
		}
		expect(theme).not.toMatch(
			/--color-(?:neutral|accent|error|success|warning|info)-(?:a)?\d+:/,
		);
		expect(componentTheme).toContain("@custom-variant cline-ui-dark");
		expect(componentTheme).not.toContain("@custom-variant dark ");
		expect(componentTheme).toContain(
			"--font-weight-cline-ui-medium: var(--font-weight-medium);",
		);
		expect(componentTheme).toContain("--text-cline-ui-xs: var(--text-xs);");
		expect(componentTheme).toContain("--text-cline-ui-md: var(--text-md);");
		expect(componentTheme).toContain("--radius-cline-ui-lg: var(--radius-lg);");
		expect(componentTheme).not.toMatch(
			/--color-cline-ui-(?:neutral|accent|error|success|warning|info)-(?:a)?\d+:/,
		);
		expect(components).toContain('@import "./theme/component-theme.css";');
		expect(base).toContain(
			'@import "@cline/ui/components/markdown.css" layer(components);',
		);
		expect(markdown).toContain(":is(.markdown, .cline-markdown)");
		expect(markdown).not.toContain("@apply");
		expect(markdown).not.toContain("@layer");
		expect(base).toContain("--scrollbar-thumb");
		expect(base).toContain("--selection-background");
		expect(base).not.toContain("#__next");
		expect(base).not.toContain("@source");
		expect(index).toBe(
			'@import "@cline/ui/theme/tokens.css";\n@import "@cline/ui/theme/theme.css";\n@import "@cline/ui/theme/base.css";\n',
		);
	});

	it("keeps embedded component utility names host-safe", () => {
		const componentSources = [
			"agent-approval-card.tsx",
			"agent-quick-actions.tsx",
			"search-combobox.tsx",
			"session-status.tsx",
		]
			.map(readComponent)
			.join("\n");
		const genericUtilities = [
			"bg-background",
			"bg-primary",
			"border-border",
			"font-medium",
			"font-mono",
			"outline-ring",
			"rounded-md",
			"rounded-lg",
			"rounded-xl",
			"text-foreground",
			"text-muted-foreground",
			"text-xs",
			"text-sm",
		];
		for (const utility of genericUtilities) {
			expect(componentSources).not.toMatch(
				new RegExp(`(?<![a-z0-9-])${utility}(?![a-z0-9-])`),
			);
		}
		expect(componentSources).not.toMatch(/(?<!cline-ui-)dark:/);
		expect(componentSources).toContain("cline-ui-dark:");
	});

	it("uses status roles in shared components", () => {
		const agentChat = readComponent("agent-chat/agent-chat.css");
		const approval = readComponent("agent-approval-card.css");
		const sessionStatus = readComponent("session-status.css");
		const componentCss = agentChat + approval + sessionStatus;

		expect(agentChat).toContain("var(--success-text)");
		expect(agentChat).toContain("var(--error-surface)");
		expect(agentChat).toContain("var(--error-border)");
		expect(approval).toContain("var(--error-text)");
		expect(sessionStatus).toContain("var(--error-text)");
		expect(componentCss).not.toContain("var(--destructive)");
		expect(componentCss).not.toContain("var(--chart-2)");
	});

	it("preserves the switch accent blend and semantic interaction colors", () => {
		const css = readComponent("switch.css");
		const states = block(css, "@media (forced-colors: none)");
		const track = ".cline-ui-switch__track";
		const input = ".cline-ui-switch__input";

		expect(block(states, `${input}:checked + ${track}`)).toContain(
			"background: color-mix(in srgb, var(--primary) 80%, var(--accent-8) 20%);",
		);
		expect(
			block(states, `${input}:enabled:checked:hover + ${track}`),
		).toContain("background: var(--primary-emphasis);");
		expect(
			block(states, `${input}:enabled:checked:active + ${track}`),
		).toContain("background: var(--primary);");
		expect(block(states, `${input}:focus-visible + ${track}`)).toContain(
			"var(--ring)",
		);
	});

	it("exports every documented CSS entry point", () => {
		const manifest = JSON.parse(
			readFileSync(join(packageRoot, "package.json"), "utf8"),
		) as { exports?: Record<string, string>; files?: string[] };
		for (const subpath of [
			"./components/agent-chat.css",
			"./components/markdown.css",
			"./theme/index.css",
			"./theme/palette.css",
			"./theme/scoped-tokens.css",
			"./theme/tokens.css",
			"./theme/theme.css",
			"./theme/base.css",
		]) {
			const target = manifest.exports?.[subpath];
			expect(target, `missing export ${subpath}`).toBeTypeOf("string");
			expect(existsSync(join(packageRoot, target ?? ""))).toBe(true);
		}
		expect(manifest.files).toContain("RADIX-COLORS-LICENSE");
		expect(existsSync(join(packageRoot, "RADIX-COLORS-LICENSE"))).toBe(true);
	});
});
