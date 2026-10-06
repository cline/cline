/**
 * Diagram type detection and label extraction used to name rendered diagrams:
 * best-effort parsing of the diagram source (flowchart subgraphs and nodes,
 * sequence participants, diagram titles) plus the filename-slug resolution
 * built on it. Pure and DOM-free, never throws on malformed input. The public
 * entry point stays `mermaid-diagram.ts`.
 */

import {
	DEFAULT_DIAGRAM_NAME,
	parseFenceTitle,
	parseFrontmatterTitle,
	slugifyDiagramName,
	splitFrontmatter,
	unquote,
} from "./naming.js";

const MAX_DERIVED_SLUG_LENGTH = 48;

const DIAGRAM_TYPE_NAMES: Record<string, string> = {
	"architecture-beta": "architecture",
	"block-beta": "block",
	c4component: "c4",
	c4container: "c4",
	c4context: "c4",
	c4deployment: "c4",
	c4dynamic: "c4",
	classdiagram: "class",
	"classdiagram-v2": "class",
	erdiagram: "er",
	flowchart: "flowchart",
	"flowchart-elk": "flowchart",
	gantt: "gantt",
	gitgraph: "git",
	graph: "flowchart",
	journey: "journey",
	kanban: "kanban",
	mindmap: "mindmap",
	"packet-beta": "packet",
	pie: "pie",
	quadrantchart: "quadrant",
	requirementdiagram: "requirement",
	sankey: "sankey",
	"sankey-beta": "sankey",
	sequencediagram: "sequence",
	statediagram: "state",
	"statediagram-v2": "state",
	timeline: "timeline",
	"xychart-beta": "xychart",
	xychart: "xychart",
};

const FLOWCHART_SKIP_LINE =
	/^\s*(?:subgraph|end|classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/;

const BRACKET_CLOSERS: Record<string, string> = {
	"(": ")",
	"[": "]",
	"{": "}",
};

function isIdentifierCharacter(char: string | undefined): boolean {
	return char !== undefined && /[A-Za-z0-9_]/.test(char);
}

/**
 * First `identifier [Label]`-style label at/after `from`, where the bracket may
 * be doubled (`[[...]]`). Scans once, left to right, so adversarial input stays
 * linear-time where the equivalent backtracking regex did not.
 */
function nextNodeLabel(
	line: string,
	from: number,
): { label: string; next: number } | undefined {
	let index = from;
	while (index < line.length) {
		// An identifier run starting with a digit (e.g. `9ab`) cannot begin a
		// label, and no label can start inside it; skip the whole run.
		if (/[0-9]/.test(line[index])) {
			while (isIdentifierCharacter(line[index])) index += 1;
			continue;
		}
		if (!/[A-Za-z_]/.test(line[index])) {
			index += 1;
			continue;
		}
		let cursor = index + 1;
		while (isIdentifierCharacter(line[cursor])) cursor += 1;
		while (cursor < line.length && /\s/.test(line[cursor])) cursor += 1;
		const opener = line[cursor];
		const closer = opener ? BRACKET_CLOSERS[opener] : undefined;
		if (!closer) {
			index = cursor;
			continue;
		}
		const openEnd = line[cursor + 1] === opener ? cursor + 2 : cursor + 1;
		const close = line.indexOf(closer, openEnd);
		if (close === -1) return undefined;
		return { label: unquote(line.slice(openEnd, close)), next: close + 1 };
	}
	return undefined;
}

function stripMarkup(value: string): string {
	let withoutTags = "";
	let cursor = 0;
	while (cursor < value.length) {
		const open = value.indexOf("<", cursor);
		if (open === -1) {
			withoutTags += value.slice(cursor);
			break;
		}
		withoutTags += value.slice(cursor, open);
		const close = value.indexOf(">", open + 1);
		// An unterminated `<` is literal text, not a tag.
		if (close === -1) {
			withoutTags += value.slice(open);
			break;
		}
		withoutTags += " ";
		cursor = close + 1;
	}
	return withoutTags
		.replaceAll(/[*_`]+/g, "")
		.replaceAll(/\s+/g, " ")
		.trim();
}

function pushUnique(labels: string[], label: string | undefined): void {
	if (!label) return;
	const clean = stripMarkup(label);
	if (!clean) return;
	const slug = slugifyDiagramName(clean);
	if (
		!slug ||
		labels.some((existing) => slugifyDiagramName(existing) === slug)
	) {
		return;
	}
	labels.push(clean);
}

function stripDirectivesAndComments(body: string): string {
	const parts: string[] = [];
	let cursor = 0;
	while (cursor < body.length) {
		const start = body.indexOf("%%{", cursor);
		if (start === -1) break;
		const end = body.indexOf("}%%", start + 3);
		if (end === -1) break;
		parts.push(body.slice(cursor, start));
		cursor = end + 3;
	}
	parts.push(body.slice(cursor));
	return parts
		.join("")
		.split(/\r?\n/)
		.filter((line) => !/^\s*%%/.test(line))
		.join("\n");
}

/** Label of a `subgraph` line: `subgraph id [Label]`, or the bare text. */
function subgraphLabel(rest: string): string | undefined {
	const text = rest.trim();
	let index = 0;
	while (index < text.length && /[\w-]/.test(text[index])) index += 1;
	// Without an `id [` prefix the whole text is the label.
	if (index === 0) return unquote(text) || undefined;
	while (index < text.length && /\s/.test(text[index])) index += 1;
	if (text[index] !== "[") return unquote(text) || undefined;
	const close = text.indexOf("]", index + 1);
	if (close === -1) return undefined;
	return unquote(text.slice(index + 1, close)) || undefined;
}

function subgraphTitle(lines: string[]): string | undefined {
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("subgraph")) continue;
		const rest = trimmed.slice("subgraph".length);
		if (!/\s/.test(rest[0] ?? "")) continue;
		return subgraphLabel(rest);
	}
	return undefined;
}

function addNodeLabels(line: string, labels: string[]): void {
	let index = 0;
	while (labels.length < 2) {
		const found = nextNodeLabel(line, index);
		if (!found) return;
		pushUnique(labels, found.label);
		index = found.next;
	}
}

function flowchartLabels(lines: string[]): string[] {
	const labels: string[] = [];
	pushUnique(labels, subgraphTitle(lines));
	for (const line of lines.slice(1)) {
		if (FLOWCHART_SKIP_LINE.test(line)) continue;
		addNodeLabels(line, labels);
		if (labels.length >= 2) break;
	}
	return labels;
}

/** A `title` or `keyword title` line, with the words after the keyword. */
function titleLine(lines: string[]): string | undefined {
	for (const line of lines) {
		const columns = line.trim().split(/\s+/);
		const titleIndex =
			columns[0] === "title" ? 1 : columns[1] === "title" ? 2 : 0;
		if (titleIndex === 0) continue;
		const title = columns.slice(titleIndex).join(" ").trim();
		if (title) return title;
	}
	return undefined;
}

/** A `participant id` or `actor id as Alias` line. */
function participantLabel(line: string): string | undefined {
	const columns = line.trim().split(/\s+/);
	if (columns[0] !== "participant" && columns[0] !== "actor") return undefined;
	if (columns.length === 2) return columns[1];
	if (columns[2] !== "as" || columns.length < 4) return undefined;
	return columns.slice(3).join(" ");
}

function genericLabels(lines: string[]): string[] {
	const labels: string[] = [];
	pushUnique(labels, titleLine(lines));
	if (labels.length === 0) {
		for (const line of lines.slice(1)) addNodeLabels(line, labels);
	}
	return labels;
}

/**
 * Best-effort diagram type + first labels for naming, e.g. `flowchart` +
 * `["VPC", "API Gateway"]`. Never throws on malformed input.
 */
export function deriveDiagramLabels(source: string): {
	labels: string[];
	type: string;
} {
	const body = stripDirectivesAndComments(splitFrontmatter(source).body).trim();
	const lines = body.split("\n");
	const firstLine = lines[0] ?? "";
	const keyword = /^[A-Za-z0-9-]+/.exec(firstLine.trim())?.[0] ?? "";
	const type =
		DIAGRAM_TYPE_NAMES[keyword.toLowerCase()] ?? slugifyDiagramName(keyword);

	let labels: string[] = [];
	if (type === "flowchart") {
		labels = flowchartLabels(lines);
	} else if (type === "sequence") {
		for (const line of lines) {
			pushUnique(labels, participantLabel(line));
		}
	} else if (type === "class") {
		for (const match of body.matchAll(/^\s*class\s+([\w.-]+)/gm)) {
			pushUnique(labels, match[1]);
		}
	} else if (type === "er") {
		const relation =
			/^\s*([A-Za-z_][\w-]*)\s+[|}][|o](?:--|\.\.)[o|][|{]\s+([A-Za-z_][\w-]*)/m.exec(
				body,
			);
		pushUnique(labels, relation?.[1]);
		pushUnique(labels, relation?.[2]);
	} else if (type) {
		labels = genericLabels(lines);
	}
	return { labels: labels.slice(0, 2), type };
}

export interface ResolveDiagramSlugInput {
	/** Raw fence metastring (`title="..."`), possibly undefined/empty. */
	meta?: string | null;
	/** Diagram source (may include frontmatter). */
	source: string;
}

/**
 * Filename stem for a diagram. Order: fence `title="..."`, diagram frontmatter
 * `title:`, diagram type + first subgraph/node labels, then `diagram`.
 */
export function resolveDiagramSlug({
	meta,
	source,
}: ResolveDiagramSlugInput): string {
	const fromMeta = slugifyDiagramName(parseFenceTitle(meta) ?? "");
	if (fromMeta) return fromMeta;

	const fromFrontmatter = slugifyDiagramName(
		parseFrontmatterTitle(source) ?? "",
	);
	if (fromFrontmatter) return fromFrontmatter;

	const { labels, type } = deriveDiagramLabels(source);
	const derived = slugifyDiagramName(
		[type, ...labels].filter(Boolean).join(" "),
		MAX_DERIVED_SLUG_LENGTH,
	);
	return derived || DEFAULT_DIAGRAM_NAME;
}
