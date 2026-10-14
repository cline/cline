import type { Meta, StoryObj } from "@storybook/react-vite"
import { createStorybookDecorator } from "@/config/StorybookDecorator"
import ContextWindow from "./ContextWindow"

const meta: Meta<typeof ContextWindow> = {
	title: "Views/Components/ContextWindow",
	component: ContextWindow,
	parameters: {
		layout: "padded",
		docs: {
			description: {
				component:
					"ContextWindow shows token usage against the model's context window and hosts the compact-task button with its inline confirmation card. The decorator mimics the expanded TaskHeader card so spacing and contrast are representative.",
			},
		},
	},
	decorators: [
		createStorybookDecorator(
			undefined,
			// Mirror TaskHeader's expanded card surface so the compact
			// confirmation is previewed against its real background.
			"rounded-sm border-1 pt-2 pb-2 px-2 bg-(--vscode-toolbar-hoverBackground)/65",
		),
	],
	argTypes: {
		contextWindow: { control: "number", description: "Model context window size" },
		lastApiReqTotalTokens: { control: "number", description: "Tokens used by the last request" },
	},
}

export default meta
type Story = StoryObj<typeof ContextWindow>

export const HighUsage: Story = {
	args: {
		contextWindow: 200_000,
		lastApiReqTotalTokens: 146_000,
		tokensIn: 45_000,
		tokensOut: 28_000,
		cacheWrites: 5_200,
		cacheReads: 3_800,
		useAutoCondense: false,
	},
	parameters: {
		docs: {
			description: {
				story: "High context usage. Click the fold icon to open the compact-task confirmation card.",
			},
		},
	},
}
