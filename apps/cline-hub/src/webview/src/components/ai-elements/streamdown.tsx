import { createLazyMermaidPlugin } from "@cline/ui/components/markdown";
import { cjk } from "@streamdown/cjk";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement, memo } from "react";
import { type Components, Streamdown, type StreamdownProps } from "streamdown";
import {
	CodeBlock,
	CodeBlockActions,
	CodeBlockCopyButton,
	CodeBlockFilename,
	CodeBlockHeader,
	CodeBlockTitle,
} from "@/components/ai-elements/code-block";
import { cn } from "@/lib/utils";

type MarkdownCodeProps = ComponentProps<"code"> & {
	"data-block"?: boolean | string;
	// react-markdown/streamdown pass the hast `Element` here, whose
	// `properties` is a broad `Record`. Keep this assignable from that type
	// (rather than a narrow `{ metastring?: string }`) so the component stays
	// compatible with `Components` regardless of how strict the resolved
	// hast/streamdown types are; the metastring value is validated at read time.
	node?: {
		properties?: Record<string, unknown>;
	};
};

const LANGUAGE_CLASS_PATTERN = /(?:^|\s)language-([^\s]+)/;
const START_LINE_PATTERN = /startLine=(\d+)/;
const NO_LINE_NUMBERS_PATTERN = /\bnoLineNumbers\b/;

function codeText(children: ReactNode): string {
	if (typeof children === "string" || typeof children === "number") {
		return String(children);
	}
	if (Array.isArray(children)) {
		return children.map(codeText).join("");
	}
	if (isValidElement<{ children?: ReactNode }>(children)) {
		return codeText(children.props.children);
	}
	return "";
}

const MarkdownCode = ({
	children,
	className,
	node,
	"data-block": dataBlock,
	...props
}: MarkdownCodeProps) => {
	const language = className?.match(LANGUAGE_CLASS_PATTERN)?.[1] ?? "text";

	if (!dataBlock) {
		return (
			<code
				className={cn(
					"rounded bg-muted px-1.5 py-0.5 font-mono text-sm",
					className,
				)}
				{...props}
			>
				{children}
			</code>
		);
	}

	const metaValue = node?.properties?.metastring;
	const meta = typeof metaValue === "string" ? metaValue : undefined;
	const startLineMatch = meta?.match(START_LINE_PATTERN);
	const startLine = startLineMatch ? Number.parseInt(startLineMatch[1], 10) : 1;
	const showLineNumbers = meta ? !NO_LINE_NUMBERS_PATTERN.test(meta) : true;

	return (
		<CodeBlock
			code={codeText(children)}
			data-start-line={startLine > 1 ? startLine : undefined}
			language={language}
			showLineNumbers={showLineNumbers}
		>
			<CodeBlockHeader>
				<CodeBlockTitle>
					<CodeBlockFilename>{language}</CodeBlockFilename>
				</CodeBlockTitle>
				<CodeBlockActions>
					<CodeBlockCopyButton />
				</CodeBlockActions>
			</CodeBlockHeader>
		</CodeBlock>
	);
};

const markdownComponents = {
	code: MarkdownCode,
} satisfies Components;

const streamdownPlugins = { cjk, mermaid: createLazyMermaidPlugin() };

export type HubStreamdownProps = StreamdownProps;

export const HubStreamdown = memo(
	({ className, components, ...props }: HubStreamdownProps) => {
		const mergedComponents = components
			? { ...markdownComponents, ...components }
			: markdownComponents;

		return (
			<Streamdown
				className={className}
				components={mergedComponents}
				plugins={streamdownPlugins}
				{...props}
			/>
		);
	},
);

HubStreamdown.displayName = "HubStreamdown";
