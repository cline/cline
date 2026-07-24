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
			<MessageActions>
				<MessageAction label="Copy user message" title="Copy message">
					Copy
				</MessageAction>
			</MessageActions>
		</Message>

		<Message from="assistant">
			<MessageContent>
				<Reasoning>
					<ReasoningTrigger />
					<ReasoningContent>
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
				<ToolActivityContent>
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
				<ToolActivityContent>
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
			<MessageActions>
				<MessageAction label="Copy assistant message" title="Copy response">
					Copy
				</MessageAction>
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
				<ToolActivityContent>
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
					Copy
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
