import { stripMentionTrailingPunctuation } from "@/lib/composer-tokens";

export const CHIP_TOKEN_TAG = "cline-chip-token";

type MarkdownNode = {
	type: string;
	value?: string;
	children?: MarkdownNode[];
	data?: Record<string, unknown>;
};

const SKIPPED_NODE_TYPES = new Set([
	"code",
	"definition",
	"html",
	"inlineCode",
	"link",
	"linkReference",
]);

function chip(value: string): MarkdownNode {
	return {
		type: "chipToken",
		data: { hName: CHIP_TOKEN_TAG },
		children: [{ type: "text", value }],
	};
}

function splitText(
	value: string,
	tokens: ReadonlySet<string>,
	allowCommand: boolean,
): MarkdownNode[] {
	const nodes: MarkdownNode[] = [];
	let consumed = 0;
	for (const match of value.matchAll(/(^|\s)([/@]\S+)/g)) {
		const start = match.index + match[1].length;
		const raw = match[2];
		const isCommand = raw.startsWith("/");
		if (isCommand && !(allowCommand && start === 0)) continue;
		const token = isCommand ? raw : stripMentionTrailingPunctuation(raw);
		if (!tokens.has(token)) continue;
		if (start > consumed) {
			nodes.push({ type: "text", value: value.slice(consumed, start) });
		}
		nodes.push(chip(token));
		consumed = start + token.length;
	}
	if (consumed === 0) return [{ type: "text", value }];
	if (consumed < value.length) {
		nodes.push({ type: "text", value: value.slice(consumed) });
	}
	return nodes;
}

/**
 * Wraps the given exact tokens (a leading `/command`, `@path` mentions) in
 * {@link CHIP_TOKEN_TAG} elements, leaving code and links untouched.
 *
 * Use as `[remarkChipTokens, { tokens }]`: Streamdown caches processors by
 * plugin name and options, so the tokens must travel as options.
 */
export function remarkChipTokens(options: { tokens: string[] }) {
	const tokens = new Set(options.tokens);
	return (tree: MarkdownNode) => {
		let atDocumentStart = true;
		const walk = (node: MarkdownNode) => {
			if (!node.children) return;
			node.children = node.children.flatMap((child) => {
				if (child.type === "text") {
					const parts = splitText(child.value ?? "", tokens, atDocumentStart);
					atDocumentStart = false;
					return parts;
				}
				if (SKIPPED_NODE_TYPES.has(child.type) || !child.children) {
					atDocumentStart = false;
					return [child];
				}
				walk(child);
				return [child];
			});
		};
		walk(tree);
	};
}
