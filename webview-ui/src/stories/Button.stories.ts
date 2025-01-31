import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "@storybook/test"

import { Button } from "@/components/ui/button"

const meta = {
	title: "Example/Button",
	component: Button,
	parameters: { layout: "centered" },
	tags: ["autodocs"],
	argTypes: {},
	args: { onClick: fn(), children: "Button" },
} satisfies Meta<typeof Button>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		variant: "default",
	},
}

export const Secondary: Story = {
	args: {
		variant: "secondary",
	},
}

export const Outline: Story = {
	args: {
		variant: "outline",
	},
}

export const Ghost: Story = {
	args: {
		variant: "ghost",
	},
}

export const Link: Story = {
	args: {
		variant: "link",
	},
}

export const Destructive: Story = {
	args: {
		variant: "destructive",
	},
}
