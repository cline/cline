import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	AgentAskQuestion,
	type AgentAskQuestionItem,
} from "../components/agent-ask-question";

const questions: AgentAskQuestionItem[] = [
	{
		description: "This controls where the new settings entry point appears.",
		id: "location",
		meta: "Required",
		options: ["Sidebar", "Command palette", "Both"],
		question: "Where should users open this feature?",
	},
	{
		id: "scope",
		options: ["Current workspace", "All workspaces"],
		question: "Should the preference apply globally?",
	},
];

const meta: Meta<typeof AgentAskQuestion> = {
	title: "Agent/Ask question",
	component: AgentAskQuestion,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"Presents one or more model-supplied follow-up questions with explicit submission. Set an item to multiple and provide onAnswers to allow more than one selection. Hosts own pending and error state for each question.",
			},
		},
	},
	args: {
		items: questions,
		onAnswer: () => {},
	},
};

export default meta;

type Story = StoryObj<typeof AgentAskQuestion>;

export const Default: Story = {
	render: (args) => (
		<div className="mx-auto max-w-2xl p-6">
			<AgentAskQuestion {...args} />
		</div>
	),
};

export const SendingAnswer: Story = {
	args: {
		pendingAnswers: { location: "Both" },
	},
	render: Default.render,
};

export const ErrorState: Story = {
	args: {
		errors: { location: "The answer could not be sent. Please try again." },
	},
	render: Default.render,
};

export const LongOptions: Story = {
	args: {
		items: [
			{
				id: "strategy",
				options: [
					"Keep the existing behavior and only update the visual presentation",
					"Replace the existing flow with the new shared component",
				],
				question: "Which implementation strategy should Cline use?",
			},
		],
	},
	render: Default.render,
};

export const MultipleChoice: Story = {
	args: {
		items: [
			{
				id: "surfaces",
				multiple: true,
				options: ["Desktop", "VS Code", "CLI"],
				question: "Where should this feature be available?",
			},
		],
		onAnswers: () => {},
	},
	render: Default.render,
};
