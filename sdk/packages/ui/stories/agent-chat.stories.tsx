import type { Meta } from "@storybook/react-vite";
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
	ConversationViewport,
	Message,
	MessageAction,
	MessageActions,
	MessageContent,
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
	ToolActivity,
	ToolActivityCode,
	ToolActivityContent,
	ToolActivityDetails,
	ToolActivityTrigger,
} from "../components/agent-chat";
import { ToolFileDiff } from "../components/agent-chat/tool-diff";
import {
	buildToolSummary,
	type ToolKind,
	type ToolSummary,
	type ToolSummaryItem,
} from "../components/agent-chat/tool-summary";

const meta: Meta<typeof Conversation> = {
	title: "Agent chat/Primitives",
	component: Conversation,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"Composable presentation primitives for agent conversations. Products retain transport, schemas, Markdown policy, approvals, and tool-result normalization.",
			},
		},
	},
};

export default meta;

function SearchIcon() {
	return <span aria-hidden="true">⌕</span>;
}

function TerminalIcon() {
	return <span aria-hidden="true">›_</span>;
}

function EditIcon() {
	return <span aria-hidden="true">✎</span>;
}

function CopyIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
		>
			<rect height="14" rx="2" ry="2" width="14" x="8" y="8" />
			<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
		</svg>
	);
}

function PencilIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
		>
			<path d="M12 20h9" />
			<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
		</svg>
	);
}

function UndoIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
		>
			<path d="M9 14 4 9l5-5" />
			<path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
		</svg>
	);
}

function ForkIcon() {
	return (
		<svg
			aria-hidden="true"
			className="rotate-90"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
		>
			<path d="M16 3h5v5" />
			<path d="M8 3H3v5" />
			<path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" />
			<path d="m15 9 6-6" />
		</svg>
	);
}

function MessageTimestamp({ children }: { children: React.ReactNode }) {
	return (
		<time
			className="shrink-0 whitespace-nowrap text-xs leading-none text-muted-foreground"
			dateTime="2026-08-11T11:18:00-07:00"
		>
			{children}
		</time>
	);
}

function ChatFrame({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex h-[680px] min-w-[320px] bg-background">
			<Conversation>
				<ConversationViewport aria-label="Example agent conversation">
					<ConversationContent className="mx-auto max-w-3xl p-6">
						{children}
					</ConversationContent>
				</ConversationViewport>
				<ConversationScrollButton />
			</Conversation>
		</div>
	);
}

export const CompleteConversation = () => (
	<ChatFrame>
		<Message from="user">
			<MessageContent>
				Can you find the settings screen and align it with our shared theme?
			</MessageContent>
			<MessageActions side="end">
				<MessageAction label="Copy user message" title="Copy message">
					<CopyIcon />
				</MessageAction>
				<MessageAction
					label="Edit user message"
					title="Edit message and restart from this point"
				>
					<PencilIcon />
				</MessageAction>
				<MessageAction label="Restore checkpoint" title="Restore checkpoint">
					<UndoIcon />
				</MessageAction>
				<MessageTimestamp>11:18 AM</MessageTimestamp>
			</MessageActions>
		</Message>

		<Message from="assistant">
			<MessageContent>
				<Reasoning>
					<ReasoningTrigger />
					<ReasoningContent presentation="rail">
						I should inspect the existing navigation and map its surfaces to the
						semantic theme contract before changing layout.
					</ReasoningContent>
				</Reasoning>
			</MessageContent>

			<ToolActivity expandable>
				<ToolActivityTrigger
					icon={<SearchIcon />}
					label="Explored 3 files"
					status="success"
				/>
				<ToolActivityContent presentation="rail">
					<ToolActivityDetails>
						<div>settings-view.tsx</div>
						<div>agent-sidebar.tsx</div>
						<div>tokens.css</div>
					</ToolActivityDetails>
				</ToolActivityContent>
			</ToolActivity>

			<ToolActivity expandable>
				<ToolActivityTrigger
					additions={42}
					deletions={18}
					icon={<EditIcon />}
					label="Edited settings-view.tsx"
					status="success"
				/>
				<ToolActivityContent presentation="rail">
					<ToolActivityCode>
						{"+ background: var(--background);\n- background: #111;"}
					</ToolActivityCode>
				</ToolActivityContent>
			</ToolActivity>

			<MessageContent>
				<p>
					Done. Settings now uses the shared background, card, border, and
					typography tokens in both light and dark modes.
				</p>
				<ul className="cline-markdown list-disc pl-5">
					<li>Aligned navigation surfaces</li>
					<li>Preserved product-specific settings behavior</li>
					<li>Verified keyboard focus states</li>
				</ul>
			</MessageContent>
			<MessageActions side="start">
				<MessageAction label="Copy assistant message" title="Copy response">
					<CopyIcon />
				</MessageAction>
				<MessageAction
					label="Fork session"
					title="Fork session - copy full message history into a new session"
				>
					<ForkIcon />
				</MessageAction>
				<MessageTimestamp>11:18 AM</MessageTimestamp>
			</MessageActions>
		</Message>
	</ChatFrame>
);

export const Streaming = () => (
	<ChatFrame>
		<Message from="user">
			<MessageContent>Run the focused tests.</MessageContent>
		</Message>
		<Message from="assistant">
			<MessageContent>
				<Reasoning defaultOpen isStreaming>
					<ReasoningTrigger />
					<ReasoningContent>
						I am checking the package build, component interactions, and the
						static Storybook output.
					</ReasoningContent>
				</Reasoning>
			</MessageContent>
			<ToolActivity expandable={false}>
				<ToolActivityTrigger
					icon={<TerminalIcon />}
					label="Running bun -F @cline/ui test"
					status="running"
				/>
			</ToolActivity>
			<MessageContent>All package tests are passing so far…</MessageContent>
		</Message>
	</ChatFrame>
);

export const DisclosurePresentations = () => (
	<div className="grid max-w-4xl gap-8 bg-background p-6 md:grid-cols-2">
		<section className="min-w-0 space-y-3">
			<div>
				<h2 className="text-sm font-semibold text-foreground">Rail</h2>
				<p className="text-xs text-muted-foreground">
					Lightweight transcript disclosures
				</p>
			</div>
			<Reasoning>
				<ReasoningTrigger completeLabel="Thought for 4s" />
				<ReasoningContent presentation="rail">
					I compared the existing message hierarchy, spacing, and interaction
					patterns before choosing the smallest shared abstraction.
				</ReasoningContent>
			</Reasoning>
			<ToolActivity>
				<ToolActivityTrigger icon={<SearchIcon />} label="Explored 3 files" />
				<ToolActivityContent presentation="rail">
					<ToolActivityDetails>
						<div>disclosure.tsx</div>
						<div>index.tsx</div>
						<div>agent-chat.css</div>
					</ToolActivityDetails>
				</ToolActivityContent>
			</ToolActivity>
		</section>

		<section className="min-w-0 space-y-3">
			<div>
				<h2 className="text-sm font-semibold text-foreground">Panel</h2>
				<p className="text-xs text-muted-foreground">
					Contained disclosures for denser surfaces
				</p>
			</div>
			<Reasoning defaultOpen>
				<ReasoningTrigger completeLabel="Thought for 4s" />
				<ReasoningContent presentation="panel">
					I compared the existing message hierarchy, spacing, and interaction
					patterns before choosing the smallest shared abstraction.
				</ReasoningContent>
			</Reasoning>
			<ToolActivity defaultOpen>
				<ToolActivityTrigger icon={<SearchIcon />} label="Explored 3 files" />
				<ToolActivityContent presentation="panel">
					<ToolActivityDetails>
						<div>disclosure.tsx</div>
						<div>index.tsx</div>
						<div>agent-chat.css</div>
					</ToolActivityDetails>
				</ToolActivityContent>
			</ToolActivity>
		</section>
	</div>
);

export const ToolStates = () => (
	<ChatFrame>
		{(
			[
				["Waiting to edit theme.css", "pending"],
				["Running component tests", "running"],
				["Updated 2 files", "success"],
				["Command failed with exit code 1", "error"],
			] as const
		).map(([label, status]) => (
			<ToolActivity expandable={status !== "pending"} key={status}>
				<ToolActivityTrigger
					icon={<TerminalIcon />}
					label={label}
					status={status}
				/>
				<ToolActivityContent presentation="rail">
					<ToolActivityCode>
						{status === "error"
							? "Error: expected --background token"
							: "@cline/ui theme contract is valid"}
					</ToolActivityCode>
				</ToolActivityContent>
			</ToolActivity>
		))}
	</ChatFrame>
);

const SUMMARY_ICONS: Partial<Record<ToolKind, () => React.ReactNode>> = {
	command: TerminalIcon,
	edit: EditIcon,
	read: SearchIcon,
	search: SearchIcon,
};

type SummaryDiffEntry = {
	key: string;
	kind: "rich" | "text";
	item: Extract<ToolSummaryItem, { type: "file" }>;
	hunk: { oldText?: string; newText: string } | null;
};

function SummaryToolRow({ summary }: { summary: ToolSummary }) {
	const Icon = SUMMARY_ICONS[summary.kind] ?? TerminalIcon;
	const diffs = summary.items.flatMap<SummaryDiffEntry>((item, index) => {
		if (item.type !== "file") return [];
		const hunks =
			item.hunks ??
			(item.newText !== undefined
				? [{ oldText: item.oldText, newText: item.newText }]
				: null);
		if (hunks) {
			return hunks.map((hunk, hunkIndex) => ({
				key: `${index}-${hunkIndex}`,
				kind: "rich" as const,
				item,
				hunk,
			}));
		}
		return item.diff
			? [{ key: `${index}`, kind: "text" as const, item, hunk: null }]
			: [];
	});
	const expandable =
		summary.details.length > 0 ||
		diffs.length > 0 ||
		Boolean(summary.outputText) ||
		Boolean(summary.errorText);
	return (
		<ToolActivity defaultOpen={diffs.length > 0} expandable={expandable}>
			<ToolActivityTrigger
				additions={summary.diff?.additions || undefined}
				deletions={summary.diff?.deletions || undefined}
				icon={<Icon />}
				label={
					<span>
						{summary.labelParts.map((part, index) =>
							part.code ? (
								<span
									className="font-mono"
									// biome-ignore lint/suspicious/noArrayIndexKey: positional
									key={index}
								>
									{part.text}
								</span>
							) : (
								// biome-ignore lint/suspicious/noArrayIndexKey: positional
								<span key={index}>{part.text}</span>
							),
						)}
					</span>
				}
				status={summary.errorText ? "error" : "success"}
			/>
			<ToolActivityContent presentation="rail">
				{summary.details.length > 0 ? (
					<ToolActivityDetails>
						{summary.details.map((detail, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static fixtures
							<div key={index}>{detail}</div>
						))}
					</ToolActivityDetails>
				) : null}
				{diffs.map((entry) =>
					entry.kind === "rich" && entry.hunk ? (
						<ToolFileDiff
							fragment={entry.item.fragment}
							key={entry.key}
							newText={entry.hunk.newText}
							oldText={entry.hunk.oldText}
							path={entry.item.path}
						/>
					) : (
						<ToolActivityCode key={entry.key}>
							{entry.item.diff}
						</ToolActivityCode>
					),
				)}
				{summary.outputText ? (
					<ToolActivityCode>{summary.outputText}</ToolActivityCode>
				) : null}
				{summary.errorText ? (
					<ToolActivityCode>{summary.errorText}</ToolActivityCode>
				) : null}
			</ToolActivityContent>
		</ToolActivity>
	);
}

/**
 * Rows driven end-to-end by `buildToolSummary` from
 * `@cline/ui/components/agent-chat/tool-summary` — the same payloads the
 * desktop app and cloud dashboard feed it.
 */
export const ToolSummaries = () => (
	<ChatFrame>
		<Message from="assistant">
			{[
				buildToolSummary({
					toolName: "read_files",
					input: {
						files: [{ path: "src/app.tsx", start_line: 10, end_line: 80 }],
					},
				}),
				buildToolSummary({
					toolName: "read_files",
					input: {
						file_paths: [
							"webview/components/views/chat/chat-messages.tsx",
							"webview/lib/chat-schema.ts",
							"webview/lib/session-diff.ts",
						],
					},
				}),
				buildToolSummary({
					toolName: "run_commands",
					input: { commands: ["bun run test"] },
					result: "45 tests passed",
				}),
				buildToolSummary({
					toolName: "editor",
					input: {
						path: "src/util.ts",
						old_text: "const a = 1;\nconst b = 2;",
						new_text: "const a = 1;\nconst b = 3;\nconst c = 4;",
					},
				}),
				buildToolSummary({
					toolName: "apply_patch",
					input: [
						"*** Begin Patch",
						"*** Update File: webview/components/views/chat/chat-messages.tsx",
						" const label = buildGroupedToolLabel(presentations);",
						"-const icons = presentations.map(getIcon);",
						"+const icons = presentations.map(({ toolName }) =>",
						"+\tgetToolNameIcon(toolName),",
						"+);",
						"*** Add File: webview/lib/tool-colors.ts",
						"+export const TOOL_COLORS = {",
						'+\tedit: "var(--accent)",',
						'+\tread: "var(--muted)",',
						"+};",
						"*** End Patch",
					].join("\n"),
				}),
				buildToolSummary({
					toolName: "search_codebase",
					input: { queries: ["ToolActivityTrigger"] },
				}),
				buildToolSummary({
					toolName: "team_spawn_teammate",
					result: { agentId: "researcher-1" },
				}),
				buildToolSummary({
					toolName: "run_commands",
					input: { commands: ["bun run deploy"] },
					isError: true,
					result: { error: "exit code 1: missing credentials" },
				}),
			].map((summary, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static fixtures
				<SummaryToolRow key={index} summary={summary} />
			))}
		</Message>
	</ChatFrame>
);

export const Empty = () => (
	<ChatFrame>
		<ConversationEmptyState
			description="Send a prompt to begin an agent session."
			icon={<span className="text-3xl">✦</span>}
			title="What should we build?"
		/>
	</ChatFrame>
);

export const ErrorMessage = () => (
	<ChatFrame>
		<Message from="error">
			<MessageContent>
				The agent connection was interrupted. Your conversation is safe; retry
				when the connection is restored.
			</MessageContent>
		</Message>
	</ChatFrame>
);

export const DisabledControls = () => (
	<ChatFrame>
		<Message from="assistant">
			<MessageContent>Actions stay readable when unavailable.</MessageContent>
			<MessageActions visible>
				<MessageAction disabled label="Copy message">
					<CopyIcon />
				</MessageAction>
			</MessageActions>
			<Reasoning>
				<ReasoningTrigger disabled />
				<ReasoningContent>Unavailable reasoning</ReasoningContent>
			</Reasoning>
			<ToolActivity>
				<ToolActivityTrigger disabled label="Tool details unavailable" />
				<ToolActivityContent>Unavailable tool details</ToolActivityContent>
			</ToolActivity>
		</Message>
	</ChatFrame>
);
