import type { Meta } from "@storybook/react-vite"
import { Slider } from "./slider"

const meta: Meta<typeof Slider> = {
	title: "Ui/Slider",
	component: Slider,
	parameters: {
		docs: {
			description: {
				component:
					"An interactive slider control for selecting a value from a range. Built on Radix UI with a draggable thumb and visual track indicator. Supports accessibility features like keyboard navigation.",
			},
		},
	},
}

export default meta

export const Default = () => (
	<div className="w-screen flex justify-center items-center">
		<div className="flex flex-col gap-6 w-full max-w-md px-4">
			<div className="space-y-2">
				<div className="text-sm text-muted-foreground">Default (0-100)</div>
				<Slider defaultValue={[50]} max={100} step={1} />
			</div>
			<div className="space-y-2">
				<div className="text-sm text-muted-foreground">At minimum (0)</div>
				<Slider defaultValue={[0]} max={100} step={1} />
			</div>
			<div className="space-y-2">
				<div className="text-sm text-muted-foreground">At maximum (100)</div>
				<Slider defaultValue={[100]} max={100} step={1} />
			</div>
			<div className="space-y-2">
				<div className="text-sm text-muted-foreground">Custom range (0-10, step 0.5)</div>
				<Slider defaultValue={[5]} max={10} step={0.5} />
			</div>
			<div className="space-y-2">
				<div className="text-sm text-muted-foreground">Disabled state</div>
				<Slider defaultValue={[50]} disabled max={100} step={1} />
			</div>
		</div>
	</div>
)
