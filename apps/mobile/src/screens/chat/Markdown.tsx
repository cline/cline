/**
 * A small, dependency-free markdown renderer for assistant text.
 *
 * It covers the subset the desktop chat renders (DESIGN_SPEC §4): ATX headings,
 * fenced + inline code, ordered/unordered lists, blockquotes, horizontal rules
 * and paragraphs, plus inline **bold**, *italic*, `code` and [links](url). It is
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

interface InlineToken {
	kind: "text" | "bold" | "italic" | "code" | "link";
	value: string;
	href?: string;
}

/** Tokenizes one line of inline markdown. Non-greedy, single pass, left to right. */
function tokenizeInline(input: string): InlineToken[] {
	const tokens: InlineToken[] = [];
	const pattern =
		/(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	match = pattern.exec(input);
	while (match !== null) {
		if (match.index > lastIndex) {
			tokens.push({ kind: "text", value: input.slice(lastIndex, match.index) });
		}
		if (match[2] !== undefined) {
			tokens.push({ kind: "bold", value: match[2] });
		} else if (match[4] !== undefined) {
			tokens.push({ kind: "italic", value: match[4] });
		} else if (match[5] !== undefined) {
			tokens.push({ kind: "code", value: match[5] });
		} else if (match[6] !== undefined) {
			tokens.push({ kind: "link", value: match[6], href: match[7] });
		}
		lastIndex = pattern.lastIndex;
		match = pattern.exec(input);
	}
	if (lastIndex < input.length) {
		tokens.push({ kind: "text", value: input.slice(lastIndex) });
	}
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
