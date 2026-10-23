import type { ToolSummary } from "@cline/ui/components/agent-chat/tool-summary";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
	BotIcon,
	FileCodeIcon,
	GlobeIcon,
	MessagesSquareIcon,
	PencilIcon,
	PlugIcon,
	SearchCodeIcon,
	SparklesIcon,
	TerminalIcon,
	UsersIcon,
	WrenchIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { CodeBlock } from "./code-block";
import { getStatusBadge } from "./status-badge";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
	<Collapsible
		className={cn("group not-prose mb-4 w-full rounded-sm border", className)}
		{...props}
	/>
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
	title?: string;
	/**
	 * Structured summary from `@cline/ui`'s tool-summary module. Preferred
	 * over `title`: labels are built from the tool payload, never parsed back
	 * out of a display string.
	 */
	summary?: ToolSummary;
	className?: string;
} & (
	| { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
	| {
			type: DynamicToolUIPart["type"];
			state: DynamicToolUIPart["state"];
			toolName: string;
	  }
);

const toolKindIcons: Record<ToolSummary["kind"], ReactNode> = {
	command: <TerminalIcon className="size-4" />,
	read: <FileCodeIcon className="size-4" />,
	edit: <PencilIcon className="size-4" />,
	search: <SearchCodeIcon className="size-4" />,
	web: <GlobeIcon className="size-4" />,
	spawn: <BotIcon className="size-4" />,
	team: <UsersIcon className="size-4" />,
	skill: <SparklesIcon className="size-4" />,
	mcp: <PlugIcon className="size-4" />,
	question: <MessagesSquareIcon className="size-4" />,
	other: <WrenchIcon className="size-4" />,
};

const toolIcons: Record<string, ReactNode> = {
	run_commands: <TerminalIcon className="size-4" />,
	read_files: <FileCodeIcon className="size-4" />,
	editor: <PencilIcon className="size-4" />,
	ask_question: <MessagesSquareIcon className="size-4" />,
};

const getToolBadge = (icon?: ReactNode) => {
	return (
		<Badge className="text-xs" variant="ghost">
			{icon ?? <WrenchIcon className="size-4" />}
		</Badge>
	);
};

export const ToolHeader = ({
	className,
	title,
	summary,
	type,
	state,
	toolName,
	...props
}: ToolHeaderProps) => {
	const derivedName =
		summary?.toolName ||
		toolName ||
		title ||
		type.split("-").slice(1).join("-");
	const icon = summary
		? toolKindIcons[summary.kind]
		: (toolIcons[derivedName] ?? toolIcons[toolName ?? ""]);

	return (
		<CollapsibleTrigger
			className={cn(
				"flex w-full overflow-hidden items-center justify-between gap-4 p-3 cursor-pointer",
				className,
			)}
			{...props}
		>
			<div className="flex items-center gap-2 shrink-0">
				{getToolBadge(icon)}
				<span className="font-light text-muted-foreground text-sm truncated wrap-break-word ellipses">
					{summary
						? summary.labelParts.map((part, index) =>
								part.code ? (
									// biome-ignore lint/suspicious/noArrayIndexKey: label segments are positional and never reorder
									<code className="font-mono text-foreground" key={index}>
										{part.text}
									</code>
								) : (
									// biome-ignore lint/suspicious/noArrayIndexKey: label segments are positional and never reorder
									<span key={index}>{part.text}</span>
								),
							)
						: title}
				</span>
				{getStatusBadge(state)}
			</div>
		</CollapsibleTrigger>
	);
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
	<CollapsibleContent
		className={cn(
			"data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-4 p-1 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in overflow-hidden font-mono",
			className,
		)}
		{...props}
	/>
);

export type ToolDetailsProps = ComponentProps<"div"> & {
	/** Full per-item text from the summary: commands, paths, queries, URLs. */
	details: string[];
};

/**
 * The untruncated payload behind the header label. The label may be
 * ellipsized by the layout, so the expanded panel always lists the full text
 * — one line per command, file, query, or URL.
 */
export const ToolDetails = ({
	className,
	details,
	...props
}: ToolDetailsProps) => {
	if (details.length === 0) {
		return null;
	}

	return (
		<div className={cn("space-y-1 overflow-hidden px-1", className)} {...props}>
			<h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
				Details
			</h4>
			<div className="rounded-md bg-muted/50 p-2 text-xs break-all">
				{details.map((detail, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: details are a static per-call list
					<div className="font-mono" key={index}>
						{detail}
					</div>
				))}
			</div>
		</div>
	);
};

export type ToolInputProps = ComponentProps<"div"> & {
	input: ToolPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
	<div className={cn("space-y-2 overflow-hidden", className)} {...props}>
		<h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
			Parameters
		</h4>
		<div className="rounded-md bg-muted/50">
			<CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
		</div>
	</div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
	output: ToolPart["output"];
	errorText: ToolPart["errorText"];
};

export const ToolOutput = ({
	className,
	output,
	errorText,
	...props
}: ToolOutputProps) => {
	if (!(output || errorText)) {
		return null;
	}

	let Output = <div>{output as ReactNode}</div>;

	if (typeof output === "object" && !isValidElement(output)) {
		Output = (
			<CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
		);
	} else if (typeof output === "string") {
		Output = <CodeBlock code={output} language="json" />;
	}

	return (
		<div className={cn("space-y-2", className)} {...props}>
			<div
				className={cn(
					"overflow-auto rounded-md text-xs [&_table]:w-full max-h-20",
					errorText
						? "bg-destructive/10 text-destructive"
						: "bg-muted/50 text-foreground",
				)}
			>
				{errorText && <div>{errorText}</div>}
				{Output}
			</div>
		</div>
	);
};
