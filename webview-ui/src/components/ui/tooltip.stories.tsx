import type { Meta } from "@storybook/react-vite"
import { InfoIcon } from "lucide-react"
import { Button } from "./button"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"

const meta: Meta<typeof Tooltip> = {
	title: "Ui/Tooltip",
	component: Tooltip,
	parameters: {
		docs: {
			description: {
				component:
					"Displays helpful text when hovering over an element. Built on Radix UI with customizable positioning, optional arrow indicator, and smooth animations.",
			},
		},
	},
}

export default meta

export const Default = () => (
	<div className="w-screen flex justify-center items-center min-h-[400px]">
		<div className="flex flex-col gap-8 w-full max-w-md px-4 items-center">
			<Tooltip>
				<TooltipTrigger asChild>
					<Button>Hover for tooltip</Button>
				</TooltipTrigger>
				<TooltipContent>
					<p>This is a helpful tooltip</p>
				</TooltipContent>
			</Tooltip>

			<div className="flex gap-4">
				<Tooltip>
					<TooltipTrigger asChild>
						<Button variant="secondary">Top</Button>
					</TooltipTrigger>
					<TooltipContent side="top">
						<p>Tooltip on top</p>
					</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger asChild>
						<Button variant="secondary">Bottom</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						<p>Tooltip on bottom</p>
					</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger asChild>
						<Button variant="secondary">Left</Button>
					</TooltipTrigger>
					<TooltipContent side="left">
						<p>Tooltip on left</p>
					</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger asChild>
						<Button variant="secondary">Right</Button>
					</TooltipTrigger>
					<TooltipContent side="right">
						<p>Tooltip on right</p>
					</TooltipContent>
				</Tooltip>
			</div>

			<Tooltip>
				<TooltipTrigger asChild>
					<Button size="icon" variant="icon">
						<InfoIcon />
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					<p>Click for more information</p>
				</TooltipContent>
			</Tooltip>

			<Tooltip>
				<TooltipTrigger asChild>
					<Button>No arrow</Button>
				</TooltipTrigger>
				<TooltipContent showArrow={false}>
					<p>This tooltip has no arrow</p>
				</TooltipContent>
			</Tooltip>

			<Tooltip>
				<TooltipTrigger asChild>
					<span className="text-sm underline cursor-help">Hover me</span>
				</TooltipTrigger>
				<TooltipContent>
					<p>Tooltips can wrap any element, not just buttons</p>
				</TooltipContent>
			</Tooltip>
		</div>
	</div>
)
