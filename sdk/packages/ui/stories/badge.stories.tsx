import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { Badge, type BadgeTone, type BadgeVariant } from "../components/badge";

const TONES: BadgeTone[] = [
	"neutral",
	"accent",
	"success",
	"warning",
	"info",
	"destructive",
];
const VARIANTS: BadgeVariant[] = ["solid", "surface", "outline"];

const meta: Meta<typeof Badge> = {
	title: "Components/Badge",
	component: Badge,
	tags: ["autodocs"],
	args: {
		children: "Required",
	},
	argTypes: {
		size: { control: "inline-radio", options: ["xs", "sm", "md"] },
		tone: { control: "select", options: TONES },
		variant: { control: "inline-radio", options: VARIANTS },
	},
};

export default meta;

type Story = StoryObj<typeof Badge>;

export const Default: Story = {};

export const Customized: Story = {
	args: {
		"aria-label": "Current status",
		children: "In progress",
		className: "uppercase",
	},
};

export const AllVariants: Story = {
	render: () => (
		<div className="grid gap-4 p-6">
			{TONES.map((tone) => (
				<div className="flex items-center gap-2" key={tone}>
					<span className="w-24 text-cline-ui-muted-foreground text-cline-ui-sm">
						{tone}
					</span>
					{VARIANTS.map((variant) => (
						<Badge key={variant} tone={tone} variant={variant}>
							{variant}
						</Badge>
					))}
				</div>
			))}
		</div>
	),
};

export const CustomAccent: Story = {
	render: () => (
		<div
			className="flex gap-2 bg-cline-ui-background p-6"
			style={
				{
					"--primary": "oklch(0.75 0.1 354)",
					"--primary-emphasis": "oklch(0.68 0.12 354)",
					"--primary-foreground": "oklch(0.28 0.08 354)",
				} as CSSProperties
			}
		>
			{VARIANTS.map((variant) => (
				<Badge key={variant} tone="accent" variant={variant}>
					{variant}
				</Badge>
			))}
		</div>
	),
};
