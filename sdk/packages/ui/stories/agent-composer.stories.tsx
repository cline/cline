import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";
import {
	AgentComposer,
	AgentComposerActions,
	AgentComposerAttachments,
	AgentComposerBody,
	AgentComposerField,
	AgentComposerSendButton,
	AgentComposerSettings,
	AgentComposerSettingsEnd,
	AgentComposerSettingsGroup,
	AgentComposerStopButton,
	AgentComposerTextarea,
	type AgentComposerVariant,
	AgentPromptQueue,
} from "../components/index.js";

function ComposerExample({
	variant = "conversation",
	queued = false,
	running = false,
}: {
	variant?: AgentComposerVariant;
	queued?: boolean;
	running?: boolean;
}) {
	const [draft, setDraft] = useState("");
	const [attachment, setAttachment] = useState(true);
	const [queue, setQueue] = useState([
		{ id: "queued", prompt: "Update the tests too", steer: false },
	]);
	const hasQueue = queued && queue.length > 0;
	const input = useRef<HTMLTextAreaElement>(null);
	return (
		<div style={{ width: "min(100%, 48rem)" }}>
			<AgentComposer variant={variant}>
				<AgentComposerBody variant={variant} hasQueue={hasQueue}>
					<AgentPromptQueue
						items={queued ? queue : []}
						onEdit={(_id, prompt) =>
							setQueue((items) => items.map((item) => ({ ...item, prompt })))
						}
						onRemove={() => setQueue([])}
						onSteer={() =>
							setQueue((items) =>
								items.map((item) => ({ ...item, steer: true })),
							)
						}
					/>
					<div className="relative">
						<AgentComposerField
							variant={variant}
							onMouseDown={(event) => {
								if (
									event.target instanceof HTMLElement &&
									event.target.closest("button, input, textarea")
								)
									return;
								event.preventDefault();
								input.current?.focus();
							}}
						>
							<AgentComposerTextarea
								variant={variant}
								ref={input}
								aria-label="Prompt"
								rows={3}
								value={draft}
								onChange={(e) => setDraft(e.target.value)}
								placeholder="Ask to make changes…"
							/>
							<AgentComposerActions variant={variant}>
								{running && (
									<AgentComposerStopButton
										variant={variant}
										type="button"
										aria-label="Stop agent"
										title="Stop the agent (Esc)"
									>
										<span aria-hidden>■</span>
									</AgentComposerStopButton>
								)}
								<AgentComposerSendButton
									variant={variant}
									type="button"
									aria-label="Send message"
									title="Send (Enter)"
									disabled={!draft.trim()}
									onClick={() => setDraft("")}
								>
									<span aria-hidden>↑</span>
								</AgentComposerSendButton>
							</AgentComposerActions>
						</AgentComposerField>
					</div>
					{attachment && (
						<AgentComposerAttachments>
							<button type="button" onClick={() => setAttachment(false)}>
								Host attachment · remove
							</button>
						</AgentComposerAttachments>
					)}
				</AgentComposerBody>
				<AgentComposerSettings>
					<AgentComposerSettingsGroup>
						<button type="button">Host model/settings controls</button>
					</AgentComposerSettingsGroup>
					<AgentComposerSettingsEnd>
						Host workspace/usage
					</AgentComposerSettingsEnd>
				</AgentComposerSettings>
			</AgentComposer>
		</div>
	);
}

const meta = {
	title: "Agent/Composer",
	component: ComposerExample,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"Desktop presentation primitives with host-owned draft, keyboard policy, menus and runtime actions. Placeholder controls illustrate slots; they do not implement a session.",
			},
		},
	},
} satisfies Meta<typeof ComposerExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Conversation: Story = {};
export const Welcome: Story = { args: { variant: "welcome" } };
export const RunningWithQueue: Story = {
	args: { queued: true, running: true },
};
