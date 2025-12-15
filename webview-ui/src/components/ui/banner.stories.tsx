import type { Meta } from "@storybook/react-vite"
import { BellIcon } from "lucide-react"
import { Banner } from "./banner"

const meta: Meta<typeof Banner> = {
	title: "Ui/Banner",
	component: Banner,
	parameters: {
		docs: {
			description: {
				component:
					"Displays message with preset styles and configurable options for title and description. Includes optional dismiss functionality.",
			},
		},
	},
}

export default meta

export const Overview = () => (
	<div className="w-screen flex justify-center items-center">
		<div className="flex flex-col gap-4 w-full max-w-md px-4">
			<Banner description="This is an example description" icon={BellIcon} title="Banner" />
			<Banner
				description="This is an example description"
				icon={BellIcon}
				isDismissible={false}
				title="Non Dismissable Banner"
			/>
		</div>
	</div>
)
