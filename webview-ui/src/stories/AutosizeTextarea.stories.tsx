import type { Meta, StoryObj } from "@storybook/react"
import { AutosizeTextarea } from "@src/components/ui/autosize-textarea"

const meta: Meta<typeof AutosizeTextarea> = {
	title: "Primitives/AutosizeTextarea",
	component: AutosizeTextarea,
	tags: ["autodocs"],
	args: {
		minHeight: 40,
		maxHeight: 400,
		placeholder: "This textarea will expand as you type.",
		className: "p-2",
	},
}

export default meta

type Story = StoryObj<typeof AutosizeTextarea>

export const Default: Story = {
	args: {},
}
