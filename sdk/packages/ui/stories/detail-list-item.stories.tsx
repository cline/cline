import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	ArrowUpRight,
	Clock3,
	EllipsisVertical,
	Folder,
	Settings2,
} from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "../components/badge";
import { Button, IconButton } from "../components/button";
import { DetailList } from "../components/detail-list";
import { DetailListItem } from "../components/detail-list-item";
import { CompactDocsPage } from "./compact-docs-page";

const settingsPath =
	"/Users/example/.cline/data/settings/cline_mcp_settings.json";

const meta = {
	title: "Components/Detail List Item",
	component: DetailListItem,
	tags: ["autodocs"],
	parameters: {
		docs: {
			page: CompactDocsPage,
			description: {
				component:
					"A row with optional icon, count, description, value, and actions. Render within DetailList for borders, separators, and responsive layout.",
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
			control: "select",
			options: ["None", "Clock", "Folder"],
			mapping: { None: undefined, Clock: Clock3, Folder },
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

export const Playground: Story = {};

export const Actions: Story = {
	parameters: { controls: { disable: true } },
	render: function Actions() {
		const [message, setMessage] = useState("");
		return (
			<div className="grid gap-3">
				<DetailList>
					<DetailListItem
						title={
							<>
								<code>CONTEXT7_API_KEY</code>
								<Badge size="xs">Optional</Badge>
							</>
						}
						description="Optional API key for higher rate limits."
						actions={
							<Button
								trailingIcon={ArrowUpRight}
								size="xs"
								tone="neutral"
								variant="secondary"
								onClick={() => setMessage("Get value selected.")}
							>
								Get value
							</Button>
						}
					/>
					<DetailListItem
						title="MCP settings path"
						description="Local configuration for your MCP servers."
						trailingText={<code>{settingsPath}</code>}
						actions={
							<IconButton
								icon={EllipsisVertical}
								aria-label="MCP settings path actions"
								size="xs"
								onClick={() => setMessage("Settings path actions selected.")}
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

export const Responsive: Story = {
	parameters: {
		controls: { disable: true },
		docs: {
			description: {
				story:
					"Resize to inspect button wrapping and wide controls, which stack when the icon and text have less than 18rem of space.",
			},
		},
	},
	render: function Responsive() {
		const sliderId = useId();
		const folderId = useId();
		const [width, setWidth] = useState(760);
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
				<div style={{ width, maxWidth: "100%" }}>
					<DetailList>
						<DetailListItem
							title="Configuration"
							leadingIcon={Settings2}
							description="Multiple actions wrap within the row."
							trailingText="Local"
							actions={
								<>
									<Button size="sm" variant="secondary" tone="neutral">
										Open configuration
									</Button>
									<Button size="sm" variant="secondary" tone="neutral">
										Reset connection
									</Button>
								</>
							}
						/>
						<DetailListItem
							title={<label htmlFor={folderId}>Project folder</label>}
							leadingIcon={Folder}
							description="Runs in this folder and uses its project settings."
							actions={
								<div className="flex w-96 max-w-full min-w-0 items-center gap-2">
									<input
										id={folderId}
										className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5"
										defaultValue="/Users/example/Documents/GitHub/cline"
									/>
									<Button size="sm" variant="secondary" tone="neutral">
										Browse…
									</Button>
								</div>
							}
						/>
					</DetailList>
				</div>
			</div>
		);
	},
};
