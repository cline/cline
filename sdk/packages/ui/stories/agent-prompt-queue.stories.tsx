import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
	AgentPromptQueue,
	type AgentPromptQueueItem,
	type AgentPromptQueueProps,
} from "../components/agent-prompt-queue";

const queuedPrompts: AgentPromptQueueItem[] = [
	{
		attachmentCount: 2,
		id: "tests",
		prompt: "Add tests for the new authentication flow",
		steer: true,
	},
	{
		id: "docs",
		prompt: "Update the contributor documentation with the new setup steps",
		steer: false,
	},
	{
		attachmentCount: 1,
		id: "review",
		prompt: "Review the final diff for accessibility issues",
		steer: false,
	},
];

const meta: Meta<typeof AgentPromptQueue> = {
	title: "Agent/Prompt queue",
	component: AgentPromptQueue,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"Shows prompts waiting behind the active agent turn. Expand the queue to steer, edit, or remove items; hosts persist each change through callbacks.",
			},
		},
	},
};

export default meta;

type Story = StoryObj<typeof AgentPromptQueue>;

function InteractiveQueue({ initialItems }: { initialItems: AgentPromptQueueItem[] }) {
	const [items, setItems] = useState(initialItems);

	const props: AgentPromptQueueProps = {
		items,
		onEdit: (id, prompt) => {
			setItems((current) =>
				current.map((item) => (item.id === id ? { ...item, prompt } : item)),
			);
		},
		onRemove: (id) => {
			setItems((current) => current.filter((item) => item.id !== id));
		},
		onSteer: (id) => {
			setItems((current) =>
				current.map((item) => ({ ...item, steer: item.id === id })),
			);
		},
	};

	return <AgentPromptQueue {...props} />;
}

export const Interactive: Story = {
	render: () => (
		<div className="mx-auto max-w-2xl p-6">
			<InteractiveQueue initialItems={queuedPrompts} />
		</div>
	),
};

export const SinglePrompt: Story = {
	render: () => (
		<div className="mx-auto max-w-2xl p-6">
			<InteractiveQueue initialItems={[queuedPrompts[1]]} />
		</div>
	),
};