import { RGBA, type StyleDefinition, SyntaxStyle } from "@opentui/core";
import type { TerminalTheme } from "../palette";

const instances: Record<TerminalTheme, SyntaxStyle | null> = {
	dark: null,
	light: null,
};

interface SyntaxColors {
	keyword: string;
	operator: string;
	type: string;
	functionName: string;
	variable: string;
	string: string;
	number: string;
	comment: string;
	punctuation: string;
	property: string;
	constant: string;
	tag: string;
	attribute: string;
	escape: string;
	markdownCode: string;
	markdownHeading: string;
	markdownMuted: string;
	markdownLink: string;
	markdownItalic: string;
	markdownDefault?: string;
}

const syntaxColors: Record<TerminalTheme, SyntaxColors> = {
	dark: {
		keyword: "#c678dd",
		operator: "#56b6c2",
		type: "#e5c07b",
		functionName: "#61afef",
		variable: "#e06c75",
		string: "#98c379",
		number: "#d19a66",
		comment: "#5c6370",
		punctuation: "#abb2bf",
		property: "#e06c75",
		constant: "#d19a66",
		tag: "#e06c75",
		attribute: "#d19a66",
		escape: "#56b6c2",
		markdownCode: "#98c379",
		markdownHeading: "#56b6c2",
		markdownMuted: "#808080",
		markdownLink: "#56b6c2",
		markdownItalic: "#e5c07b",
	},
	light: {
		keyword: "#cf222e",
		operator: "#0550ae",
		type: "#953800",
		functionName: "#8250df",
		variable: "#953800",
		string: "#0a3069",
		number: "#0550ae",
		comment: "#6e7781",
		punctuation: "#57606a",
		property: "#0550ae",
		constant: "#0550ae",
		tag: "#116329",
		attribute: "#0550ae",
		escape: "#0550ae",
		markdownCode: "#116329",
		markdownHeading: "#0969da",
		markdownMuted: "#6e7781",
		markdownLink: "#0969da",
		markdownItalic: "#8250df",
		markdownDefault: "#1a1a1a",
	},
};

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

function underline(hex: string): StyleDefinition {
	return { fg: color(hex), underline: true };
}

function buildSyntaxStyle(theme: TerminalTheme): SyntaxStyle {
	const colors = syntaxColors[theme];
	const markdownHeading = color(colors.markdownHeading);
	const markdownCode = color(colors.markdownCode);
	const markdownMuted = color(colors.markdownMuted);
	const markdownLink = color(colors.markdownLink);

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
		"string.special.url": underline(colors.markdownLink),
	});
}

export function getSyntaxStyle(theme: TerminalTheme = "dark"): SyntaxStyle {
	return (instances[theme] ??= buildSyntaxStyle(theme));
}
