import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
	FileCodeIcon,
	MessagesSquareIcon,
	PencilIcon,
	TerminalIcon,
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
	className?: string;
} & (
	| { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
	| {
			type: DynamicToolUIPart["type"];
			state: DynamicToolUIPart["state"];
			toolName: string;
	  }
);

const toolIcons: Record<string, ReactNode> = {
	run_commands: <TerminalIcon className="size-4" />,
	read_files: <FileCodeIcon className="size-4" />,
	editor: <PencilIcon className="size-4" />,
	ask_question: <MessagesSquareIcon className="size-4" />,
};

const getToolBadge = (toolName: string) => {
	return (
		<Badge className="text-xs" variant="ghost">
			{(toolName && toolIcons[toolName]) || <WrenchIcon className="size-4" />}
		</Badge>
	);
};

export const ToolHeader = ({
	className,
	title,
	type,
	state,
	toolName,
	...props
}: ToolHeaderProps) => {
	const toolNameParts = title?.split(":");
	const _toolName = toolNameParts?.[0] || toolName;
	const toolInput = toolNameParts?.[1];
	const derivedName = _toolName || title || type.split("-").slice(1).join("-");

	return (
		<CollapsibleTrigger
			className={cn(
				"flex w-full overflow-hidden items-center justify-between gap-4 p-3 cursor-pointer",
				className,
			)}
			{...props}
		>
			<div className="flex items-center gap-2 shrink-0">
				{getToolBadge(derivedName)}
				<span className="font-light text-muted-foreground text-sm truncated wrap-break-word ellipses">
					{toolInput}
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
