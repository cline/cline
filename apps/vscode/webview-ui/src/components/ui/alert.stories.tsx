import type { Meta } from "@storybook/react-vite"
import ClineLogoWhite from "@/assets/ClineLogoWhite"
import { Alert, AlertDescription } from "./alert"

const meta: Meta<typeof Alert> = {
	title: "Ui/Alert",
	component: Alert,
	parameters: {
		docs: {
			description: {
				component:
					"Displays alert messages with different severity levels (default, warning, danger). Includes optional dismiss functionality and supports title and description content.",
			},
		},
	},
}

export default meta

export const Default = () => (
	<div className="w-screen flex justify-center items-center">
		<div className="flex flex-col gap-4 w-full max-w-md px-4">
			<Alert title="Default" variant="default">
				<AlertDescription>This is a default alert message.</AlertDescription>
			</Alert>
			<Alert title="Warning" variant="warning">
				<AlertDescription>This is a warning alert.</AlertDescription>
			</Alert>
			<Alert title="Error" variant="danger">
				<AlertDescription>An error has occurred.</AlertDescription>
			</Alert>
			<Alert isDismissible={false} title="Non Dismissible" variant="default">
				<AlertDescription>This alert cannot be dismissed.</AlertDescription>
			</Alert>
			<Alert icon={<ClineLogoWhite className="size-2" />} title="Brand" variant="cline">
				<AlertDescription>
					<p className="my-1">How can I help you?</p>
					<ul className="list-inside list-disc text-sm">
						<li>Coding</li>
						<li>Debugging</li>
						<li>Write Tests</li>
					</ul>
				</AlertDescription>
			</Alert>
		</div>
	</div>
)
