import { cjk } from "@streamdown/cjk";
import type { MermaidConfig } from "mermaid";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement, memo } from "react";
import {
	type Components,
	type DiagramPlugin,
	Streamdown,
	type StreamdownProps,
} from "streamdown";
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
	node?: {
		properties?: {
			metastring?: string;
		};
	};
};

const LANGUAGE_CLASS_PATTERN = /(?:^|\s)language-([^\s]+)/;
const START_LINE_PATTERN = /startLine=(\d+)/;
const NO_LINE_NUMBERS_PATTERN = /\bnoLineNumbers\b/;

function codeText(children: ReactNode): string {
	if (typeof children === "string") {
		return children;
	}
	if (
		isValidElement<{ children?: ReactNode }>(children) &&
		typeof children.props.children === "string"
	) {
		return children.props.children;
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

	const meta = node?.properties?.metastring;
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

const DEFAULT_MERMAID_CONFIG = {
	fontFamily: "monospace",
	securityLevel: "strict",
	startOnLoad: false,
	suppressErrorRendering: true,
	theme: "default",
} satisfies MermaidConfig;

interface LazyMermaidInstance {
	initialize: (config: MermaidConfig) => void;
	render: (
		id: string,
		source: string,
	) => Promise<{
		svg: string;
	}>;
}

function createLazyMermaidPlugin(): DiagramPlugin {
	let config: MermaidConfig = DEFAULT_MERMAID_CONFIG;
	let initialized = false;

	const instance: LazyMermaidInstance = {
		initialize(nextConfig: MermaidConfig) {
			config = { ...DEFAULT_MERMAID_CONFIG, ...config, ...nextConfig };
			initialized = false;
		},
		async render(id: string, source: string) {
			const mermaidModule = await import("mermaid");
			const mermaid = mermaidModule.default;
			if (!initialized) {
				mermaid.initialize(config);
				initialized = true;
			}
			return mermaid.render(id, source);
		},
	};

	return {
		getMermaid(nextConfig?: MermaidConfig) {
			if (nextConfig) {
				instance.initialize(nextConfig);
			}
			return instance;
		},
		language: "mermaid",
		name: "mermaid",
		type: "diagram",
	};
}

const streamdownPlugins = { cjk, mermaid: createLazyMermaidPlugin() };

export type HubStreamdownProps = StreamdownProps;

export const HubStreamdown = memo(
	({ className, components, ...props }: HubStreamdownProps) => (
		<Streamdown
			className={className}
			components={{ ...markdownComponents, ...components }}
			plugins={streamdownPlugins}
			{...props}
		/>
	),
	(prevProps, nextProps) =>
		prevProps.children === nextProps.children &&
		nextProps.isAnimating === prevProps.isAnimating &&
		prevProps.className === nextProps.className &&
		prevProps.components === nextProps.components,
);

HubStreamdown.displayName = "HubStreamdown";
