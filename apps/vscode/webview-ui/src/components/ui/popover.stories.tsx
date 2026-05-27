import type { Meta } from "@storybook/react-vite"
import { Button } from "./button"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

const meta: Meta<typeof Popover> = {
	title: "Ui/Popover",
	component: Popover,
	parameters: {
		docs: {
			description: {
				component:
					"Displays rich content in a floating panel when clicking a trigger element. Built on Radix UI with customizable alignment, side positioning, and an arrow indicator.",
			},
		},
	},
}

export default meta

export const Default = () => (
	<div className="w-screen flex justify-center items-center min-h-[400px]">
		<div className="flex flex-col gap-8 w-full max-w-md px-4">
			<Popover>
				<PopoverTrigger asChild>
					<Button variant="cline">Open Popover</Button>
				</PopoverTrigger>
				<PopoverContent>
					<div className="space-y-2">
						<h4 className="font-medium leading-none">Popover Title</h4>
						<p className="text-sm text-muted-foreground">
							This is the content inside the popover. It can contain any React components.
						</p>
					</div>
				</PopoverContent>
			</Popover>

			<div className="flex gap-4 justify-center">
				<Popover>
					<PopoverTrigger asChild>
						<Button variant="secondary">Left Align</Button>
					</PopoverTrigger>
					<PopoverContent align="start">
						<div className="space-y-2">
							<p className="text-sm">This popover is aligned to the start of the trigger.</p>
						</div>
					</PopoverContent>
				</Popover>

				<Popover>
					<PopoverTrigger asChild>
						<Button variant="secondary">Right Align</Button>
					</PopoverTrigger>
					<PopoverContent align="end">
						<div className="space-y-2">
							<p className="text-sm">This popover is aligned to the end of the trigger.</p>
						</div>
					</PopoverContent>
				</Popover>
			</div>

			<Popover>
				<PopoverTrigger asChild>
					<Button variant="default">With Actions</Button>
				</PopoverTrigger>
				<PopoverContent>
					<div className="space-y-4">
						<div className="space-y-2">
							<h4 className="font-medium leading-none">Confirm Action</h4>
							<p className="text-sm text-muted-foreground">Are you sure you want to proceed?</p>
						</div>
						<div className="flex gap-2 justify-end">
							<Button size="sm" variant="outline">
								Cancel
							</Button>
							<Button size="sm" variant="default">
								Confirm
							</Button>
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	</div>
)
