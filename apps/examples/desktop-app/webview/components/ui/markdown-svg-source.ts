type MarkdownNode = {
	type: string;
	tagName?: string;
	value?: string;
	children?: MarkdownNode[];
	position?: {
		start: { offset?: number };
		end: { offset?: number };
	};
};

export function rehypeSvgSource() {
	return (tree: MarkdownNode, file: { value: unknown }) => {
		const source = String(file.value);
		const walk = (node: MarkdownNode) => {
			if (!node.children) return;
			node.children = node.children.map((child) => {
				const start = child.position?.start.offset;
				const end = child.position?.end.offset;
				if (
					child.type === "element" &&
					child.tagName === "svg" &&
					start !== undefined &&
					end !== undefined
				) {
					return { type: "text", value: source.slice(start, end) };
				}
				walk(child);
				return child;
			});
		};
		walk(tree);
	};
}
