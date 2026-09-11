import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "../components/badge";

const meta: Meta<typeof Badge> = {
	title: "Components/Badge",
	component: Badge,
	tags: ["autodocs"],
	args: {
		children: "Required",
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
