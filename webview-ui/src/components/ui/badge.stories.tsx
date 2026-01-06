import type { Meta } from "@storybook/react-vite"
import { ClockIcon, XIcon } from "lucide-react"
import { Badge } from "./badge"

const meta: Meta<typeof Badge> = {
	title: "Ui/Badge",
	component: Badge,
	parameters: {
		docs: {
			description: {
				component:
					"Displays a badge with different variants (default, info, danger, outline, brand, neutral, gray, success, warning) and types (default, round, icon). Used to highlight status, categories, or counts.",
			},
		},
	},
}

export default meta

export const Default = () => {
	const variants = ["default", "info", "danger", "outline", "cline", "success", "warning"] as const

	const types = [
		{ value: "default", label: "Default" },
		{ value: "icon", label: "With Icon" },
		{ value: "round", label: "Icon Only" },
	] as const

	return (
		<div className="w-screen flex justify-center p-8">
			<div className="flex flex-col gap-8 w-full max-w-4xl">
				{types.map((type) => (
					<div className="flex flex-col gap-4" key={type.value}>
						<h2 className="text-lg font-semibold">{type.label}</h2>
						<div className="flex flex-wrap gap-3 items-center">
							{variants.map((variant) => (
								<Badge key={variant} type={type.value} variant={variant}>
									{type.value === "icon" && <ClockIcon />}
									{type.value === "round" ? <ClockIcon /> : variant.charAt(0).toUpperCase() + variant.slice(1)}
								</Badge>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	)
}

export const Dismissible = () => {
	const variants = ["cline", "danger", "success", "warning"] as const

	return (
		<div className="w-screen flex justify-center p-8">
			<div className="flex flex-wrap gap-3">
				{variants.map((variant) => (
					<Badge className="gap-1 pe-0.5 ps-1.5" key={variant} type="icon" variant={variant}>
						<span>{variant.charAt(0).toUpperCase() + variant.slice(1)}</span>
						<button
							aria-label="Remove"
							className="inline-flex items-center p-0.5 text-sm bg-transparent rounded-xs hover:opacity-80"
							type="button">
							<XIcon className="w-3 h-3" />
							<span className="sr-only">Remove badge</span>
						</button>
					</Badge>
				))}
			</div>
		</div>
	)
}
