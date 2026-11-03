import type { Meta, StoryObj } from "@storybook/react-vite";
import { Monitor, Moon, Sun } from "lucide-react";
import { useArgs } from "storybook/preview-api";
import {
	SegmentedControl,
	type SegmentedControlOption,
	type SegmentedControlProps,
} from "../components/segmented-control";

const PERIOD_OPTIONS = [
	{ value: "day", label: "Day" },
	{ value: "week", label: "Week" },
	{ value: "month", label: "Month" },
] satisfies SegmentedControlOption[];

const THEME_OPTIONS = [
	{ value: "system", label: "System", icon: <Monitor /> },
	{ value: "light", label: "Light", icon: <Sun /> },
	{ value: "dark", label: "Dark", icon: <Moon /> },
] satisfies SegmentedControlOption[];

const meta: Meta<typeof SegmentedControl> = {
	title: "Components/Segmented Control",
	component: SegmentedControl,
	tags: ["autodocs"],
	parameters: {
		docs: {
			description: {
				component:
					"A single-selection control adapted from the cline-web footer theme picker. Equal-width segments use native radios and a sliding selection treatment. Give the group an accessible name; each option's label remains accessible in icon-only mode.",
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
	args: {
		"aria-label": "Calendar period",
		defaultValue: "week",
		options: PERIOD_OPTIONS,
		size: "md",
	},
	argTypes: {
		options: { control: false },
		size: { control: "select", options: ["xs", "sm", "md", "lg"] },
		iconOnly: { control: "boolean" },
		disabled: { control: "boolean" },
		onValueChange: { action: "selection changed" },
	},
};

export default meta;
type Story = StoryObj<typeof SegmentedControl>;

export const Default: Story = {};

export const ThemePicker: Story = {
	args: {
		"aria-label": "Color theme",
		defaultValue: "system",
		iconOnly: true,
		options: THEME_OPTIONS,
	},
	parameters: {
		docs: {
			description: {
				story:
					"The original footer's System, Light, and Dark choices. The host owns theme persistence and application; this story previews the selection control.",
			},
		},
	},
};

export const IconsAndLabels: Story = {
	args: {
		"aria-label": "Color theme",
		defaultValue: "light",
		options: THEME_OPTIONS,
	},
};

export const Sizes: Story = {
	parameters: {
		docs: {
			description: {
				story:
					"Heights scale with the root font size: xs is 2rem, sm is 2.25rem, and md/lg are 2.5rem. Large keeps the medium height with larger text and icons. Each size supports text, icons, or both.",
			},
		},
	},
	render: (args) => (
		<div className="grid w-full min-w-0 max-w-3xl gap-8 lg:grid-cols-2">
			{(
				[
					["xs", "Extra small", 2],
					["sm", "Small", 2.25],
					["md", "Medium (default)", 2.5],
					["lg", "Large", 2.5],
				] as const
			).map(([size, label, height]) => (
				<div
					className="grid content-start justify-items-start gap-4"
					key={size}
				>
					<div className="font-medium text-cline-ui-sm">
						{label}
						<span className="ml-2 font-normal text-cline-ui-muted-foreground">
							{size} · {height}rem
						</span>
					</div>
					<div className="grid justify-items-start gap-1.5">
						<span className="text-cline-ui-muted-foreground text-cline-ui-xs">
							Text
						</span>
						<SegmentedControl
							{...args}
							aria-label={`${label} calendar period`}
							defaultValue="week"
							iconOnly={false}
							options={PERIOD_OPTIONS}
							size={size}
						/>
					</div>
					<div className="grid justify-items-start gap-1.5">
						<span className="text-cline-ui-muted-foreground text-cline-ui-xs">
							Icons
						</span>
						<SegmentedControl
							{...args}
							aria-label={`${label} color theme icons`}
							defaultValue="system"
							iconOnly
							options={THEME_OPTIONS}
							size={size}
						/>
					</div>
					<div className="grid justify-items-start gap-1.5">
						<span className="text-cline-ui-muted-foreground text-cline-ui-xs">
							Icons and labels
						</span>
						<SegmentedControl
							{...args}
							aria-label={`${label} color theme icons and labels`}
							defaultValue="system"
							iconOnly={false}
							options={THEME_OPTIONS}
							size={size}
						/>
					</div>
				</div>
			))}
		</div>
	),
};

export const Controlled: Story = {
	args: { defaultValue: undefined, value: "week" },
	render: function Controlled(args) {
		const [{ value }, updateArgs] = useArgs<SegmentedControlProps>();
		return (
			<div className="grid justify-items-center gap-4">
				<SegmentedControl
					{...args}
					onValueChange={(nextValue) => {
						updateArgs({ value: nextValue });
						args.onValueChange?.(nextValue);
					}}
					value={value}
				/>
				<output className="text-cline-ui-muted-foreground text-cline-ui-sm">
					Selected period: {value}
				</output>
			</div>
		);
	},
};

export const Disabled: Story = {
	render: (args) => (
		<div className="grid justify-items-center gap-6">
			<SegmentedControl
				{...args}
				aria-label="Disabled calendar period"
				disabled
			/>
			<SegmentedControl
				{...args}
				aria-label="Calendar period with Month unavailable"
				options={PERIOD_OPTIONS.map((option) => ({
					...option,
					disabled: option.value === "month",
				}))}
			/>
		</div>
	),
};

export const FourOptions: Story = {
	args: {
		options: [...PERIOD_OPTIONS, { value: "year", label: "Year" }],
	},
};

export const RightToLeft: Story = {
	args: {
		"aria-label": "فترة التقويم",
		dir: "rtl",
		options: [
			{ value: "day", label: "يوم" },
			{ value: "week", label: "أسبوع" },
			{ value: "month", label: "شهر" },
		],
	},
};
