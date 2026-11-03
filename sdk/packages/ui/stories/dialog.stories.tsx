import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/button.js";
import { Dialog, type DialogProps } from "../components/dialog.js";

const catalogTools = Array.from(
	{ length: 24 },
	(_, index) => `Catalog action ${index + 1}`,
);

const meta = {
	title: "Components/Dialog",
	component: Dialog,
	tags: ["autodocs"],
	args: {
		open: true,
		onOpenChange: () => {},
		title: "Session details",
		description: "Review the details of your current session.",
		children: (
			<p className="text-cline-ui-sm">
				This session is saved locally and can be continued from your history.
			</p>
		),
	},
	argTypes: {
		open: { control: false },
		onOpenChange: { control: false },
		children: { control: false },
		footer: { control: false },
		size: { control: "select", options: ["sm", "md", "lg"] },
		showCloseButton: { control: "boolean" },
	},
	parameters: {
		docs: {
			story: { inline: false, height: "640px" },
			description: {
				component:
					"A controlled dialog for details, forms, and richer content, styled to match AlertDialog. " +
					"The header and optional footer stay visible while the body scrolls. " +
					"The caller owns footer actions, pending state, and dismissal guards. " +
					"Use the toolbar to compare light and dark themes.",
			},
		},
	},
	render: (args) => <Example {...args} />,
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function Example(props: DialogProps) {
	const [open, setOpen] = useState(true);
	return (
		<div className="p-6">
			<Button onClick={() => setOpen(true)} tone="neutral" variant="secondary">
				Reopen dialog
			</Button>
			<Dialog
				{...props}
				footer={
					props.footer === undefined ? (
						<Button onClick={() => setOpen(false)} size="sm" tone="neutral">
							Done
						</Button>
					) : (
						props.footer
					)
				}
				onOpenChange={setOpen}
				open={open}
			/>
		</div>
	);
}

export const Default: Story = {};

export const Details: Story = {
	args: {
		title: "Daily change digest",
		description: undefined,
		children: (
			<div className="space-y-5 text-cline-ui-sm">
				<dl className="grid grid-cols-2 gap-4">
					<div>
						<dt className="mb-1 text-cline-ui-muted-foreground">Schedule</dt>
						<dd>Daily at 5:00 PM</dd>
					</div>
					<div>
						<dt className="mb-1 text-cline-ui-muted-foreground">Status</dt>
						<dd>Enabled</dd>
					</div>
				</dl>
				<section className="space-y-2">
					<h3 className="font-cline-ui-medium text-cline-ui-muted-foreground">
						Recent runs
					</h3>
					<ul className="divide-y divide-cline-ui-border rounded-cline-ui-md border border-cline-ui-border">
						{["Today", "Yesterday", "Two days ago"].map((date) => (
							<li className="flex justify-between gap-4 p-3" key={date}>
								<span>Completed</span>
								<span className="text-cline-ui-muted-foreground">{date}</span>
							</li>
						))}
					</ul>
				</section>
			</div>
		),
	},
};

export const Loading: Story = {
	args: {
		title: "Import sessions",
		description:
			"Bring your conversation history from other coding tools into Cline.",
		footer: null,
		children: (
			<output className="flex min-h-64 flex-col items-center justify-center gap-3 text-cline-ui-muted-foreground text-cline-ui-sm">
				<LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
				Scanning for sessions…
			</output>
		),
	},
};

export const LongContent: Story = {
	args: {
		title: "Catalog tools",
		description:
			"Available actions depend on your connected account’s permissions.",
		size: "lg",
		children: (
			<ul className="divide-y divide-cline-ui-border text-cline-ui-sm">
				{catalogTools.map((tool) => (
					<li className="space-y-1 py-3" key={tool}>
						<h3 className="font-cline-ui-medium">{tool}</h3>
						<p className="text-cline-ui-muted-foreground">
							Search and organize information from your connected account.
						</p>
					</li>
				))}
			</ul>
		),
	},
	parameters: {
		docs: {
			description: {
				story:
					"The long list scrolls independently, keeping the title, close button, and footer action visible.",
			},
		},
	},
};
