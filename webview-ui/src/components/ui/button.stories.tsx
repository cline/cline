import type { Meta } from "@storybook/react-vite"
import { SearchIcon } from "lucide-react"
import { Button } from "./button"

const meta: Meta<typeof Button> = {
	title: "Ui/Button",
	component: Button,
	parameters: {
		docs: {
			description: {
				component:
					"Displays different types of error messages in the chat interface, including API errors, credit limit errors, diff errors, and clineignore errors. Handles special error parsing for Cline provider errors and provides appropriate user actions.",
			},
		},
	},
}

export default meta

// Default showcase all variants
export const Overview = () => {
	const sizes = [
		{ value: "sm", label: "Small" },
		{ value: "default", label: "Default" },
		{ value: "lg", label: "Large" },
	] as const

	const variants = ["default", "secondary", "danger", "outline", "ghost", "link", "text", "icon"] as const

	return (
		<div className="w-screen flex justify-center gap-4">
			{sizes.map((size) => (
				<div className="flex flex-col gap-4 w-md px-auto" key={size.value}>
					<h1>{size.label}</h1>
					{variants.map((variant) => (
						<Button key={variant} size={size.value === "default" ? undefined : size.value} variant={variant}>
							{variant === "icon" ? (
								<>
									<SearchIcon />
									{size.value === "default" && " Icon with Text"}
								</>
							) : (
								variant.charAt(0).toUpperCase() + variant.slice(1)
							)}
						</Button>
					))}
				</div>
			))}
		</div>
	)
}
