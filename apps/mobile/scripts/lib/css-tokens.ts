/**
 * Parses the vendored `design/theme.css` snapshot and renders the typed
 * `src/theme/tokens.ts` module. Everything here is pure except the small
 * filesystem helpers at the bottom, so it is unit-testable without Expo.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isOklch, oklchToHex } from "./oklch";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const THEME_CSS_PATH = join(packageRoot, "design", "theme.css");
export const THEME_SHA_PATH = join(packageRoot, "design", "theme.css.sha256");
export const TOKENS_PATH = join(packageRoot, "src", "theme", "tokens.ts");

/** Root pixel size used to turn `rem` lengths into React Native numbers. */
export const ROOT_FONT_SIZE = 16;

const VARIABLE_PREFIX = "--cline-";

/** Kinds emitted as numbers; everything else stays a string. */
const NUMERIC_KINDS = new Set(["radius"]);

/**
 * Group order in the generated module. Kinds not listed here still get emitted,
 * appended alphabetically, so a new `--cline-<kind>-*` family cannot silently
 * disappear.
 */
const KIND_ORDER = [
	"color",
	"font",
	"hsl",
	"radius",
	"shadow",
	"duration",
	"ease",
];

export type TokenValue = string | number;
export type TokenGroups = Record<string, Record<string, TokenValue>>;

export interface Themes {
	readonly light: TokenGroups;
	readonly dark: TokenGroups;
}

export interface ClassifiedVariable {
	readonly kind: string;
	readonly key: string;
}

/** `surface-raised` -> `surfaceRaised`, `brand-500` -> `brand500`. */
function camelCase(text: string): string {
	return text.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

/** `--cline-color-surface-raised` -> `{ kind: "color", key: "surfaceRaised" }`. */
export function classifyVariable(
	property: string,
): ClassifiedVariable | undefined {
	if (!property.startsWith(VARIABLE_PREFIX)) return undefined;
	const rest = property.slice(VARIABLE_PREFIX.length);
	const separator = rest.indexOf("-");
	if (separator <= 0 || separator === rest.length - 1) return undefined;
	return {
		kind: rest.slice(0, separator),
		key: camelCase(rest.slice(separator + 1)),
	};
}

function stripComments(css: string): string {
	return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

interface CssBlock {
	readonly selectors: string[];
	readonly declarations: Map<string, string>;
}

/** Splits on `;` / `:` at paren depth zero so `rgb(0 0 0 / .1)` stays intact. */
function parseDeclarations(body: string): Map<string, string> {
	const declarations = new Map<string, string>();
	let depth = 0;
	let start = 0;
	const chunks: string[] = [];

	for (let i = 0; i < body.length; i++) {
		const char = body[i];
		if (char === "(") depth++;
		else if (char === ")") depth--;
		else if (char === ";" && depth === 0) {
			chunks.push(body.slice(start, i));
			start = i + 1;
		}
	}
	chunks.push(body.slice(start));

	for (const chunk of chunks) {
		if (chunk.trim() === "") continue;
		let colon = -1;
		depth = 0;
		for (let i = 0; i < chunk.length; i++) {
			const char = chunk[i];
			if (char === "(") depth++;
			else if (char === ")") depth--;
			else if (char === ":" && depth === 0) {
				colon = i;
				break;
			}
		}
		if (colon === -1) continue;
		const property = chunk.slice(0, colon).trim();
		const value = chunk
			.slice(colon + 1)
			.replace(/\s+/g, " ")
			.trim();
		if (property === "") continue;
		declarations.set(property, value);
	}

	return declarations;
}

function parseBlocks(css: string): CssBlock[] {
	const source = stripComments(css);
	const blocks: CssBlock[] = [];
	let cursor = 0;

	while (cursor < source.length) {
		const open = source.indexOf("{", cursor);
		if (open === -1) break;
		const selectorText = source.slice(cursor, open).trim();

		let depth = 1;
		let close = open + 1;
		while (close < source.length && depth > 0) {
			if (source[close] === "{") depth++;
			else if (source[close] === "}") depth--;
			if (depth === 0) break;
			close++;
		}

		blocks.push({
			selectors: selectorText
				.split(",")
				.map((s) => s.replace(/\s+/g, " ").trim())
				.filter(Boolean),
			declarations: parseDeclarations(source.slice(open + 1, close)),
		});
		cursor = close + 1;
	}

	return blocks;
}

function isDarkSelector(selector: string): boolean {
	return selector === ".dark" || selector === ":root.dark";
}

function isLightRootSelector(selector: string): boolean {
	return selector === ":root";
}

/**
 * Raw custom properties per theme. `light` is the `:root` block; `dark` holds
 * only what the `.dark` / `:root.dark` block redeclares.
 */
export function parseThemeCss(css: string): {
	light: Map<string, string>;
	dark: Map<string, string>;
} {
	const light = new Map<string, string>();
	const dark = new Map<string, string>();

	for (const block of parseBlocks(css)) {
		const target = block.selectors.some(isDarkSelector)
			? dark
			: block.selectors.some(isLightRootSelector)
				? light
				: undefined;
		if (!target) continue;
		for (const [property, value] of block.declarations) {
			if (!property.startsWith(VARIABLE_PREFIX)) continue;
			target.set(property, value);
		}
	}

	return { light, dark };
}

const VAR_REFERENCE = /^var\(\s*(--[a-z0-9-]+)\s*(?:,([\s\S]*))?\)$/i;

/** Follows `var(--x)` chains within one theme; falls back to a var() default. */
function resolveReferences(
	value: string,
	scope: Map<string, string>,
	seen: Set<string> = new Set(),
): string {
	const match = VAR_REFERENCE.exec(value.trim());
	if (!match) return value;

	const [, name, fallback] = match;
	if (seen.has(name)) {
		throw new Error(`Circular var() reference through ${name}`);
	}
	seen.add(name);

	const referenced = scope.get(name);
	if (referenced !== undefined) {
		return resolveReferences(referenced, scope, seen);
	}
	if (fallback !== undefined) {
		return resolveReferences(fallback.trim(), scope, seen);
	}
	throw new Error(`Unresolved var() reference: ${name}`);
}

/** rem -> px, oklch -> hex, everything else verbatim. */
function convertValue(kind: string, raw: string): TokenValue {
	if (isOklch(raw)) return oklchToHex(raw);

	const rem = /^(-?[0-9]*\.?[0-9]+)rem$/.exec(raw);
	if (rem) return Number.parseFloat(rem[1]) * ROOT_FONT_SIZE;

	const px = /^(-?[0-9]*\.?[0-9]+)px$/.exec(raw);
	if (px) return Number.parseFloat(px[1]);

	if (NUMERIC_KINDS.has(kind)) {
		const bare = Number.parseFloat(raw);
		if (Number.isFinite(bare) && String(bare) === raw) return bare;
	}

	// Fonts, shadows, durations, easings and raw hsl triples pass through.
	return raw;
}

function sortKinds(kinds: string[]): string[] {
	return [...kinds].sort((a, b) => {
		const ai = KIND_ORDER.indexOf(a);
		const bi = KIND_ORDER.indexOf(b);
		if (ai !== -1 && bi !== -1) return ai - bi;
		if (ai !== -1) return -1;
		if (bi !== -1) return 1;
		return a.localeCompare(b);
	});
}

function toGroups(scope: Map<string, string>): TokenGroups {
	const groups: TokenGroups = {};
	// Preserve declaration order within each group; it mirrors the stylesheet.
	for (const [property, raw] of scope) {
		const classified = classifyVariable(property);
		if (!classified) continue;
		const { kind, key } = classified;
		const resolved = resolveReferences(raw, scope);
		groups[kind] ??= {};
		groups[kind][key] = convertValue(kind, resolved);
	}

	const ordered: TokenGroups = {};
	for (const kind of sortKinds(Object.keys(groups))) {
		ordered[kind] = groups[kind];
	}
	return ordered;
}

/**
 * Light comes straight from `:root`. Dark starts as a copy of light and then
 * applies the dark block, so every token exists in both themes and dark
 * inherits anything it does not redeclare.
 */
export function buildThemes(css: string): Themes {
	const { light, dark } = parseThemeCss(css);
	if (light.size === 0) {
		throw new Error(
			`No ${VARIABLE_PREFIX}* variables found in the :root block`,
		);
	}

	const darkScope = new Map(light);
	for (const [property, value] of dark) {
		darkScope.set(property, value);
	}

	return { light: toGroups(light), dark: toGroups(darkScope) };
}

function literal(value: TokenValue): string {
	if (typeof value === "number") return String(value);
	// Font stacks contain double quotes; single-quoting avoids escape noise and
	// matches how Biome formats such strings.
	if (value.includes('"') && !value.includes("'") && !value.includes("\\")) {
		return `'${value}'`;
	}
	return JSON.stringify(value);
}

function renderInterface(groups: TokenGroups): string {
	const lines = ["export interface ThemeTokens {"];
	for (const [kind, entries] of Object.entries(groups)) {
		lines.push(`\treadonly ${kind}: {`);
		for (const [key, value] of Object.entries(entries)) {
			lines.push(`\t\treadonly ${key}: ${typeof value};`);
		}
		lines.push("\t};");
	}
	lines.push("}");
	return lines.join("\n");
}

function renderThemeObject(
	declaration: string,
	groups: TokenGroups,
	suffix: string,
): string {
	const lines = [`${declaration} {`];
	for (const [kind, entries] of Object.entries(groups)) {
		lines.push(`\t${kind}: {`);
		for (const [key, value] of Object.entries(entries)) {
			lines.push(`\t\t${key}: ${literal(value)},`);
		}
		lines.push("\t},");
	}
	lines.push(`}${suffix}`);
	return lines.join("\n");
}

/** Renders the full `src/theme/tokens.ts` source text. */
export function emitTokensModule(themes: Themes, sourceHash: string): string {
	const banner = [
		"/**",
		" * GENERATED FILE - do not edit by hand.",
		" *",
		" * Source:    design/theme.css (vendored snapshot of",
		" *            @cline/design-tokens src/theme.css)",
		` * SHA-256:   ${sourceHash}`,
		" * Regenerate: bun run tokens:generate",
		" * Verify:     bun run tokens:check",
		" *",
		` * oklch() colors are converted to sRGB hex; rem lengths to px (1rem = ${ROOT_FONT_SIZE}).`,
		" * Fonts, shadows, durations, easings and raw hsl triples pass through verbatim.",
		" */",
	].join("\n");

	return [
		banner,
		"",
		renderInterface(themes.light),
		"",
		renderThemeObject(
			"export const lightTokens =",
			themes.light,
			" as const satisfies ThemeTokens;",
		),
		"",
		renderThemeObject(
			"export const darkTokens: ThemeTokens =",
			themes.dark,
			";",
		),
		"",
	].join("\n");
}

export function sha256(input: string | Uint8Array): string {
	return createHash("sha256").update(input).digest("hex");
}

/** Reads the vendored css and renders the module, returning both. */
export function renderTokensModule(): { source: string; hash: string } {
	const css = readFileSync(THEME_CSS_PATH, "utf8");
	const hash = sha256(readFileSync(THEME_CSS_PATH));
	return { source: emitTokensModule(buildThemes(css), hash), hash };
}
