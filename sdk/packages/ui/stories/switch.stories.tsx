import type { Meta, StoryObj } from "@storybook/react-vite";
import { type CSSProperties, useId } from "react";
import { useArgs } from "storybook/preview-api";
import { Switch, type SwitchProps } from "../components/switch";

const meta: Meta<typeof Switch> = {
	title: "Components/Switch",
	component: Switch,
	tags: ["autodocs"],
	parameters: {
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
	render: function WithLabel(args) {
		const id = useId();
		return (
			<div className="flex items-center gap-2">
				<Switch {...args} aria-label={undefined} id={id} />
				<label className="cursor-pointer text-cline-ui-md" htmlFor={id}>
					Enable notifications
				</label>
			</div>
		);
	},
};

export const Controlled: Story = {
	args: { checked: false },
	render: function Controlled(args) {
		const [{ checked }, updateArgs] = useArgs<SwitchProps>();
		return (
			<div className="flex items-center gap-3">
				<Switch
					{...args}
					checked={checked}
					onCheckedChange={(value) => {
						updateArgs({ checked: value });
						args.onCheckedChange?.(value);
					}}
				/>
				<span className="text-cline-ui-md">{checked ? "On" : "Off"}</span>
			</div>
		);
	},
};

export const RightToLeft: Story = {
	args: { dir: "rtl" },
	render: (args) => (
		<div className="flex items-center gap-6" dir={args.dir}>
			<Switch {...args} aria-label="RTL off" />
			<Switch {...args} aria-label="RTL on" defaultChecked />
		</div>
	),
};

export const CustomAccent: Story = {
	args: { defaultChecked: true },
	decorators: [
		(Story) => (
			<div
				style={
					{
						"--primary": "#087ea4",
						"--primary-emphasis": "#065f7a",
						"--ring": "#087ea4",
					} as CSSProperties
				}
			>
				<Story />
			</div>
		),
	],
};
