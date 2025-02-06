import type { Meta, StoryObj } from "@storybook/react"

import { Button } from "@/components/ui"

const meta = {
	title: "@shadcn/Button",
	component: Button,
	parameters: { layout: "centered" },
	tags: ["autodocs"],
	argTypes: {
		variant: {
			control: "select",
			options: ["default", "secondary", "outline", "ghost", "link", "destructive"],
			type: "string",
			table: {
				defaultValue: {
					summary: "default",
				},
			},
		},
		size: {
			control: "select",
			options: ["default", "sm", "lg", "icon"],
			type: "string",
			table: {
				defaultValue: {
					summary: "default",
				},
			},
		},
		children: {
			table: {
				disable: true,
			},
		},
		asChild: {
			table: {
				disable: true,
			},
		},
	},
	args: {
		children: "Button",
	},
} satisfies Meta<typeof Button>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
	name: "Button",
}
