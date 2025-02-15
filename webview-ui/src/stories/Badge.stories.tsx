import type { Meta, StoryObj } from "@storybook/react"

import { Badge } from "@/components/ui"

const meta: Meta<typeof Badge> = {
	title: "Primitives/Badge",
	component: Badge,
	tags: ["autodocs"],
	args: {
		children: "Badge",
	},
}

export default meta

type Story = StoryObj<typeof Badge>

export const Default: Story = {
	args: {
		children: "Default",
	},
}

export const Secondary: Story = {
	args: {
		variant: "secondary",
		children: "Secondary",
	},
}

export const Destructive: Story = {
	args: {
		variant: "destructive",
		children: "Destructive",
	},
}

export const Outline: Story = {
	args: {
		variant: "outline",
		children: "Outline",
	},
}
