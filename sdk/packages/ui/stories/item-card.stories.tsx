import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	Check,
	CircleAlert,
	FileText,
	Loader2,
	MoreHorizontal,
	TriangleAlert,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Badge } from "../components/badge";
import { Button, IconButton } from "../components/button";
import { ItemCard, type ItemCardProps } from "../components/item-card";
import { Switch } from "../components/switch";
import { CompactDocsPage } from "./compact-docs-page";

const calendarImage = new URL(
	"./assets/item-card/calendar.svg",
	import.meta.url,
).href;
const statuses = {
	success: { icon: Check, label: "Connected" },
	warning: { icon: TriangleAlert, label: "Auth required" },
	error: { icon: CircleAlert, label: "Install failed" },
} as const;

type ItemCardStoryArgs = ItemCardProps & {
	leadingItem: "none" | "image" | "icon";
	trailingItem: "none" | "button" | "switch" | "icon-button" | "status";
	status: keyof typeof statuses;
};

function TrailingItem({
	type,
	status,
}: {
	type: ItemCardStoryArgs["trailingItem"];
	status: ItemCardStoryArgs["status"];
}) {
	const [applied, setApplied] = useState(false);
	switch (type) {
		case "none":
			return null;
		case "button":
			return (
				<Button
					size="xs"
					tone="neutral"
					variant="secondary"
					onClick={() => setApplied((value) => !value)}
				>
					{applied ? "Applied" : "Apply"}
				</Button>
			);
		case "switch":
			return <Switch aria-label="Enable item" />;
		case "icon-button":
			return (
				<IconButton icon={MoreHorizontal} aria-label="Item options" size="xs" />
			);
		case "status": {
			const { icon: Icon, label } = statuses[status];
			return (
				<output>
					<Badge size="xs" tone={status} variant="ghost">
						<Icon aria-hidden="true" />
						{label}
					</Badge>
				</output>
			);
		}
	}
}

function ItemCardExample({
	leadingItem,
	trailingItem,
	status,
	...args
}: ItemCardStoryArgs) {
	return (
		<ItemCard
			{...args}
			icon={
				leadingItem === "image" ? (
					<img src={calendarImage} alt="" width={24} height={24} />
				) : leadingItem === "icon" ? (
					<FileText size={20} />
				) : undefined
			}
			actions={
				args.actions ??
				(trailingItem === "none" ? undefined : (
					<TrailingItem
						key={trailingItem}
						type={trailingItem}
						status={status}
					/>
				))
			}
		/>
	);
}

function LabeledExample({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<figure className="min-w-0 space-y-2">
			<figcaption className="text-cline-ui-muted-foreground text-cline-ui-xs">
				{label}
			</figcaption>
			{children}
		</figure>
	);
}

const meta = {
	title: "Components/Item Card",
	component: ItemCard,
	tags: ["autodocs"],
	parameters: {
		cardWidth: 517,
		docs: {
			page: CompactDocsPage,
			description: {
				component:
					"A card with optional leading content, trailing controls, and metadata. Use the Playground controls to explore combinations and status tones. The primary action covers the card; trailing controls and links act independently.",
			},
		},
	},
	decorators: [
		(Story, context) => (
			<div className="p-6">
				<div
					className="w-full"
					style={{ maxWidth: context.parameters.cardWidth }}
				>
					<Story />
				</div>
			</div>
		),
	],
	render: (args) => <ItemCardExample {...args} />,
	args: {
		title: "Code review",
		description: "Review pull requests for bugs and regressions.",
		leadingItem: "none",
		trailingItem: "none",
		status: "success",
		selected: false,
	},
	argTypes: {
		title: { control: "text" },
		count: { control: "number" },
		description: { control: "text" },
		selected: { control: "boolean" },
		leadingItem: {
			name: "Leading",
			control: "select",
			options: ["none", "image", "icon"],
		},
		trailingItem: {
			name: "Trailing",
			control: "select",
			options: ["none", "button", "switch", "icon-button", "status"],
		},
		status: {
			name: "Status",
			control: "select",
			options: ["success", "warning", "error"],
			if: { arg: "trailingItem", eq: "status" },
		},
		icon: { control: false, table: { disable: true } },
		actions: { control: false, table: { disable: true } },
		badges: { control: false },
		footer: { control: "text" },
		children: { control: false },
		primaryAction: { control: false },
	},
} satisfies Meta<ItemCardStoryArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Compositions: Story = {
	parameters: { controls: { disable: true } },
	render: (args) => (
		<div className="grid gap-4">
			<LabeledExample label="Image + button">
				<ItemCardExample
					{...args}
					title="Calendar"
					description="Create events and keep your schedule up to date."
					leadingItem="image"
					trailingItem="button"
				/>
			</LabeledExample>
			<LabeledExample label="Icon + switch + additional content">
				<ItemCardExample {...args} leadingItem="icon" trailingItem="switch">
					<p className="text-cline-ui-muted-foreground text-cline-ui-xs">
						Only enabled for this workspace.
					</p>
				</ItemCardExample>
			</LabeledExample>
			<LabeledExample label="Metadata + icon button">
				<ItemCardExample
					{...args}
					title="Workspace rules"
					description={undefined}
					count={18}
					trailingItem="icon-button"
					badges={<Badge variant="ghost">Global</Badge>}
					footer="Published by the Cline team"
				/>
			</LabeledExample>
		</div>
	),
};

export const States: Story = {
	parameters: { controls: { disable: true }, cardWidth: 1050 },
	render: (args) => (
		<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-4">
			<LabeledExample label="Selected">
				<ItemCardExample {...args} selected />
			</LabeledExample>
			<LabeledExample label="Action pending">
				<ItemCardExample
					{...args}
					actions={
						<Button
							size="xs"
							tone="neutral"
							variant="secondary"
							disabled
							aria-busy
						>
							<Loader2
								aria-hidden="true"
								className="motion-safe:animate-spin"
							/>
							Applying…
						</Button>
					}
				/>
			</LabeledExample>
			<LabeledExample label="Primary action disabled">
				<ItemCardExample
					{...args}
					description="The primary action is disabled. Its switch still works."
					primaryAction={{ onClick: () => {}, disabled: true }}
					actions={
						<Switch aria-label="Enable item with disabled primary action" />
					}
				/>
			</LabeledExample>
		</div>
	),
};

export const Interaction: Story = {
	parameters: {
		controls: { disable: true },
		docs: {
			description: {
				story:
					"Click the card or focus it with Tab and press Enter or Space. The switch changes independently without activating the card.",
			},
		},
	},
	render: function Interaction(args) {
		const [activations, setActivations] = useState(0);
		const [enabled, setEnabled] = useState(false);
		return (
			<div className="grid gap-3">
				<ItemCardExample
					{...args}
					leadingItem="icon"
					primaryAction={{
						label: "Open Code review",
						onClick: () => setActivations((count) => count + 1),
					}}
					actions={
						<Switch
							aria-label="Enable Code review"
							checked={enabled}
							onCheckedChange={setEnabled}
						/>
					}
				/>
				<output className="text-cline-ui-muted-foreground text-cline-ui-xs">
					Card activations: {activations} · Item:{" "}
					{enabled ? "enabled" : "disabled"}
				</output>
			</div>
		);
	},
};

export const Responsive: Story = {
	parameters: {
		controls: { disable: true },
		cardWidth: 640,
		docs: {
			description: {
				story:
					"Adjust the width to compare truncation and wrapping. Below 320px, the icon and trailing control stack with the content.",
			},
		},
	},
	render: function Responsive(args) {
		const sliderId = useId();
		const [width, setWidth] = useState(517);
		return (
			<div className="grid grid-cols-1 gap-4">
				<div className="grid gap-2">
					<label
						className="text-cline-ui-muted-foreground text-cline-ui-xs"
						htmlFor={sliderId}
					>
						Card width: {width}px (limited to available space)
					</label>
					<input
						id={sliderId}
						type="range"
						min={240}
						max={600}
						value={width}
						onChange={(event) => setWidth(event.currentTarget.valueAsNumber)}
						className="w-full"
					/>
				</div>
				<div style={{ width, maxWidth: "100%" }}>
					<ItemCardExample
						{...args}
						title="Code review guidelines for your entire workspace"
						description="Review pull requests for bugs, regressions, and missing tests before sharing changes with your team."
						count={18}
						leadingItem="icon"
						trailingItem="switch"
						badges={<Badge variant="ghost">Global</Badge>}
						footer="Published by the Cline team"
					/>
				</div>
			</div>
		);
	},
};
