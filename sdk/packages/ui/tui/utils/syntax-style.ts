import { RGBA, type StyleDefinition, SyntaxStyle } from "@opentui/core";
import type { ResolvedTheme } from "../themes";

// Markdown's prominent elements (headings, bold, list markers, links) take
// the accent of the mode the content was produced in, so assistant output
// reads plan-yellow or act-blue alongside the rest of the transcript.
export type SyntaxAccentMode = "act" | "plan";

const instances = new Map<string, SyntaxStyle>();

function color(hex: string): RGBA {
	return RGBA.fromHex(hex);
}

function fg(hex: string): StyleDefinition {
	return { fg: color(hex) };
}

function bold(hex: string): StyleDefinition {
	return { fg: color(hex), bold: true };
}

function italic(hex: string): StyleDefinition {
	return { fg: color(hex), italic: true };
}

function buildSyntaxStyle(
	theme: ResolvedTheme,
	mode: SyntaxAccentMode,
): SyntaxStyle {
	const colors = theme.syntax;
	const accent = color(
		mode === "plan" ? theme.accents.plan : theme.accents.act,
	);
	const markdownHeading = accent;
	const markdownCode = color(colors.markdownCode);
	const markdownMuted = color(colors.markdownMuted);
	const markdownLink = accent;

	return SyntaxStyle.fromStyles({
		...(colors.markdownDefault ? { default: fg(colors.markdownDefault) } : {}),
		keyword: bold(colors.keyword),
		"keyword.control": bold(colors.keyword),
		"keyword.operator": fg(colors.operator),
		type: fg(colors.type),
		"type.builtin": fg(colors.type),
		function: fg(colors.functionName),
		"function.method": fg(colors.functionName),
		variable: fg(colors.variable),
		"variable.parameter": fg(colors.variable),
		"variable.builtin": fg(colors.type),
		string: fg(colors.string),
		"string.special": fg(colors.string),
		number: fg(colors.number),
		comment: italic(colors.comment),
		operator: fg(colors.operator),
		punctuation: fg(colors.punctuation),
		property: fg(colors.property),
		constant: fg(colors.constant),
		tag: fg(colors.tag),
		attribute: fg(colors.attribute),
		escape: fg(colors.escape),
		"markup.heading": { fg: markdownHeading, bold: true },
		"markup.heading.1": { fg: markdownHeading, bold: true },
		"markup.heading.2": { fg: markdownHeading, bold: true },
		"markup.heading.3": { fg: markdownHeading, bold: true },
		"markup.heading.4": { fg: markdownHeading, bold: true },
		"markup.heading.5": { fg: markdownHeading, bold: true },
		"markup.heading.6": { fg: markdownHeading, bold: true },
		"markup.raw": { fg: markdownCode },
		"markup.raw.inline": { fg: markdownCode },
		"markup.raw.block": { fg: markdownCode },
		"markup.strong": { fg: markdownHeading, bold: true },
		"markup.bold": { fg: markdownHeading, bold: true },
		"markup.italic": italic(colors.markdownItalic),
		"markup.quote": { fg: markdownMuted, italic: true },
		"markup.list": { fg: markdownHeading },
		"markup.link": { fg: markdownLink, underline: true },
		"markup.link.label": { fg: markdownLink, underline: true },
		"markup.link.url": { fg: markdownLink, underline: true },
		label: { fg: markdownLink },
		conceal: { fg: markdownMuted },
		"string.special.url": { fg: markdownLink, underline: true },
	});
}

export function getSyntaxStyle(
	theme: ResolvedTheme,
	mode: SyntaxAccentMode = "act",
): SyntaxStyle {
	// The auto theme resolves to a different palette per variant, so the
	// variant participates in the cache key alongside the theme id.
	const key = `${theme.id}:${theme.variant}:${mode}`;
	let style = instances.get(key);
	if (!style) {
		style = buildSyntaxStyle(theme, mode);
		instances.set(key, style);
	}
	return style;
}
