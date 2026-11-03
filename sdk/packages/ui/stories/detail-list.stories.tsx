import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowUpRight, Copy, EllipsisVertical } from "lucide-react";
import { useState } from "react";
import { Badge } from "../components/badge";
import { Button, IconButton } from "../components/button";
import { DetailList } from "../components/detail-list";
import { DetailListItem } from "../components/detail-list-item";

const settingsPath =
	"/Users/haley/.cline/data/settings/cline_mcp_settings.json";

const meta = {
	title: "Components/Detail List",
	component: DetailList,
	subcomponents: { DetailListItem },
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"A neutral description list that groups related DetailListItem components with a shared border and separators. Compose direct items for metadata and configuration requirements; each item owns its title, optional count, description, trailingText, and actions. Items stack at container widths of 30rem or less. Use the theme toolbar to preview light and dark colors.",
			},
		},
	},
	decorators: [
		(Story) => (
			<div style={{ width: "100%", maxWidth: 1100, padding: 24 }}>
				<Story />
			</div>
		),
	],
	argTypes: { children: { control: false } },
} satisfies Meta<typeof DetailList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	render: (args) => (
		<DetailList {...args}>
			<DetailListItem title="Type" trailingText="Remote · Streamable HTTP" />
			<DetailListItem title="Authentication" trailingText="API key" />
			<DetailListItem title="Status" trailingText="Connected" />
		</DetailList>
	),
};

export const ServerDetails: Story = {
	render: function ServerDetails(args) {
		const [message, setMessage] = useState("");
		return (
			<div className="grid gap-3">
				<DetailList {...args} aria-label="Server details">
					<DetailListItem
						title="Type"
						trailingText="Remote · Streamable HTTP"
					/>
					<DetailListItem
						title="URL"
						trailingText="https://adobe-creativity.adobe.io/mcp"
					/>
					<DetailListItem
						title="MCP settings path"
						trailingText={<code>{settingsPath}</code>}
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

export const LongPath: Story = {
	parameters: {
		docs: {
			description: {
				story:
					"Short labels leave the remaining row width available to long values. Paths wrap only when the available space is exhausted.",
			},
		},
	},
	render: (args) => (
		<DetailList {...args} style={{ maxWidth: 840, ...args.style }}>
			<DetailListItem title="Scope" trailingText="Project" />
			<DetailListItem
				title="Path"
				trailingText="/Users/haley/.cline/plugins/_installed/official/agent-browser-b96ba1011a40/package/index.ts"
				actions={<IconButton icon={Copy} aria-label="Copy path" size="xs" />}
			/>
		</DetailList>
	),
};

export const Narrow: Story = {
	render: (args) => (
		<DetailList {...args}>
			<DetailListItem
				title={
					<>
						<code>WORKSPACE_SERVICE_AUTHENTICATION_TOKEN</code>
						<Badge size="xs">Optional</Badge>
					</>
				}
				description="Configure a token to increase request limits for shared workspaces."
				actions={
					<Button
						trailingIcon={ArrowUpRight}
						size="xs"
						tone="neutral"
						variant="secondary"
						disabled
					>
						Get value
					</Button>
				}
			/>
			<DetailListItem
				title="MCP settings path"
				trailingText={<code>{settingsPath}</code>}
			/>
			<DetailListItem
				title="URL"
				trailingText="https://adobe-creativity.adobe.io/mcp?workspace=shared-workspace"
			/>
		</DetailList>
	),
	decorators: [
		(Story) => (
			<div style={{ width: 280, maxWidth: "100%" }}>
				<Story />
			</div>
		),
	],
};
