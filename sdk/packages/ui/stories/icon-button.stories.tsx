import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plus, Trash2, X } from "lucide-react";
import { fn } from "storybook/test";
import { IconButton } from "../components/button";

const meta: Meta<typeof IconButton> = {
	title: "Components/Icon Button",
	component: IconButton,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"A square action button with a required accessible label. Supply an SVG component through the optional icon prop or render existing icon children. It shares Button’s variants, tones, sizes, and press feedback, and defaults to ghost/neutral/sm. The Button stories include visual matrices comparing both components.",
			},
		},
	},
	decorators: [
		(Story) => (
			<div className="p-8">
				<Story />
			</div>
		),
	],
	argTypes: {
		icon: {
			control: "select",
			options: ["Plus", "Trash", "Close"],
			mapping: { Plus, Trash: Trash2, Close: X },
		},
		variant: { control: "select", options: ["primary", "secondary", "ghost"] },
		tone: { control: "select", options: ["accent", "neutral", "destructive"] },
		size: { control: "select", options: ["xs", "sm", "md", "lg"] },
		pressScale: { control: "select", options: [0.98, 0.95, false] },
		asChild: { control: false },
		children: { control: false },
		onClick: { control: false },
	},
	args: {
		"aria-label": "Add item",
		icon: Plus,
		variant: "ghost",
		tone: "neutral",
		size: "sm",
		disabled: false,
		pressScale: 0.98,
		onClick: fn(),
	},
};

export default meta;
type Story = StoryObj<typeof IconButton>;

export const Playground: Story = {};
