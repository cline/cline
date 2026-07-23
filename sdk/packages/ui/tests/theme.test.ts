// @vitest-environment node

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

function declarations(source: string, selector: string): string[] {
	return block(source.replace(/\/\*[\s\S]*?\*\//g, ""), selector)
		.split(";")
		.map((declaration) => declaration.trim().replace(/\s+/g, " "))
		.filter(Boolean)
		.sort();
}

const semanticTokens = [
	"background",
	"foreground",
	"card",
	"card-foreground",
	"popover",
	"popover-foreground",
	"primary",
	"primary-foreground",
	"secondary",
	"secondary-foreground",
	"muted",
	"muted-foreground",
	"accent",
	"accent-foreground",
	"destructive",
	"destructive-foreground",
	"success",
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
	"primary-emphasis",
	"brand-violet",
	"brand-lilac",
	"brand-magenta",
	"brand-periwinkle",
	"brand-cyan",
	"scrollbar-thumb",
	"scrollbar-thumb-hover",
	"selection-background",
];

const mappedColorTokens = [
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
	"success",
	"border",
	"input",
	"ring",
	"chart-1",
	"chart-2",
	"chart-3",
	"chart-4",
	"chart-5",
	"brand-violet",
	"brand-lilac",
	"brand-magenta",
	"brand-periwinkle",
	"brand-cyan",
	"sidebar",
	"sidebar-foreground",
	"sidebar-primary",
	"sidebar-primary-foreground",
	"sidebar-accent",
	"sidebar-accent-foreground",
	"sidebar-border",
	"sidebar-ring",
];

function topLevelRules(source: string): Array<{
	selector: string;
	body: string;
}> {
	const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
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

describe("@cline/ui theme contract", () => {
	it("keeps the shared agent surface vertically composed", () => {
		expect(block(readComponent("welcome.css"), ".cline-ui-agent-surface")).toContain(
			"flex-direction: column",
		);
	});

	it("uses standard semantic and Tailwind token names", () => {
		const tokens = read("tokens.css");
		expect(tokens).not.toContain("--cline-");
		for (const token of semanticTokens) {
			expect(block(tokens, ":root")).toContain(`--${token}:`);
			expect(block(tokens, ".dark")).toContain(`--${token}:`);
		}
		for (const token of [
			"--font-sans:",
			"--font-mono:",
			"--font-weight-normal:",
			"--font-weight-bold:",
			"--text-xs:",
			"--text-6xl:",
		]) {
			expect(block(tokens, ":root")).toContain(token);
		}
	});

	it("keeps the token-only entry point framework-neutral", () => {
		const tokens = read("tokens.css");
		const tokensWithoutComments = tokens.replace(/\/\*[\s\S]*?\*\//g, "");
		expect(tokensWithoutComments).not.toMatch(
			/@(apply|custom-variant|layer|theme)\b/,
		);
		const rules = topLevelRules(tokens);
		expect(rules.map((rule) => rule.selector)).toEqual([":root", ".dark"]);
		for (const rule of rules) {
			const declarations = rule.body
				.split(";")
				.map((declaration) => declaration.trim())
				.filter(Boolean);
			expect(declarations.length).toBeGreaterThan(0);
			for (const declaration of declarations) {
				expect(declaration).toMatch(/^--[a-z0-9-]+\s*:/);
			}
		}
	});

	it("keeps scoped tokens synchronized with the root theme", () => {
		const tokens = read("tokens.css");
		const scoped = read("scoped-tokens.css");
		expect(tokens).toContain("Canonical Cline web theme tokens");
		expect(scoped).toContain("Generated by scripts/generate-theme.ts");
		expect(declarations(scoped, ".cline-ui-theme")).toEqual(
			declarations(tokens, ":root"),
		);
		expect(
			declarations(scoped, ".dark .cline-ui-theme,\n.cline-ui-theme.dark"),
		).toEqual(declarations(tokens, ".dark"));
	});

	it("provides composable Tailwind and optional base entry points", () => {
		const theme = read("theme.css");
		const base = read("base.css");
		const markdown = readComponent("markdown.css");
		const index = read("index.css");

		expect(theme).not.toContain("tokens.css");
		expect(theme).toContain("@custom-variant dark");
		expect(theme).toContain("@theme inline");
		for (const size of [
			"xs",
			"sm",
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
		}
		expect(base).toContain('@import "../components/markdown.css";');
		expect(markdown).toContain(".cline-markdown");
		expect(markdown).toContain(":is(.markdown, .cline-markdown)");
		expect(markdown).not.toContain("@apply");
		for (const token of [
			"--text-sm",
			"--text-sm--letter-spacing",
			"--text-xs",
			"--text-xs--line-height",
			"--text-xs--letter-spacing",
			"--radius-md",
			"--radius-lg",
			"--border",
			"--muted",
			"--muted-foreground",
		]) {
			expect(markdown).toContain(`var(${token})`);
		}
		expect(base).toContain("--scrollbar-thumb");
		expect(base).toContain("--selection-background");
		expect(base).not.toContain("#__next");
		expect(base).not.toContain("@source");
		expect(index).toBe(
			'@import "./tokens.css";\n@import "./theme.css";\n@import "./base.css";\n',
		);
	});

	it("exports every documented CSS entry point", () => {
		const manifest = JSON.parse(
			readFileSync(join(packageRoot, "package.json"), "utf8"),
		) as { exports?: Record<string, string> };
		const documentation = ["README.md", "ADOPTION.md"]
			.map((name) => readFileSync(join(packageRoot, name), "utf8"))
			.join("\n");
		for (const subpath of [
			"./components.css",
			"./components/agent-chat.css",
			"./components/markdown.css",
			"./theme/index.css",
			"./theme/scoped-tokens.css",
			"./theme/tokens.css",
			"./theme/theme.css",
			"./theme/base.css",
		]) {
			const target = manifest.exports?.[subpath];
			expect(target, `missing export ${subpath}`).toBeTypeOf("string");
			expect(existsSync(join(packageRoot, target ?? ""))).toBe(true);
			expect(documentation).toContain(`@cline/ui/${subpath.slice(2)}`);
		}
	});
});
