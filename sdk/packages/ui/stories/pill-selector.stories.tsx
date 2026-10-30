import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { useArgs } from "storybook/preview-api";
import { Badge } from "../components/badge";
import {
	PillSelector,
	PillSelectorItem,
	type PillSelectorProps,
} from "../components/pill-selector";

const FIGMA_CATEGORIES = [
	["all", "All"],
	["connectors", "Connectors"],
	["skills", "Skills"],
	["mcp", "MCP Servers"],
	["plugins", "Plugins"],
] as const;

const MANAGE_CATEGORIES = [
	["connectors", "Connectors", 2],
	["tools", "Tools", 12],
	["plugins", "Plugins", 1],
	["skills", "Skills", 4],
	["rules", "Rules", 3],
	["mcp", "MCP", 2],
	["hooks", "Hooks", 0],
] as const;

function CategoryItems() {
	return FIGMA_CATEGORIES.map(([value, label]) => (
		<PillSelectorItem key={value} value={value}>
			{label}
		</PillSelectorItem>
	));
}

function InventoryItems() {
	return MANAGE_CATEGORIES.map(([value, label, count]) => (
		<PillSelectorItem key={value} value={value}>
			{label}
			<span className="text-cline-ui-xs tabular-nums">{count}</span>
			{value === "connectors" ? <Badge tone="info">Beta</Badge> : null}
		</PillSelectorItem>
	));
}

const meta: Meta<typeof PillSelector> = {
	title: "Components/Pill Selector",
	component: PillSelector,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"A horizontal, single-selection category control. Arrow keys move focus; Space or Enter selects the focused item. Selecting the current item emits an empty value. Hosts can map that value to All or ignore it to require a selection. Give the group an accessible name.",
			},
		},
	},
	decorators: [
		(Story) => (
			<div className="min-w-0 p-6">
				<Story />
			</div>
		),
	],
	args: {
		"aria-label": "Categories",
		children: <CategoryItems />,
		defaultValue: "all",
	},
	argTypes: {
		children: { control: false },
		onValueChange: { action: "selection changed" },
	},
};

export default meta;
type Story = StoryObj<typeof PillSelector>;

export const Default: Story = {};

export const CountsAndBadges: Story = {
	args: {
		"aria-label": "Installed categories",
		children: <InventoryItems />,
		defaultValue: "connectors",
	},
};

export const Controlled: Story = {
	args: { defaultValue: undefined, value: "skills" },
	parameters: {
		docs: {
			description: {
				story:
					"Browse-style filtering: selecting the current category returns to All. The selected value stays synchronized with the Storybook controls.",
			},
		},
	},
	render: function Controlled(args) {
		const [{ value }, updateArgs] = useArgs<PillSelectorProps>();
		return (
			<div className="grid min-w-0 gap-4">
				<PillSelector
					{...args}
					onValueChange={(nextValue) => {
						updateArgs({ value: nextValue || "all" });
						args.onValueChange?.(nextValue);
					}}
					value={value}
				/>
				<output className="text-cline-ui-muted-foreground text-cline-ui-sm">
					Selected category: {value}
				</output>
			</div>
		);
	},
};

export const RequiredSelection: Story = {
	args: {
		"aria-label": "Installed categories",
		children: <InventoryItems />,
		defaultValue: undefined,
	},
	parameters: {
		docs: {
			description: {
				story:
					"Required-selection usage: the host ignores an empty value so selecting the current category leaves it selected.",
			},
		},
	},
	render: function RequiredSelection(args) {
		const [value, setValue] = useState("connectors");
		return (
			<PillSelector
				{...args}
				onValueChange={(nextValue) => {
					if (nextValue) setValue(nextValue);
					args.onValueChange?.(nextValue);
				}}
				value={value}
			/>
		);
	},
};

export const Disabled: Story = {
	render: (args) => (
		<div className="grid min-w-0 gap-6">
			<PillSelector {...args} aria-label="Disabled categories" disabled />
			<PillSelector {...args} aria-label="Categories with Plugins unavailable">
				{FIGMA_CATEGORIES.map(([value, label]) => (
					<PillSelectorItem
						disabled={value === "plugins"}
						key={value}
						value={value}
					>
						{label}
					</PillSelectorItem>
				))}
			</PillSelector>
		</div>
	),
};

export const Narrow: Story = {
	render: (args) => (
		<div className="w-full max-w-72">
			<PillSelector {...args} className="w-full" />
		</div>
	),
};
