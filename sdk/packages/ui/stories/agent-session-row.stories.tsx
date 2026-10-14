import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	AgentSessionOverview,
	AgentSessionRow,
	AgentSessionRowEditor,
} from "../components/agent-session-row";

const meta: Meta<typeof AgentSessionRow> = {
	title: "Components/Agent session row",
	component: AgentSessionRow,
	tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof AgentSessionRow>;

export const States: Story = {
	render: () => (
		<div className="flex w-72 flex-col gap-0.5 p-4">
			<AgentSessionRow label="An idle session" timestamp="2m" />
			<AgentSessionRow active label="The selected session" timestamp="5m" />
			<AgentSessionRow unread label="Unread response" timestamp="8m" />
			<AgentSessionRow
				status="running"
				label="Running session"
				timestamp="now"
			/>
			<AgentSessionRow
				status="provisioning"
				label="Provisioning"
				timestamp="now"
			/>
			<AgentSessionRow
				status="pending"
				disabled
				label="Pending host action"
				timestamp="1m"
			/>
			<AgentSessionRow
				label="A long session title that remains on one line without changing row height"
				timestamp="12m"
			/>
		</div>
	),
};

export const HostSlots: Story = {
	render: () => (
		<div className="flex w-80 flex-col gap-4 p-4">
			<AgentSessionRow
				label="Host-owned actions"
				timestamp="2m"
				action={
					<button
						type="button"
						className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
					>
						Delete
					</button>
				}
			/>
			<AgentSessionRowEditor active>
				<input
					aria-label="Session title"
					defaultValue="Rename session"
					className="min-w-0"
				/>
			</AgentSessionRowEditor>
			<AgentSessionOverview
				title="Session overview"
				items={[
					["Workspace", "cline", "/projects/cline"],
					["Model", "Host-provided model"],
					["Cost", "$0.12"],
				]}
			/>
		</div>
	),
};
