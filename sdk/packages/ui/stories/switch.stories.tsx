import type { Meta, StoryObj } from "@storybook/react-vite";
import { useId, useState } from "react";
import { Switch } from "../components/switch";

const meta: Meta<typeof Switch> = {
	title: "Components/Switch",
	component: Switch,
	tags: ["autodocs"],
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				component:
					"A switch for turning a setting on or off. Pair it with a visible label, or provide an accessible name with aria-label.",
			},
		},
	},
	decorators: [
		(Story) => (
			<div className="flex min-h-40 items-center justify-center p-6">
				<Story />
			</div>
		),
	],
	args: { "aria-label": "Enable notifications" },
	argTypes: { onCheckedChange: { action: "checked changed" } },
};

export default meta;
type Story = StoryObj<typeof Switch>;

export const Default: Story = {};

export const Checked: Story = { args: { defaultChecked: true } };

export const Disabled: Story = {
	render: (args) => (
		<div className="flex items-center gap-6">
			<Switch {...args} aria-label="Disabled off" disabled />
			<Switch {...args} aria-label="Disabled on" defaultChecked disabled />
		</div>
	),
};

export const WithLabel: Story = {
	render: function WithLabel() {
		const id = useId();
		return (
			<div className="flex items-center gap-2">
				<Switch id={id} />
				<label className="cursor-pointer text-cline-ui-md" htmlFor={id}>
					Enable notifications
				</label>
			</div>
		);
	},
};

export const Controlled: Story = {
	render: function Controlled(args) {
		const [checked, setChecked] = useState(false);
		return (
			<div className="flex items-center gap-3">
				<Switch
					{...args}
					checked={checked}
					onCheckedChange={(value) => {
						setChecked(value);
						args.onCheckedChange?.(value);
					}}
				/>
				<span className="text-cline-ui-md">{checked ? "On" : "Off"}</span>
			</div>
		);
	},
};
