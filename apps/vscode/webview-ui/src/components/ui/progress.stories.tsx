import type { Meta } from "@storybook/react-vite"
import { Progress } from "./progress"

const meta: Meta<typeof Progress> = {
	title: "Ui/Progress",
	component: Progress,
	parameters: {
		docs: {
			description: {
				component:
					"Displays a horizontal progress bar with a smooth animated indicator. Built on Radix UI and accepts a value between 0-100 to show completion percentage.",
			},
		},
	},
}

export default meta

export const Default = () => (
	<div className="w-screen flex justify-center items-center">
		<div className="flex flex-col gap-6 w-full max-w-md px-4">
			<div className="space-y-2">
				<div className="text-sm text-muted-foreground">0% Complete</div>
				<Progress value={0} />
			</div>
			<div className="space-y-2">
				<div className="text-sm text-muted-foreground">25% Complete</div>
				<Progress value={25} />
			</div>
			<div className="space-y-2">
				<div className="text-sm text-muted-foreground">50% Complete</div>
				<Progress value={50} />
			</div>
			<div className="space-y-2">
				<div className="text-sm text-muted-foreground">75% Complete</div>
				<Progress value={75} />
			</div>
			<div className="space-y-2">
				<div className="text-sm text-muted-foreground">100% Complete</div>
				<Progress value={100} />
			</div>
		</div>
	</div>
)
