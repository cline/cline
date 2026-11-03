import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowUpRight, EllipsisVertical } from "lucide-react";
import { useState } from "react";
import { Badge } from "../components/badge";
import { Button, IconButton } from "../components/button";
import { DetailList } from "../components/detail-list";
import { DetailListItem } from "../components/detail-list-item";

const settingsPath =
	"/Users/example/.cline/data/settings/cline_mcp_settings.json";

const meta = {
	title: "Components/Detail List Item",
	component: DetailListItem,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"A detail row with a title, optional count, description, trailing text, and independent actions. Render within DetailList, which supplies the border, separators, and responsive container.",
			},
		},
	},
	decorators: [
		(Story) => (
			<div className="w-full max-w-[1100px] p-6">
				<Story />
			</div>
		),
	],
	args: {
		title: "Type",
		description: "The transport used to connect to this server.",
		trailingText: "Remote · Streamable HTTP",
	},
	argTypes: {
		title: { control: "text" },
		count: { control: { type: "number", min: 0, step: 1 } },
		description: { control: "text" },
		trailingText: { control: "text" },
		actions: { control: false },
	},
	render: (args) => (
		<DetailList>
			<DetailListItem {...args} />
		</DetailList>
	),
} satisfies Meta<typeof DetailListItem>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithCount: Story = {
	args: {
		title: "Skills",
		description: undefined,
		count: 1,
		trailingText: "agent-browser",
	},
};

export const DescriptionOnly: Story = {
	args: {
		title: "Authentication",
		description: "This server does not require credentials.",
		trailingText: undefined,
	},
};

export const ConfigurationRequirement: Story = {
	args: {
		title: "CONTEXT7_API_KEY",
		description: "Optional API key for higher rate limits.",
		trailingText: undefined,
	},
	render: function ConfigurationRequirement(args) {
		const [message, setMessage] = useState("");
		return (
			<div className="grid gap-3">
				<DetailList>
					<DetailListItem
						{...args}
						title={
							<>
								<code>{args.title}</code>
								<Badge size="xs">Optional</Badge>
							</>
						}
						actions={
							<Button
								trailingIcon={ArrowUpRight}
								size="xs"
								tone="neutral"
								variant="secondary"
								onClick={() =>
									setMessage("Get value selected. The host handles navigation.")
								}
							>
								Get value
							</Button>
						}
					/>
				</DetailList>
				<output className="text-cline-ui-muted-foreground text-cline-ui-xs">
					{message}
				</output>
			</div>
		);
	},
};

export const TrailingActions: Story = {
	args: {
		title: "MCP settings path",
		description: "Local configuration for your MCP servers.",
		trailingText: settingsPath,
	},
	render: function TrailingActions(args) {
		const [message, setMessage] = useState("");
		return (
			<div className="grid gap-3">
				<DetailList>
					<DetailListItem
						{...args}
						trailingText={
							args.trailingText ? (
								<code>{args.trailingText}</code>
							) : (
								args.trailingText
							)
						}
						actions={
							<IconButton
								icon={EllipsisVertical}
								aria-label="MCP settings path actions"
								size="xs"
								onClick={() =>
									setMessage(
										"Settings path actions selected. The host supplies the menu.",
									)
								}
							/>
						}
					/>
				</DetailList>
				<output className="text-cline-ui-muted-foreground text-cline-ui-xs">
					{message}
				</output>
			</div>
		);
	},
};

export const EmptyOptionalSlots: Story = {
	args: { description: "", trailingText: <>{false}</>, actions: [] },
	parameters: { controls: { disable: true } },
};

export const NarrowActions: Story = {
	args: {
		title: "Configuration",
		description: "Multiple actions wrap within the row.",
		trailingText: "Local",
		actions: (
			<>
				<Button size="sm" variant="secondary" tone="neutral">
					Open configuration
				</Button>
				<Button size="sm" variant="secondary" tone="neutral">
					Reset connection
				</Button>
			</>
		),
	},
	decorators: [
		(Story) => (
			<div style={{ width: 280, maxWidth: "100%" }}>
				<Story />
			</div>
		),
	],
};
