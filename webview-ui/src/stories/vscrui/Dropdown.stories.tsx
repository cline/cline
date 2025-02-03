import type { Meta, StoryObj } from "@storybook/react"

import { Dropdown } from "vscrui"

const meta = {
	title: "@vscrui/Dropdown",
	component: () => (
		<Dropdown
			value="foo"
			role="combobox"
			options={[
				{ value: "foo", label: "Foo" },
				{ value: "bar", label: "Bar" },
				{ value: "baz", label: "Baz" },
			]}
		/>
	),
	parameters: { layout: "centered" },
	tags: ["autodocs"],
	argTypes: {},
	args: {},
} satisfies Meta<typeof Dropdown>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {},
	parameters: {
		docs: {
			source: {
				code: `
<Dropdown
    value="foo"
    role="combobox"
    options={[
        { value: "foo", label: "Foo" },
        { value: "bar", label: "Bar" },
        { value: "baz", label: "Baz" }
    ]}
/>`,
				language: "tsx",
			},
		},
	},
}
