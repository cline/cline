import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	Check,
	CircleAlert,
	FileText,
	Loader2,
	MoreHorizontal,
	TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "../components/badge";
import { Button, IconButton } from "../components/button";
import { Dialog } from "../components/dialog";
import { ItemCard, type ItemCardProps } from "../components/item-card";
import { Switch } from "../components/switch";

const calendarImage = new URL(
	"./assets/item-card/calendar.svg",
	import.meta.url,
).href;

function SampleImage() {
	return <img src={calendarImage} alt="" width={24} height={24} />;
}

type ItemCardStoryArgs = ItemCardProps & {
	showLeadingItem: boolean;
	leadingItemType: "image" | "icon";
	showTrailingItem: boolean;
	trailingItemType: "button" | "switch" | "icon-button" | "status";
};

function TrailingItem({
	type,
}: {
	type: ItemCardStoryArgs["trailingItemType"];
}) {
	const [applied, setApplied] = useState(false);
	switch (type) {
		case "button":
			return (
				<Button
					size="xs"
					tone="neutral"
					variant="secondary"
					onClick={() => setApplied(!applied)}
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
		case "status":
			return (
				<Badge size="xs" tone="success" variant="ghost">
					<Check aria-hidden="true" />
					Active
				</Badge>
			);
	}
}

function ItemCardExample({
	showLeadingItem,
	leadingItemType,
	showTrailingItem,
	trailingItemType,
	...args
}: ItemCardStoryArgs) {
	return (
		<ItemCard
			{...args}
			icon={
				showLeadingItem ? (
					leadingItemType === "image" ? (
						<SampleImage />
					) : (
						<FileText size={20} />
					)
				) : undefined
			}
			actions={
				showTrailingItem
					? (args.actions ?? (
							<TrailingItem key={trailingItemType} type={trailingItemType} />
						))
					: undefined
			}
		/>
	);
}

const meta = {
	title: "Components/Item Card",
	component: ItemCard,
	tags: ["autodocs"],
	parameters: {
		cardWidth: 517,
		docs: {
			description: {
				component:
					'A general-purpose card with optional leading and trailing items. Enable a leading image or icon and a trailing button, switch, icon button, status, or custom content independently. Both are off by default. Use Button directly for trailing actions, with size, tone, and variant set by the consumer. Use Badge with variant="ghost" for trailing statuses and secondary metadata. The optional primary action covers the whole card, including padding and passive metadata; controls and links remain independent.',
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
		title: "Item title",
		description:
			"A short description with the context needed to understand this item.",
		showLeadingItem: false,
		leadingItemType: "image",
		showTrailingItem: false,
		trailingItemType: "button",
	},
	argTypes: {
		title: { control: "text" },
		count: { control: "number" },
		description: { control: "text" },
		showLeadingItem: { name: "Leading item", control: "boolean" },
		leadingItemType: {
			name: "Leading item type",
			control: "select",
			options: ["image", "icon"],
			if: { arg: "showLeadingItem" },
		},
		showTrailingItem: { name: "Trailing item", control: "boolean" },
		trailingItemType: {
			name: "Trailing item type",
			control: "select",
			options: ["button", "switch", "icon-button", "status"],
			if: { arg: "showTrailingItem" },
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

export const Default: Story = {};
export const WithCount: Story = { args: { title: "Teams", count: 18 } };
export const LeadingImage: Story = {
	args: { showLeadingItem: true, leadingItemType: "image" },
};
export const LeadingIcon: Story = {
	args: { showLeadingItem: true, leadingItemType: "icon" },
};
export const TrailingButton: Story = {
	args: { showTrailingItem: true, trailingItemType: "button" },
};
export const TrailingSwitch: Story = {
	args: { showTrailingItem: true, trailingItemType: "switch" },
};
export const TrailingIconButton: Story = {
	args: { showTrailingItem: true, trailingItemType: "icon-button" },
};
export const CompactActions: Story = {
	parameters: { cardWidth: 320 },
	args: {
		title: "Code review",
		description: "Review pull requests for bugs and regressions.",
		showLeadingItem: true,
		leadingItemType: "icon",
		showTrailingItem: true,
		trailingItemType: "button",
	},
};
const statuses = {
	connected: { icon: Check, tone: "success", label: "Connected" },
	installed: { icon: Check, tone: "success", label: "Installed" },
	"auth-required": {
		icon: TriangleAlert,
		tone: "warning",
		label: "Auth required",
	},
	failed: { icon: CircleAlert, tone: "error", label: "Install failed" },
} as const;

function StatusBadge({ status }: { status: keyof typeof statuses }) {
	const { icon: Icon, tone, label } = statuses[status];
	return (
		<output>
			<Badge size="xs" tone={tone} variant="ghost">
				<Icon aria-hidden="true" />
				{label}
			</Badge>
		</output>
	);
}

export const TrailingStatus: Story = {
	args: {
		showTrailingItem: true,
		trailingItemType: "status",
		actions: <StatusBadge status="connected" />,
	},
	argTypes: { trailingItemType: { control: false } },
};
export const WarningStatus: Story = {
	...TrailingStatus,
	args: {
		...TrailingStatus.args,
		actions: <StatusBadge status="auth-required" />,
	},
};
export const ErrorStatus: Story = {
	...TrailingStatus,
	args: { ...TrailingStatus.args, actions: <StatusBadge status="failed" /> },
};
export const StatusInteraction: Story = {
	...TrailingStatus,
	args: { ...TrailingStatus.args, title: "Code review" },
	render: function StatusInteraction(args) {
		const [open, setOpen] = useState(false);
		const [failed, setFailed] = useState(true);
		return (
			<>
				<ItemCardExample
					{...args}
					primaryAction={{
						label: "Open item details",
						onClick: () => setOpen(true),
					}}
					actions={<StatusBadge status={failed ? "failed" : "installed"} />}
				/>
				<Dialog
					open={open}
					onOpenChange={setOpen}
					title={args.title}
					description={args.description}
					size="sm"
					footer={
						failed ? (
							<Button
								onClick={() => {
									setFailed(false);
									setOpen(false);
								}}
							>
								Retry installation
							</Button>
						) : undefined
					}
				>
					<p>
						{failed
							? "The download timed out. Retry to update the card status."
							: "Installation is complete."}
					</p>
				</Dialog>
			</>
		);
	},
};
export const Selected: Story = { args: { selected: true } };
export const EmptyDescription: Story = { args: { description: "" } };
export const WithFooter: Story = {
	args: { showLeadingItem: true, footer: "Published by the Cline team" },
};
export const WithAdditionalContent: Story = {
	args: {
		children: (
			<p className="text-cline-ui-error-text text-cline-ui-sm">
				This item needs to be configured before use.
			</p>
		),
	},
};

export const Variants: Story = {
	parameters: { controls: { disable: true }, cardWidth: 1050 },
	render: (args) => (
		<div className="grid gap-4 md:grid-cols-2">
			<ItemCardExample
				{...args}
				showLeadingItem
				leadingItemType="image"
				showTrailingItem
				trailingItemType="button"
			/>
			<ItemCardExample
				{...args}
				showLeadingItem
				leadingItemType="icon"
				showTrailingItem
				trailingItemType="button"
			/>
			<ItemCardExample
				{...args}
				showLeadingItem
				leadingItemType="image"
				showTrailingItem
				trailingItemType="status"
			/>
			<ItemCardExample
				{...args}
				showLeadingItem
				leadingItemType="icon"
				showTrailingItem
				trailingItemType="switch"
			/>
		</div>
	),
};
export const IndependentActions: Story = {
	argTypes: { selected: { control: false } },
	args: {
		showTrailingItem: true,
		trailingItemType: "switch",
	},
	render: function IndependentActions(args) {
		const [selected, setSelected] = useState(false);
		const [enabled, setEnabled] = useState(false);
		return (
			<div className="grid gap-4">
				<ItemCardExample
					{...args}
					selected={selected}
					primaryAction={{
						onClick: () => setSelected(!selected),
						label: "View item details",
					}}
					actions={
						args.trailingItemType === "switch" ? (
							<Switch
								aria-label="Enable item"
								checked={enabled}
								onCheckedChange={setEnabled}
							/>
						) : undefined
					}
				/>
				<output className="text-cline-ui-xs">
					Details: {selected ? "open" : "closed"}
					{args.showTrailingItem && args.trailingItemType === "switch"
						? `; item: ${enabled ? "enabled" : "disabled"}`
						: ""}
				</output>
			</div>
		);
	},
};

export const PendingAndDisabled: Story = {
	args: { showTrailingItem: true, trailingItemType: "button" },
	render: (args) => (
		<div className="grid gap-4">
			<ItemCardExample
				{...args}
				actions={
					args.trailingItemType === "button" ? (
						<Button size="xs" tone="neutral" variant="secondary" disabled>
							<Loader2
								aria-hidden="true"
								className="motion-safe:animate-spin"
							/>
							Applying…
						</Button>
					) : undefined
				}
			/>
			<ItemCardExample
				{...args}
				primaryAction={{ onClick: () => {}, disabled: true }}
			/>
		</div>
	),
};
export const LongContentAndNarrow: Story = {
	args: {
		title: "A very long item title that needs to truncate",
		count: 18,
		showLeadingItem: true,
		leadingItemType: "icon",
		showTrailingItem: true,
		trailingItemType: "switch",
	},
	render: (args) => (
		<div className="w-full max-w-72">
			<ItemCardExample
				{...args}
				badges={
					<>
						<Badge variant="ghost">Global</Badge>
						<Badge variant="ghost">Shared</Badge>
					</>
				}
			/>
		</div>
	),
};
