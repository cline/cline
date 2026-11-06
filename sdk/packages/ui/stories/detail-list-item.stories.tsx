import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	ArrowUpRight,
	Clock3,
	EllipsisVertical,
	Folder,
	Settings2,
} from "lucide-react";
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
					"A detail row with a title, optional leading icon, count, description, trailing text, and independent actions. No icon is shown by default. Pass an SVG component through leadingIcon; the row owns its size and spacing. Render within DetailList, which supplies the border, separators, and responsive container.",
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
		leadingIcon: {
			control: false,
			description:
				"Optional decorative SVG component, such as Clock3. The row manages its size and spacing; omitted by default.",
		},
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

export const WithLeadingIcon: Story = {
	args: {
		title: "Schedule",
		leadingIcon: Clock3,
		description: "Run this task automatically at the selected time.",
		trailingText: "Weekdays · 9:00 AM",
	},
};

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
		leadingIcon: Settings2,
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

export const ResponsiveControls: Story = {
	args: {
		title: <label htmlFor="detail-list-project-folder">Project folder</label>,
		leadingIcon: Folder,
		description: "Runs in this folder and uses its project settings.",
		trailingText: undefined,
		actions: (
			<div className="flex w-96 max-w-full min-w-0 items-center gap-2">
				<input
					id="detail-list-project-folder"
					className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5"
					defaultValue="/Users/example/Documents/GitHub/cline"
				/>
				<Button size="sm" variant="secondary" tone="neutral">
					Browse…
				</Button>
			</div>
		),
	},
	parameters: {
		docs: {
			description: {
				story:
					"Resize the container: controls move below the label when the icon and text would have less than 18rem, even above the list's narrow breakpoint.",
			},
		},
	},
};
