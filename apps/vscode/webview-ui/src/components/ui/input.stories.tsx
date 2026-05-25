import type { Meta } from "@storybook/react-vite"
import { Button } from "./button"
import { Input } from "./input"

const meta: Meta<typeof Input> = {
	title: "Ui/Input",
	component: Input,
	parameters: {
		docs: {
			description: {
				component:
					"A styled text input component that supports all standard HTML input types. Includes focus states, placeholder text, and disabled state styling.",
			},
		},
	},
}

export default meta

export const Default = () => (
	<div className="w-screen flex justify-center items-center">
		<div className="flex flex-col gap-4 w-full max-w-md px-4">
			<Input placeholder="Default text input" type="text" />
			<Input placeholder="Email input" type="email" />
			<Input placeholder="Password input" type="password" />
			<Input placeholder="Number input" type="number" />
			<Input disabled placeholder="Disabled input" type="text" />
			<Input defaultValue="Input with value" type="text" />
			<div className="flex w-full items-center gap-2">
				<Input placeholder="Email" type="email" />
				<Button type="submit">Subscribe</Button>
			</div>
		</div>
	</div>
)
