import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowUpRight, Copy, EllipsisVertical } from "lucide-react";
import { useState } from "react";
import { Badge } from "../components/badge";
import { Button, IconButton } from "../components/button";
import {
	DetailList,
	type DetailListColumn,
	type DetailListProps,
} from "../components/detail-list";
import { DetailListItem } from "../components/detail-list-item";
import { Switch } from "../components/switch";

const settingsPath =
	"/Users/example/.cline/data/settings/cline_mcp_settings.json";

const meta = {
	title: "Components/Detail List",
	component: DetailList,
	subcomponents: { DetailListItem },
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"A neutral description list with a shared border and separators. Use the default layout for metadata and configuration requirements, or supply columns and keyed item values for aligned entity lists. Default items stack at container widths of 30rem or less; column lists show field labels beneath each title at 48rem or less. Optional primaryAction supplies a native row button, while actions remain independent. Use the theme toolbar to preview light and dark colors.",
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
	argTypes: {
		children: { control: false },
		columns: { control: false },
		titleLabel: { control: "text" },
		actionsWidth: {
			control: "select",
			options: ["3rem", "4rem", "5rem"],
		},
	},
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
				trailingText="/Users/example/.cline/plugins/_installed/official/agent-browser-b96ba1011a40/package/index.ts"
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

const workspaceColumns = [
	{ key: "owner", label: "Owner", width: "1fr" },
	{ key: "openItems", label: "Open items", width: 75 },
	{ key: "updated", label: "Updated", width: "7rem" },
] satisfies readonly DetailListColumn[];

function WorkspaceList(args: DetailListProps) {
	const [enabled, setEnabled] = useState<Record<string, boolean>>({
		product: true,
		platform: false,
		archive: false,
	});
	const [message, setMessage] = useState(
		"Select a workspace or toggle access.",
	);
	const workspaces = [
		{
			id: "product",
			title: "Product workspace",
			description: "Design, engineering, and release planning for the product.",
			values: { owner: "Product team", openItems: 12, updated: "Today" },
		},
		{
			id: "platform",
			title:
				"Platform infrastructure and developer experience across all environments",
			description:
				"A long description keeps the row readable while its metadata stays aligned with the other workspaces. Open the workspace to inspect the full details.",
			values: { owner: "Platform team", openItems: 0, updated: "Yesterday" },
		},
		{
			id: "archive",
			title: "Archived workspace",
			description: undefined,
			values: { owner: "Operations", openItems: 0 },
		},
	];

	return (
		<div className="grid gap-3">
			<DetailList
				columns={workspaceColumns}
				titleLabel="Workspace"
				actionsWidth="4rem"
				{...args}
				aria-label="Workspaces"
			>
				{workspaces.map((workspace) => (
					<DetailListItem
						key={workspace.id}
						title={workspace.title}
						description={workspace.description}
						values={workspace.values}
						primaryAction={{
							label: `Open ${workspace.title}`,
							onClick: () => setMessage(`Opened ${workspace.title}.`),
						}}
						actions={
							<Switch
								aria-label={`Enable ${workspace.title}`}
								checked={enabled[workspace.id]}
								onCheckedChange={(checked) => {
									setEnabled((previous) => ({
										...previous,
										[workspace.id]: checked,
									}));
									setMessage(
										`${checked ? "Enabled" : "Disabled"} ${workspace.title}; the row action did not run.`,
									);
								}}
							/>
						}
					/>
				))}
			</DetailList>
			<output className="text-cline-ui-muted-foreground text-cline-ui-xs">
				{message}
			</output>
		</div>
	);
}

export const Columns: Story = {
	parameters: {
		docs: {
			description: {
				story:
					"The list owns column order, widths, headers, and compact field labels. This example combines proportional fr sizing, numeric pixel sizing, and a fixed rem width. Rows provide keyed values and an optional primary action. Zero and omitted values preserve alignment. Toggle a switch to verify it acts independently of the row button.",
			},
		},
	},
	render: (args) => <WorkspaceList {...args} />,
};

export const NarrowColumns: Story = {
	...Columns,
	decorators: [
		(Story) => (
			<div style={{ width: 360, maxWidth: "100%" }}>
				<Story />
			</div>
		),
	],
};
