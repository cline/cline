import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentApprovalCard } from "../components/agent-approval-card";

const meta: Meta<typeof AgentApprovalCard> = {
	title: "Agent/Approval card",
	component: AgentApprovalCard,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"Presents an agent action that requires explicit approval. Hosts provide the action details and own approval, rejection, pending, and error state.",
			},
		},
	},
	args: {
		description: "Cline wants to run a command in the current workspace.",
		detail: "bun run test:unit",
		meta: "Terminal",
		onApprove: () => {},
		onReject: () => {},
		title: "Run command?",
	},
};

export default meta;

type Story = StoryObj<typeof AgentApprovalCard>;

export const Default: Story = {
	render: (args) => (
		<div className="mx-auto max-w-xl p-6">
			<AgentApprovalCard {...args} />
		</div>
	),
};

export const Approving: Story = {
	args: {
		responding: "approve",
	},
	render: Default.render,
};

export const Rejecting: Story = {
	args: {
		responding: "reject",
	},
	render: Default.render,
};

export const ErrorState: Story = {
	args: {
		error:
			"The command could not be approved. Check your workspace permissions.",
	},
	render: Default.render,
};
