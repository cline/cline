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
					"A switch for turning a setting on or off. Pair it with a visible label, or provide an accessible name with aria-label. pending temporarily locks the value and sets aria-busy while retaining its normal appearance, including within a disabled fieldset. Explicit disabled takes precedence and keeps the unavailable appearance.",
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
	args: { "aria-label": "Enable notifications", tone: "accent", size: "md" },
	argTypes: {
		size: { control: "select", options: ["sm", "md"] },
		tone: { control: "select", options: ["accent", "neutral"] },
		onCheckedChange: { action: "checked changed" },
	},
};

export default meta;
type Story = StoryObj<typeof Switch>;

export const Default: Story = {};

export const Small: Story = { args: { size: "sm" } };

export const Checked: Story = { args: { defaultChecked: true } };

export const Neutral: Story = {
	args: { tone: "neutral", defaultChecked: true },
};

export const Disabled: Story = {
	render: (args) => (
		<div className="flex items-center gap-6">
			<Switch {...args} aria-label="Disabled off" disabled />
			<Switch {...args} aria-label="Disabled on" defaultChecked disabled />
		</div>
	),
};

export const Pending: Story = {
	render: (args) => (
		<div className="space-y-5">
			<div className="flex items-center gap-6">
				<Switch {...args} aria-label="Saving off" pending />
				<Switch {...args} aria-label="Saving on" defaultChecked pending />
				<Switch
					{...args}
					aria-label="Unavailable while saving"
					defaultChecked
					pending
					disabled
				/>
			</div>
			<fieldset disabled className="flex items-center gap-6">
				<legend className="mb-3 text-sm">Temporarily locked form</legend>
				<Switch {...args} aria-label="Saving form off" pending />
				<Switch {...args} aria-label="Saving form on" defaultChecked pending />
			</fieldset>
		</div>
	),
};

export const WithLabel: Story = {
	render: function WithLabel(args) {
		const id = useId();
		return (
			<div className="flex items-center gap-3">
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
