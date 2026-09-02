import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

describe("@cline/ui theme contract", () => {
	it("owns complete Radix 3.0.0 solid and alpha palettes", () => {
		const palette = read("palette.css");
		const light = block(palette, ":root");
		const dark = block(palette, ".dark");

		expect(palette).toContain("Radix Colors 3.0.0");
		expect(palette).not.toContain("display-p3");
		expect(palette).not.toMatch(
			/--(?:slate|violet|ruby|green|amber|sky)-(?:a)?\d+:/,
		);
		for (const mode of [light, dark]) {
			for (const paletteName of paletteNames) {
				for (let step = 1; step <= 12; step += 1) {
					expect(mode).toContain(`--${paletteName}-${step}:`);
					expect(mode).toContain(`--${paletteName}-a${step}:`);
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
			expect(shared).toContain(`--${token}:`);
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

		expect(shared).toContain("--primary: var(--accent-9);");
		expect(shared).toContain("--primary-emphasis: var(--accent-10);");
		expect(shared).toContain("--ring: var(--focus-ring);");
		expect(shared).toContain("--destructive: var(--error-solid);");
		for (const status of ["success", "warning", "error", "info"]) {
			expect(shared).toContain(`--${status}-surface: var(--${status}-a3);`);
			expect(shared).toContain(`--${status}-border: var(--${status}-a7);`);
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
