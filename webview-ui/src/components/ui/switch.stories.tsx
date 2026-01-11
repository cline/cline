import type { Meta } from "@storybook/react-vite"
import { Switch } from "./switch"

const meta: Meta<typeof Switch> = {
	title: "Ui/Switch",
	component: Switch,
	parameters: {
		docs: {
			description: {
				component:
					"A toggle switch component for binary on/off states. Built on Radix UI with smooth animations and keyboard accessibility support.",
			},
		},
	},
}

export default meta

export const Default = () => (
	<div className="w-screen flex justify-center items-center">
		<div className="flex flex-col gap-6 w-full max-w-md px-4">
			<div className="flex items-center justify-between">
				<label className="text-sm font-medium cursor-pointer" htmlFor="switch-1">
					Default switch (unchecked)
				</label>
				<Switch id="switch-1" />
			</div>

			<div className="flex items-center justify-between">
				<label className="text-sm font-medium cursor-pointer" htmlFor="switch-2">
					Checked switch
				</label>
				<Switch defaultChecked id="switch-2" />
			</div>

			<div className="flex items-center justify-between">
				<label className="text-sm font-medium cursor-not-allowed opacity-50" htmlFor="switch-3">
					Disabled switch
				</label>
				<Switch disabled id="switch-3" />
			</div>

			<div className="flex items-center justify-between">
				<label className="text-sm font-medium cursor-not-allowed opacity-50" htmlFor="switch-4">
					Disabled checked switch
				</label>
				<Switch defaultChecked disabled id="switch-4" />
			</div>

			<div className="space-y-2 p-4 bg-accent/20 rounded-sm">
				<h4 className="text-sm font-medium">Setting Example</h4>
				<div className="flex items-center justify-between">
					<div className="space-y-0.5">
						<label className="text-sm font-medium cursor-pointer" htmlFor="notifications">
							Enable notifications
						</label>
						<div className="text-xs text-muted-foreground">Receive updates about your account activity</div>
					</div>
					<Switch id="notifications" />
				</div>
			</div>
		</div>
	</div>
)
