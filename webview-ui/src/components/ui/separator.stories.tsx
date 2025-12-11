import type { Meta } from "@storybook/react-vite"
import { Separator } from "./separator"

const meta: Meta<typeof Separator> = {
	title: "Ui/Separator",
	component: Separator,
	parameters: {
		docs: {
			description: {
				component:
					"Visually separates content with a horizontal or vertical line. Built on Radix UI and supports both orientations for flexible layout separation.",
			},
		},
	},
}

export default meta

export const Default = () => (
	<div className="w-screen flex justify-center items-center">
		<div className="flex flex-col gap-8 w-full max-w-md px-4">
			<div className="space-y-4">
				<h4 className="text-sm font-medium">Horizontal Separator</h4>
				<div className="space-y-1">
					<p className="text-sm">Content above the separator</p>
				</div>
				<Separator orientation="horizontal" />
				<div className="space-y-1">
					<p className="text-sm">Content below the separator</p>
				</div>
			</div>

			<div className="space-y-4">
				<h4 className="text-sm font-medium">Vertical Separator</h4>
				<div className="flex h-20 items-center space-x-4">
					<div className="text-sm">Left content</div>
					<Separator orientation="vertical" />
					<div className="text-sm">Middle content</div>
					<Separator orientation="vertical" />
					<div className="text-sm">Right content</div>
				</div>
			</div>

			<div className="space-y-4">
				<h4 className="text-sm font-medium">In a Menu Layout</h4>
				<div className="space-y-2">
					<div className="text-sm p-2 hover:bg-accent rounded-sm cursor-pointer">Menu Item 1</div>
					<div className="text-sm p-2 hover:bg-accent rounded-sm cursor-pointer">Menu Item 2</div>
					<Separator />
					<div className="text-sm p-2 hover:bg-accent rounded-sm cursor-pointer">Menu Item 3</div>
					<div className="text-sm p-2 hover:bg-accent rounded-sm cursor-pointer">Menu Item 4</div>
				</div>
			</div>
		</div>
	</div>
)
