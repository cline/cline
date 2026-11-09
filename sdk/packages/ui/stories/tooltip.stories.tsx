import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../components/button.js";
import { Tooltip, TooltipProvider } from "../components/tooltip.js";

const meta = {
	title: "Components/Tooltip",
	component: Tooltip,
	tags: ["autodocs"],
	args: {
		content: "Start a new session",
		children: (
			<Button tone="neutral" variant="secondary">
				Hover or focus me
			</Button>
		),
		side: "top",
		align: "center",
		sideOffset: 6,
		delayDuration: 0,
	},
	argTypes: {
		children: { control: false },
		side: {
			control: "select",
			options: ["top", "right", "bottom", "left"],
		},
		align: {
			control: "select",
			options: ["start", "center", "end"],
		},
		sideOffset: { control: { type: "number", min: 0 } },
		delayDuration: { control: { type: "number", min: 0, step: 100 } },
	},
	parameters: {
		docs: {
			description: {
				component:
					"Wrap one focusable element that forwards its ref and event props. " +
					"Hover or focus the trigger to reveal the tooltip; Escape dismisses it. " +
					"Tooltips open immediately by default. Use the toolbar to compare light and dark themes.",
			},
		},
	},
	render: (args) => (
		<div className="flex min-h-60 items-center justify-center p-12">
			<Tooltip {...args} />
		</div>
	),
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Placement: Story = {
	argTypes: { side: { control: false }, content: { control: false } },
	render: (args) => (
		<div className="flex min-h-60 flex-wrap items-center justify-center gap-16 p-12">
			{(["top", "right", "bottom", "left"] as const).map((side) => (
				<Tooltip {...args} content={`${side} tooltip`} key={side} side={side}>
					<Button tone="neutral" variant="secondary">
						{side}
					</Button>
				</Tooltip>
			))}
		</div>
	),
};

export const Alignment: Story = {
	argTypes: { align: { control: false } },
	args: { content: "Aligned with the trigger", side: "bottom", sideOffset: 16 },
	render: (args) => (
		<div className="flex min-h-60 flex-wrap items-center justify-center gap-16 p-12">
			{(["start", "center", "end"] as const).map((align) => (
				<Tooltip {...args} align={align} key={align}>
					<Button tone="neutral" variant="secondary">
						{align}
					</Button>
				</Tooltip>
			))}
		</div>
	),
};

export const LongContent: Story = {
	args: {
		content:
			"Review the changes in this session before creating a pull request. Long descriptions wrap to fit the available space, including paths such as apps/dashboard/src/components/workspace-settings/WorkspaceSettings.tsx.",
	},
};

export const Delayed: Story = {
	args: { content: "Appears after 600 ms of hovering", delayDuration: 600 },
};

export const SharedDelay: Story = {
	args: { delayDuration: 600 },
	parameters: {
		docs: {
			description: {
				story:
					"Hover a button until its tooltip opens, then move to a neighboring button within 300 ms to skip the delay. Keyboard focus always opens immediately.",
			},
		},
	},
	render: ({ delayDuration, ...args }) => (
		<TooltipProvider delayDuration={delayDuration} skipDelayDuration={300}>
			<div className="flex min-h-60 items-center justify-center gap-2 p-12">
				{["Copy", "Share", "Download"].map((action) => (
					<Tooltip {...args} content={`${action} session`} key={action}>
						<Button tone="neutral" variant="secondary">
							{action}
						</Button>
					</Tooltip>
				))}
			</div>
		</TooltipProvider>
	),
};
