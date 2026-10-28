/**
 * A small, dependency-free markdown renderer for assistant text.
 *
 * It covers the subset the desktop chat renders (DESIGN_SPEC §4): ATX headings,
 * fenced + inline code, ordered/unordered lists, blockquotes, horizontal rules
 * and paragraphs, GFM tables, plus inline **bold**, *italic*, ~~strike~~,
 * `code` and [links](url). It is
 * deliberately not a full CommonMark implementation — unknown syntax degrades to
 * plain text rather than throwing, which is the safe behavior for streaming,
 * partially-formed model output.
 */

import { type ReactNode, useMemo } from "react";
import { Linking, ScrollView, View } from "react-native";
import { Text, type TextVariant, useTheme } from "@/ui";

interface Block {
	key: string;
	render(theme: ReturnType<typeof useTheme>): ReactNode;
}

const HEADING_VARIANT: Record<number, TextVariant> = {
	1: "title",
	2: "heading",
	3: "bodyLarge",
	4: "body",
	5: "body",
	6: "body",
};

export function Markdown({ text }: { text: string }) {
	const theme = useTheme();
	const blocks = useMemo(() => parseBlocks(text), [text]);
	return (
		// DESIGN_SPEC §4: markdown block gap is 12px.
		<View style={{ gap: 12 }}>
			{blocks.map((block) => (
				<View key={block.key}>{block.render(theme)}</View>
			))}
		</View>
	);
}

function parseBlocks(source: string): Block[] {
	const lines = source.replace(/\r\n/g, "\n").split("\n");
	const blocks: Block[] = [];
	let paragraph: string[] = [];
	let list: { ordered: boolean; items: string[] } | undefined;
	let key = 0;

	const flushParagraph = () => {
		if (paragraph.length === 0) {
			return;
		}
		const content = paragraph.join(" ").trim();
		paragraph = [];
		if (!content) {
			return;
		}
		const id = `p${key++}`;
		blocks.push({
			key: id,
			render: (theme) => (
				<Text variant="body" style={{ color: theme.color.text }}>
					{renderInline(content, theme, id)}
				</Text>
			),
		});
	};

	const flushList = () => {
		if (!list || list.items.length === 0) {
			list = undefined;
			return;
		}
		const current = list;
		const id = `l${key++}`;
		blocks.push({
			key: id,
			render: (theme) => (
				<View style={{ gap: 4 }}>
					{current.items.map((item, index) => (
						<View
							// biome-ignore lint/suspicious/noArrayIndexKey: list items are positional.
							key={index}
							style={{ flexDirection: "row", gap: 8, paddingLeft: 4 }}
						>
							<Text variant="body" tone="muted">
								{current.ordered ? `${index + 1}.` : "•"}
							</Text>
							<Text variant="body" style={{ flex: 1, color: theme.color.text }}>
								{renderInline(item, theme, `${id}-${index}`)}
							</Text>
						</View>
					))}
				</View>
			),
		});
		list = undefined;
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Fenced code block.
		const fence = line.match(/^\s*```(.*)$/);
		if (fence) {
			flushParagraph();
			flushList();
			const code: string[] = [];
			i++;
			while (i < lines.length && !/^\s*```/.test(lines[i])) {
				code.push(lines[i]);
				i++;
			}
			const id = `c${key++}`;
			const body = code.join("\n");
			blocks.push({
				key: id,
				render: (theme) => (
					<View
						style={{
							backgroundColor: theme.color.surfaceMuted,
							borderRadius: theme.radius.md,
							borderWidth: 1,
							borderColor: theme.color.border,
							padding: 10,
						}}
					>
						<ScrollView horizontal showsHorizontalScrollIndicator={false}>
							<Text variant="mono" style={{ lineHeight: 19 }}>
								{body}
							</Text>
						</ScrollView>
					</View>
				),
			});
			continue;
		}

		// Wait for a complete delimiter row before treating streamed text as a table.
		const header = tableCells(line);
		const delimiter = tableCells(lines[i + 1] ?? "");
		if (
			header.hasPipe &&
			header.cells.length > 0 &&
			delimiter.cells.length === header.cells.length &&
			delimiter.cells.every((cell) => /^:?-{3,}:?$/.test(cell))
		) {
			flushParagraph();
			flushList();
			const rows: string[][] = [];
			let next = i + 2;
			while (
				next < lines.length &&
				lines[next].trim() &&
				!/^\s*```/.test(lines[next])
			) {
				const row = tableCells(lines[next]);
				if (!row.hasPipe || row.cells.length > header.cells.length) break;
				rows.push(header.cells.map((_, column) => row.cells[column] ?? ""));
				next += 1;
			}
			i = next - 1;
			const id = `table${key++}`;
			const alignments = delimiter.cells.map((cell) =>
				cell.endsWith(":")
					? cell.startsWith(":")
						? ("center" as const)
						: ("right" as const)
					: ("left" as const),
			);
			const widths = header.cells.map((cell, column) =>
				Math.min(
					260,
					Math.max(
						120,
						rows.reduce(
							(length, row) => Math.max(length, row[column].length),
							cell.length,
						) *
							7 +
							24,
					),
				),
			);
			blocks.push({
				key: id,
				render: (theme) => (
					<ScrollView
						horizontal
						accessibilityLabel={`Table, ${header.cells.length} columns, ${rows.length} data rows`}
						showsHorizontalScrollIndicator
					>
						<View
							style={{
								borderWidth: 1,
								borderColor: theme.color.border,
								borderRadius: theme.radius.sm,
								overflow: "hidden",
							}}
						>
							{[header.cells, ...rows].map((row, rowIndex) => (
								<View
									key={`${id}-row-${rowIndex}`}
									style={{
										flexDirection: "row",
										backgroundColor:
											rowIndex === 0 ? theme.color.surfaceMuted : undefined,
									}}
								>
									{row.map((cell, column) => (
										<View
											key={`${id}-cell-${rowIndex}-${column}`}
											style={{
												width: widths[column],
												paddingHorizontal: 12,
												paddingVertical: 8,
												borderRightWidth: column < row.length - 1 ? 1 : 0,
												borderBottomWidth: rowIndex < rows.length ? 1 : 0,
												borderColor: theme.color.border,
											}}
										>
											<Text
												variant="body"
												weight={rowIndex === 0 ? "600" : undefined}
												accessibilityRole={
													rowIndex === 0 ? "header" : undefined
												}
												style={{
													textAlign: alignments[column],
													color: theme.color.text,
												}}
											>
												{renderInline(
													cell,
													theme,
													`${id}-${rowIndex}-${column}`,
												)}
											</Text>
										</View>
									))}
								</View>
							))}
						</View>
					</ScrollView>
				),
			});
			continue;
		}

		// Horizontal rule.
		if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
			flushParagraph();
			flushList();
			const id = `hr${key++}`;
			blocks.push({
				key: id,
				render: (theme) => (
					<View style={{ height: 1, backgroundColor: theme.color.border }} />
				),
			});
			continue;
		}

		// Heading.
		const heading = line.match(/^(#{1,6})\s+(.*)$/);
		if (heading) {
			flushParagraph();
			flushList();
			const level = heading[1].length;
			const content = heading[2].trim();
			const id = `h${key++}`;
			blocks.push({
				key: id,
				render: (theme) => (
					<Text variant={HEADING_VARIANT[level]} weight="600">
						{renderInline(content, theme, id)}
					</Text>
				),
			});
			continue;
		}

		// Blockquote.
		const quote = line.match(/^\s*>\s?(.*)$/);
		if (quote) {
			flushParagraph();
			flushList();
			const id = `q${key++}`;
			const content = quote[1];
			blocks.push({
				key: id,
				render: (theme) => (
					<View
						style={{
							borderLeftWidth: 2,
							borderLeftColor: theme.color.border,
							paddingLeft: 8,
						}}
					>
						<Text variant="body" tone="muted">
							{renderInline(content, theme, id)}
						</Text>
					</View>
				),
			});
			continue;
		}

		// List item.
		const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
		const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
		if (unordered || ordered) {
			flushParagraph();
			const isOrdered = Boolean(ordered);
			if (!list || list.ordered !== isOrdered) {
				flushList();
				list = { ordered: isOrdered, items: [] };
			}
			list.items.push((unordered ?? ordered)?.[1] ?? "");
			continue;
		}

		// Blank line ends the current paragraph/list.
		if (line.trim() === "") {
			flushParagraph();
			flushList();
			continue;
		}

		flushList();
		paragraph.push(line);
	}
	flushParagraph();
	flushList();
	return blocks;
}

/** Keep escaped pipes and pipes inside code spans within their authored cell. */
function tableCells(line: string): { cells: string[]; hasPipe: boolean } {
	const text = line.trim();
	const cells: string[] = [];
	let cell = "";
	let codeTicks = 0;
	let hasPipe = false;
	let trailingBorder = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === "\\" && index + 1 < text.length) {
			const next = text[index + 1];
			if (next === "|") {
				cell += "|";
				index += 1;
				trailingBorder = false;
				continue;
			}
			if (next === "\\") {
				cell += "\\\\";
				index += 1;
				trailingBorder = false;
				continue;
			}
		}
		if (char === "`") {
			let end = index + 1;
			while (text[end] === "`") end += 1;
			const count = end - index;
			if (codeTicks === 0) codeTicks = count;
			else if (codeTicks === count) codeTicks = 0;
			cell += text.slice(index, end);
			index = end - 1;
			trailingBorder = false;
			continue;
		}
		if (char === "|" && codeTicks === 0) {
			hasPipe = true;
			if (index !== 0) cells.push(cell.trim());
			cell = "";
			trailingBorder = true;
		} else {
			cell += char;
			trailingBorder = false;
		}
	}
	if (!trailingBorder || cell) cells.push(cell.trim());
	return { cells, hasPipe };
}

interface InlineToken {
	kind: "text" | "bold" | "italic" | "code" | "link" | "strike";
	value: string;
	href?: string;
}

interface InlineMatch {
	start: number;
	end: number;
	token: InlineToken;
}

/** Match strike delimiters once, including incomplete streamed input. */
function strikeMatches(input: string): InlineMatch[] {
	const matches: InlineMatch[] = [];
	// Use the same code-span recognition as the existing inline renderer. A
	// delimiter shown as code must never start or finish a strike span.
	const codePattern = /`([^`]+)`/g;
	let code = codePattern.exec(input);
	let opening = -1;
	for (let index = 0; index < input.length; ) {
		if (code && index >= code.index) {
			index = codePattern.lastIndex;
			code = codePattern.exec(input);
			continue;
		}
		if (input[index] === "\\") {
			index += 2;
			continue;
		}
		if (!input.startsWith("~~", index)) {
			index += 1;
			continue;
		}
		const before = input[index - 1];
		const after = input[index + 2];
		if (opening >= 0 && index > opening + 2 && before && !/\s/.test(before)) {
			matches.push({
				start: opening,
				end: index + 2,
				token: { kind: "strike", value: input.slice(opening + 2, index) },
			});
			opening = -1;
		} else if (opening < 0 && after && !/\s/.test(after)) {
			opening = index;
		}
		index += 2;
	}
	return matches;
}

/** Tokenizes one line without re-scanning unmatched strike openers. */
function tokenizeInline(input: string): InlineToken[] {
	const matches: InlineMatch[] = [];
	// Underscores inside identifiers are literal (CommonMark's intraword rule).
	// Keep asterisks separate: unlike underscores, they can emphasize within words.
	const pattern =
		/\*\*(.+?)\*\*|(?<![\p{L}\p{M}\p{N}_])__(\S(?:.*?\S)?)__(?![\p{L}\p{M}\p{N}_])|\*(.+?)\*|(?<![\p{L}\p{M}\p{N}_])_(\S(?:.*?\S)?)_(?![\p{L}\p{M}\p{N}_])|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/gu;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(input)) !== null) {
		const bold = match[1] ?? match[2];
		const italic = match[3] ?? match[4];
		const token: InlineToken =
			bold !== undefined
				? { kind: "bold", value: bold }
				: italic !== undefined
					? { kind: "italic", value: italic }
					: match[5] !== undefined
						? { kind: "code", value: match[5] }
						: { kind: "link", value: match[6], href: match[7] };
		matches.push({ start: match.index, end: pattern.lastIndex, token });
	}
	const strikes = strikeMatches(input);
	const tokens: InlineToken[] = [];
	let normal = 0;
	let strike = 0;
	let cursor = 0;
	// Both match lists are ordered. Merge once; earlier outer syntax owns any
	// overlapping markers, matching the renderer's existing non-nested behavior.
	while (normal < matches.length || strike < strikes.length) {
		const nextNormal = matches[normal];
		const nextStrike = strikes[strike];
		const next =
			nextNormal && (!nextStrike || nextNormal.start <= nextStrike.start)
				? matches[normal++]
				: strikes[strike++];
		if (next.start < cursor) continue;
		if (next.start > cursor)
			tokens.push({ kind: "text", value: input.slice(cursor, next.start) });
		tokens.push(next.token);
		cursor = next.end;
	}
	if (cursor < input.length)
		tokens.push({ kind: "text", value: input.slice(cursor) });
	return tokens;
}

function renderInline(
	input: string,
	theme: ReturnType<typeof useTheme>,
	keyPrefix: string,
): ReactNode {
	return tokenizeInline(input).map((token, index) => {
		const key = `${keyPrefix}-${index}`;
		switch (token.kind) {
			case "bold":
				return (
					<Text key={key} weight="600">
						{token.value}
					</Text>
				);
			case "italic":
				return (
					<Text key={key} style={{ fontStyle: "italic" }}>
						{token.value}
					</Text>
				);
			case "code":
				return (
					<Text
						key={key}
						variant="mono"
						style={{ backgroundColor: theme.color.surfaceRaised }}
					>
						{token.value}
					</Text>
				);
			case "strike":
				return (
					<Text key={key} style={{ textDecorationLine: "line-through" }}>
						{token.value}
					</Text>
				);
			case "link":
				return (
					<Text
						key={key}
						tone="accent"
						accessibilityRole="link"
						style={{ textDecorationLine: "underline" }}
						onPress={() => openExternalLink(token.href)}
					>
						{token.value}
					</Text>
				);
			default:
				return <Text key={key}>{token.value}</Text>;
		}
	});
}

function openExternalLink(href: string | undefined): void {
	if (!href) return;
	try {
		const protocol = new URL(href).protocol;
		if (protocol !== "https:" && protocol !== "http:") return;
		void Linking.openURL(href).catch(() => {});
	} catch {
		// Partial or malformed model output stays inert.
	}
}
