import type { Meta } from "@storybook/react-vite"
import { Button } from "./button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card"

const meta: Meta<typeof HoverCard> = {
	title: "Ui/HoverCard",
	component: HoverCard,
	parameters: {
		docs: {
			description: {
				component:
					"Displays additional content in a floating card when hovering over a trigger element. Built on Radix UI with customizable alignment and side offset.",
			},
		},
	},
}

export default meta

export const Default = () => (
	<div className="w-screen flex justify-center items-center min-h-[400px]">
		<div className="flex flex-col gap-8 w-full max-w-md px-4">
			<HoverCard>
				<HoverCardTrigger asChild>
					<Button>Hover over me</Button>
				</HoverCardTrigger>
				<HoverCardContent>
					<div className="space-y-2">
						<h4 className="text-sm font-semibold">Hover Card Title</h4>
						<p className="text-sm">This is the content that appears when you hover over the trigger element.</p>
					</div>
				</HoverCardContent>
			</HoverCard>

			<HoverCard>
				<HoverCardTrigger asChild>
					<span className="text-sm underline cursor-pointer">Hover for more info</span>
				</HoverCardTrigger>
				<HoverCardContent align="start">
					<div className="space-y-2">
						<h4 className="text-sm font-semibold">Additional Information</h4>
						<p className="text-sm">
							Hover cards can contain any content including text, images, or other components.
						</p>
					</div>
				</HoverCardContent>
			</HoverCard>
		</div>
	</div>
)
