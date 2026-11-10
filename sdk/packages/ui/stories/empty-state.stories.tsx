import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "../components/empty-state";

const meta = {
	title: "Components/Empty State",
	component: EmptyState,
	tags: ["autodocs"],
	decorators: [
		(Story) => (
			<div style={{ width: "100%", maxWidth: 900, padding: 24 }}>
				<Story />
			</div>
		),
	],
	args: { align: "left", description: "No rules found." },
	argTypes: {
		align: { control: "inline-radio", options: ["left", "center"] },
		size: { control: "inline-radio", options: ["md", "lg"] },
		surface: { control: "inline-radio", options: ["muted", "transparent"] },
		media: { control: false },
		title: { control: "text" },
		description: { control: "text" },
		headingLevel: { control: "select", options: [2, 3, 4, 5, 6] },
		action: { control: false },
		secondaryAction: { control: false },
		children: { control: false },
	},
} satisfies Meta<typeof EmptyState>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Centered: Story = { args: { align: "center" } };
export const Illustrated: Story = {
	args: {
		align: "center",
		size: "lg",
		surface: "transparent",
		media: <CalendarDays aria-hidden="true" size={72} strokeWidth={1} />,
		title: "No schedules yet",
		description: "Create a schedule to run work automatically.",
		action: { label: "Create schedule", onClick: () => {} },
	},
};
export const WithTitle: Story = {
	args: {
		title: "No plugins installed",
		description: "Browse the marketplace to add one.",
	},
};

export const WithAction: Story = {
	args: { title: "No plugins installed" },
	argTypes: { description: { control: false } },
	render: function WithAction(args) {
		const [refreshed, setRefreshed] = useState(false);
		return (
			<EmptyState
				{...args}
				description={
					refreshed
						? "Inventory refreshed. No plugins found."
						: "Refresh your installed plugins."
				}
				action={{ label: "Refresh", onClick: () => setRefreshed(true) }}
			/>
		);
	},
};
export const CenteredWithAction: Story = {
	...WithAction,
	args: { ...WithAction.args, align: "center" },
};
export const WithTwoActions: Story = {
	args: {
		align: "center",
		description: "No MCP servers found.",
		action: { label: "Browse marketplace", onClick: () => {} },
		secondaryAction: { label: "Add MCP Server", onClick: () => {} },
	},
};
export const DisabledAction: Story = {
	args: {
		title: "No plugins installed",
		description: "Checking for installed plugins…",
		action: { label: "Refreshing…", onClick: () => {}, disabled: true },
	},
};
export const Narrow: Story = {
	args: WithTwoActions.args,
	decorators: [
		(Story) => (
			<div style={{ width: 240, maxWidth: "100%" }}>
				<Story />
			</div>
		),
	],
};
