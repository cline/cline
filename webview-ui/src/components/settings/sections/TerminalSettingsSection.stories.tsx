import type { Meta, StoryObj } from "@storybook/react-vite"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
import TerminalSettingsSection from "./TerminalSettingsSection"

const mockExtensionState = {
	terminalReuseEnabled: true,
} as any

const meta: Meta<typeof TerminalSettingsSection> = {
	title: "Views/Settings/TerminalSettingsSection",
	component: TerminalSettingsSection,
	decorators: [
		(Story) => (
			<ExtensionStateContext.Provider value={mockExtensionState}>
				<div className="max-w-2xl p-4">
					<Story />
				</div>
			</ExtensionStateContext.Provider>
		),
	],
	parameters: {
		docs: {
			description: {
				component:
					"Terminal settings after foreground terminal removal. This story is intended for quick visual verification that only the remaining terminal controls render.",
			},
		},
	},
}

export default meta

type Story = StoryObj<typeof TerminalSettingsSection>

export const Default: Story = {
	render: () => <TerminalSettingsSection renderSectionHeader={() => null} />,
}
