"use client";

import { GitBranchIcon, Loader2Icon } from "lucide-react";
import type { ReactElement } from "react";
import {
	Checkpoint,
	CheckpointIcon,
	CheckpointTrigger,
} from "@/components/ai-elements/checkpoint";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
	Message,
	MessageContent,
	MessageResponse,
} from "@/components/ai-elements/message";
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
	Tool,
	ToolContent,
	ToolHeader,
	ToolOutput,
} from "@/components/ai-elements/tool";
import TeamTasks, { type TeamToolEvent } from "@/components/TeamTasks";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
	WebviewChatMessage,
	WebviewChatMessageBlock,
} from "../../../webview-protocol";
import { postToHost } from "../vscode";

type ChatMessage = WebviewChatMessage;
type ChatMessageBlock = WebviewChatMessageBlock;
type ToolEvent = NonNullable<WebviewChatMessage["toolEvents"]>[number];

type ToolResultEntry = {
	query?: string;
	result?: string;
	success?: boolean;
};

type ExpandedToolEvent = {
	id: string;
	name: string;
	title: string;
	state: ToolEvent["state"];
	output: string;
	error?: string;
};

function isToolResultArray(value: unknown): value is ToolResultEntry[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		typeof value[0] === "object" &&
		value[0] !== null &&
		"result" in value[0]
	);
}

function formatInputSummary(input: unknown): string {
	if (input == null) {
		return "";
	}
	if (typeof input === "string") {
		return input;
	}
	if (typeof input === "object") {
		const values = Object.values(input as Record<string, unknown>);
		return values
			.filter((v) => typeof v === "string" || typeof v === "number")
			.map(String)
			.join(" ");
	}
	return String(input);
}

function formatRawOutput(output: unknown, fallback: string): string {
	if (output == null) {
		return fallback;
	}
	if (typeof output === "string") {
		return output;
	}
	return JSON.stringify(output, null, 2);
}

function expandToolEvent(toolEvent: ToolEvent): ExpandedToolEvent[] {
	if (isToolResultArray(toolEvent.output)) {
		return toolEvent.output.map((entry, index) => {
			const query = entry.query ?? "";
			const title = query ? `${toolEvent.name}: ${query}` : toolEvent.name;
			const state: ToolEvent["state"] =
				entry.success === false ? "output-error" : toolEvent.state;
			const output =
				entry.result ?? (entry.success === false ? "(failed)" : "(no output)");
			const error =
				entry.success === false ? (entry.result ?? "failed") : undefined;
			return {
				id: `${toolEvent.id}-${index}`,
				name: toolEvent.name,
				title,
				state,
				output,
				error,
			};
		});
	}

	const inputSummary = formatInputSummary(toolEvent.input);
	const title = inputSummary
		? `${toolEvent.name}: ${inputSummary}`
		: toolEvent.name;

	return [
		{
			id: toolEvent.id,
			name: toolEvent.name,
			title,
			state: toolEvent.state,
			output:
				toolEvent.error ?? formatRawOutput(toolEvent.output, toolEvent.text),
			error: toolEvent.error,
		},
	];
}

function renderToolEvent(
	toolEvent: ToolEvent,
	className: string,
): ReactElement[] {
	return expandToolEvent(toolEvent).map((expanded) => (
		<Tool className={className} key={expanded.id}>
			<ToolHeader
				state={expanded.state}
				title={expanded.title}
				type="dynamic-tool"
				toolName={expanded.name}
			/>
			<ToolContent>
				<ToolOutput errorText={expanded.error} output={expanded.output} />
			</ToolContent>
		</Tool>
	));
}

function legacyMessageBlocks(message: ChatMessage): ChatMessageBlock[] {
	const blocks: ChatMessageBlock[] = [];
	for (const toolEvent of message.toolEvents ?? []) {
		blocks.push({ id: `legacy-tool-${toolEvent.id}`, type: "tool", toolEvent });
	}
	if (message.reasoning) {
		blocks.push({
			id: `legacy-reasoning-${message.id}`,
			type: "reasoning",
			text: message.reasoning,
			redacted: message.reasoningRedacted,
		});
	}
	if (message.text) {
		blocks.push({
			id: `legacy-text-${message.id}`,
			type: "text",
			text: message.text,
		});
	}
	return blocks;
}

function renderMessageBlocks(
	message: ChatMessage,
	options: { isMeta?: boolean; sending?: boolean },
): ReactElement[] {
	const blocks = message.blocks?.length
		? message.blocks
		: legacyMessageBlocks(message);
	return blocks.flatMap((block) => {
		switch (block.type) {
			case "tool":
				if (block.toolEvent.name.startsWith("team_")) {
					return [
						<TeamTasks
							className={options.isMeta ? "mt-3 w-full" : "mb-3 w-full"}
							events={[block.toolEvent] as TeamToolEvent[]}
							key={block.id}
						/>,
					];
				}
				return renderToolEvent(
					block.toolEvent,
					options.isMeta ? "mt-3" : "mb-3",
				);
			case "reasoning":
				return [
					<Reasoning
						className={options.isMeta ? "mt-3" : "mb-3"}
						defaultOpen={false}
						key={block.id}
					>
						<ReasoningTrigger />
						<ReasoningContent>{block.text}</ReasoningContent>
					</Reasoning>,
				];
			case "text":
				if (options.isMeta) {
					return [
						<pre className="whitespace-pre-wrap font-inherit" key={block.id}>
							{block.text}
						</pre>,
					];
				}
				return [
					<MessageContent key={block.id}>
						<MessageResponse>{block.text}</MessageResponse>
					</MessageContent>,
				];
			default: {
				const _exhaustive: never = block;
				void _exhaustive;
				return [];
			}
		}
	});
}

function formatCheckpointTime(createdAt: number): string {
	try {
		return new Intl.DateTimeFormat(undefined, {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		}).format(new Date(createdAt));
	} catch {
		return "Checkpoint";
	}
}

export type ConversationPanelProps = {
	forkError: string | null;
	forking: boolean;
	isHydrating: boolean;
	messages: ChatMessage[];
	onFork: () => void;
	sending: boolean;
};

export function ConversationPanel({
	forkError,
	forking,
	isHydrating,
	messages,
	onFork,
	sending,
}: ConversationPanelProps) {
	return (
		<Conversation className="min-h-0 flex-1">
			<ConversationContent className="px-4 py-5">
				{isHydrating ? (
					<div className="flex h-full items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center text-sm text-muted-foreground">
						<span className="inline-flex items-center gap-2">
							<Loader2Icon className="size-4 animate-spin" />
							Loading chat history...
						</span>
					</div>
				) : messages.length === 0 ? (
					<div className="flex h-full items-center align-middle justify-center rounded-xl border border-dashed px-6 py-16 text-center text-sm text-muted-foreground">
						How can I help you?
					</div>
				) : null}
				{messages.map((message) => {
					if (message.role === "meta" || message.role === "error") {
						return (
							<div
								className={cn(
									"w-full rounded-lg border px-4 py-3 text-sm",
									message.role === "error"
										? "border-destructive/40 bg-destructive/10 text-destructive"
										: "bg-muted/40 text-muted-foreground",
								)}
								key={message.id}
							>
								{renderMessageBlocks(message, { isMeta: true })}
							</div>
						);
					}

					return (
						<Message from={message.role} key={message.id}>
							<div>
								{renderMessageBlocks(message, { sending })}
								{message.role === "user" && message.checkpoint ? (
									<Checkpoint className="mt-1 justify-end">
										<CheckpointTrigger
											className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
											disabled={sending}
											onClick={() => {
												if (message.checkpoint) {
													postToHost({
														type: "restore",
														checkpointRunCount: message.checkpoint.runCount,
													});
												}
											}}
											tooltip={`Checkpoint from run ${message.checkpoint.runCount}`}
											type="button"
											variant="ghost"
										>
											<CheckpointIcon className="size-3" />
											{formatCheckpointTime(message.checkpoint.createdAt)}
										</CheckpointTrigger>
									</Checkpoint>
								) : null}
								{message.role === "assistant" && message.text && !sending ? (
									<div className="mt-1 flex items-center gap-1">
										<Button
											className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
											disabled={forking}
											onClick={onFork}
											size="sm"
											title="Fork session — copy full message history into a new session"
											type="button"
											variant="ghost"
										>
											{forking ? (
												<Loader2Icon className="size-3 animate-spin" />
											) : (
												<GitBranchIcon className="size-3" />
											)}
											Fork
										</Button>
										{forkError ? (
											<span className="text-[11px] text-destructive">
												{forkError}
											</span>
										) : null}
									</div>
								) : null}
							</div>
						</Message>
					);
				})}
			</ConversationContent>
			<ConversationScrollButton />
		</Conversation>
	);
}
