import type { Meta } from "@storybook/react-vite"
import { Bold, Italic, Underline } from "lucide-react"
import { Toggle } from "./toggle"

const meta: Meta<typeof Toggle> = {
	title: "Ui/Toggle",
	component: Toggle,
	parameters: {
		docs: {
			description: {
				component:
					"A two-state button that can be either on or off. Toggle components are used for binary state changes, such as enabling/disabling features or applying formatting options.",
			},
		},
	},
}

export default meta

export const Overview = () => {
	const variants = ["default", "outline"] as const

	const states = [
		{ value: "icon-only", label: "Icon Only" },
		{ value: "with-text", label: "With Text" },
		{ value: "disabled", label: "Disabled" },
		{ value: "pressed", label: "Default Pressed" },
	] as const

	const sizes = [
		{ value: "sm", label: "Small" },
		{ value: "default", label: "Default" },
		{ value: "lg", label: "Large" },
	] as const

	return (
		<div className="w-screen flex justify-center p-8">
			<div className="flex flex-col gap-8 w-full max-w-4xl">
				{states.map((state) => (
					<div className="flex flex-col gap-4" key={state.value}>
						<h2 className="text-lg font-semibold">{state.label}</h2>
						<div className="flex gap-8">
							{sizes.map((size) => (
								<div className="flex flex-col gap-3" key={size.value}>
									<h3 className="text-sm font-medium">{size.label}</h3>
									<div className="flex gap-2">
										{variants.map((variant) => {
											const sizeValue = size.value === "default" ? undefined : size.value
											const commonProps = {
												key: variant,
												variant,
												size: sizeValue,
											}

											if (state.value === "icon-only") {
												return (
													<Toggle {...commonProps} aria-label="Toggle bold">
														<Bold />
													</Toggle>
												)
											}

											if (state.value === "with-text") {
												return (
													<Toggle {...commonProps}>
														<Bold />
														Bold
													</Toggle>
												)
											}

											if (state.value === "disabled") {
												return (
													<Toggle {...commonProps} disabled>
														<Italic />
													</Toggle>
												)
											}

											if (state.value === "pressed") {
												return (
													<Toggle {...commonProps} defaultPressed>
														<Underline />
													</Toggle>
												)
											}

											return null
										})}
									</div>
								</div>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
