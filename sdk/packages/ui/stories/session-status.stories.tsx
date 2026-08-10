import type { Meta, StoryObj } from "@storybook/react-vite";
import { SessionStatus } from "../components/session-status";

const meta: Meta<typeof SessionStatus> = {
	title: "Components/Session status",
	component: SessionStatus,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"Compact session state indicator. The dot color follows the tone; set --cline-ui-session-status-color for a host-specific palette.",
			},
		},
	},
};

export default meta;

type Story = StoryObj<typeof SessionStatus>;

export const States: Story = {
	render: () => (
		<div className="flex flex-col gap-4 p-6">
			<SessionStatus label="Idle" tone="neutral" />
			<SessionStatus label="Running" tone="running" />
			<SessionStatus label="Error" tone="error" />
		</div>
	),
};
