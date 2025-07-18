import type { Meta, StoryObj } from "@storybook/react-vite"
import WelcomeView from "./WelcomeView"
import { VSCodeWebview } from "../common/StorybookDecorator"

const meta: Meta<typeof WelcomeView> = {
	title: "Views/WelcomeView",
	component: WelcomeView,
	decorators: [VSCodeWebview],
}

export default meta

export const Default: StoryObj<typeof meta> = {}
