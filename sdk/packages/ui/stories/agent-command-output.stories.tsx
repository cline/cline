import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentCommandOutput } from "../components/agent-command-output";

const meta: Meta<typeof AgentCommandOutput> = {
	title: "Agent/Command output",
	component: AgentCommandOutput,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"Command output with a running cursor and tail following. Hosts retain ANSI rendering or plain-text normalization through children.",
			},
		},
	},
	args: { output: "$ bun run test\nRunning tests…", isRunning: true },
	render: (args) => (
		<div className="mx-auto max-w-xl p-6">
			<AgentCommandOutput {...args} />
		</div>
	),
};
export default meta;
type Story = StoryObj<typeof AgentCommandOutput>;

export const Running: Story = {};
export const Completed: Story = {
	args: { output: "$ bun run test\n12 tests passed.\nDone.", isRunning: false },
};
export const LongOutput: Story = {
	args: {
		output: Array.from(
			{ length: 80 },
			(_, index) => `Test ${index + 1}: passed`,
		).join("\n"),
		isRunning: false,
	},
};
export const HostRendered: Story = {
	args: {
		output: "Build succeeded",
		isRunning: false,
		children: <span className="text-green-400">Build succeeded</span>,
	},
};
