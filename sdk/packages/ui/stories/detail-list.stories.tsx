import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowUpRight, Copy } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Badge } from "../components/badge";
import { Button, IconButton } from "../components/button";
import {
	DetailList,
	type DetailListColumn,
	type DetailListProps,
} from "../components/detail-list";
import { DetailListItem } from "../components/detail-list-item";
import { Switch } from "../components/switch";
import { CompactDocsPage } from "./compact-docs-page";

const settingsPath =
	"/Users/example/.cline/data/settings/cline_mcp_settings.json";

const meta = {
	title: "Components/Detail List",
	component: DetailList,
	subcomponents: { DetailListItem },
	tags: ["autodocs"],
	parameters: {
		docs: {
			page: CompactDocsPage,
			description: {
				component:
					"A description list for metadata or aligned columns, with shared borders, separators, and responsive rows.",
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
		<DetailList {...args} aria-label="Server details">
			<DetailListItem title="Type" trailingText="Remote · Streamable HTTP" />
			<DetailListItem title="Authentication" trailingText="API key" />
			<DetailListItem
				title="MCP settings path"
				trailingText={<code>{settingsPath}</code>}
			/>
		</DetailList>
	),
};

function ResizableList({
	children,
	initialWidth,
}: {
	children: ReactNode;
	initialWidth: number;
}) {
	const sliderId = useId();
	const [width, setWidth] = useState(initialWidth);
	return (
		<div className="grid grid-cols-1 gap-4">
			<div className="grid gap-2">
				<label
					className="text-cline-ui-muted-foreground text-cline-ui-xs"
					htmlFor={sliderId}
				>
					List width: {width}px (limited to available space)
				</label>
				<input
					id={sliderId}
					type="range"
					min={280}
					max={1000}
					value={width}
					onChange={(event) => setWidth(event.currentTarget.valueAsNumber)}
					className="w-full"
				/>
			</div>
			<div style={{ width, maxWidth: "100%" }}>{children}</div>
		</div>
	);
}

export const LongContent: Story = {
	parameters: {
		docs: {
			description: {
				story:
					"Adjust the width to inspect long labels and values; rows stack at 30rem or less.",
			},
		},
	},
	render: (args) => (
		<ResizableList initialWidth={840}>
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
					title="Path"
					trailingText="/Users/example/.cline/plugins/_installed/official/agent-browser-b96ba1011a40/package/index.ts"
					actions={<IconButton icon={Copy} aria-label="Copy path" size="xs" />}
				/>
			</DetailList>
		</ResizableList>
	),
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
					"Resize to reveal compact field labels at 48rem; toggle a switch to verify it acts independently of the row button.",
			},
		},
	},
	render: (args) => (
		<ResizableList initialWidth={1000}>
			<WorkspaceList {...args} />
		</ResizableList>
	),
};
