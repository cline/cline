import type { Meta, StoryObj } from "@storybook/react"

import { Slider } from "@/components/ui"

const meta: Meta<typeof Slider> = {
	title: "Primitives/Slider",
	component: Slider,
	parameters: {
		layout: "centered",
	},
	args: {
		defaultValue: [50],
		max: 100,
		min: 0,
		step: 1,
		className: "w-[300px]",
	},
	tags: ["autodocs"],
}

export default meta

type Story = StoryObj<typeof Slider>

export const Default: Story = {
	args: {
		defaultValue: [50],
		max: 100,
		min: 0,
		step: 1,
	},
}
