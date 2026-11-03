import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	type AgentQuickAction,
	AgentQuickActions,
} from "../components/agent-quick-actions";

const actions: AgentQuickAction[] = [
	{
		description: "Create a focused implementation plan before editing files",
		id: "plan",
		label: "Plan this task",
		value: "Create an implementation plan for this task.",
	},
	{
		description: "Find the files and symbols most relevant to the request",
		id: "explore",
		label: "Explore the codebase",
		value: "Explore the codebase and identify the relevant files.",
	},
	{
		description: "Start implementing and verify the result with tests",
		id: "implement",
		label: "Implement the change",
		value: "Implement this change and run the relevant tests.",
	},
];

const meta: Meta<typeof AgentQuickActions> = {
	title: "Agent/Quick actions",
	component: AgentQuickActions,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"Displays a compact list of suggested prompts. The host receives the selected action and decides how to populate or submit it.",
			},
		},
	},
	args: {
		actions,
		onSelect: () => {},
	},
};

export default meta;

type Story = StoryObj<typeof AgentQuickActions>;

export const Default: Story = {
	render: (args) => (
		<div className="mx-auto max-w-xl p-6">
			<AgentQuickActions {...args} />
		</div>
	),
};

export const Disabled: Story = {
	args: {
		disabled: true,
	},
	render: Default.render,
};

export const SingleAction: Story = {
	args: {
		actions: [actions[0]],
	},
	render: Default.render,
};
