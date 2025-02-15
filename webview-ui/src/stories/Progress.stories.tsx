import type { Meta, StoryObj } from "@storybook/react"

import { Progress } from "@/components/ui"

const meta: Meta<typeof Progress> = {
	title: "Primitives/Progress",
	component: Progress,
	parameters: {
		layout: "centered",
	},
	args: {
		className: "w-[300px]",
	},
	tags: ["autodocs"],
}

export default meta

type Story = StoryObj<typeof Progress>

export const Default: Story = {
	args: {
		value: 50,
	},
}
