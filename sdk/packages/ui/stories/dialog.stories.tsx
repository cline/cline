import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../components/button.js";
import { Dialog, type DialogProps } from "../components/dialog.js";
import { CompactDocsPage } from "./compact-docs-page";

type DialogStoryArgs = DialogProps & {
	showFooter: boolean;
	loadingBody: boolean;
};

const catalogTools = Array.from(
	{ length: 24 },
	(_, index) => `Catalog action ${index + 1}`,
);

function LoadingContent() {
	return (
		<output className="flex min-h-48 flex-col items-center justify-center gap-3 text-cline-ui-muted-foreground text-cline-ui-sm">
			<LoaderCircle
				aria-hidden="true"
				className="size-5 motion-safe:animate-spin"
			/>
			Loading session details…
		</output>
	);
}

function Example({ showFooter, loadingBody, ...props }: DialogStoryArgs) {
	const [open, setOpen] = useState(true);
	return (
		<div className="p-6">
			<Button onClick={() => setOpen(true)} tone="neutral" variant="secondary">
				Reopen dialog
			</Button>
			<Dialog
				{...props}
				footer={
					showFooter ? (
						props.footer === undefined ? (
							<Button onClick={() => setOpen(false)} size="sm" tone="neutral">
								Done
							</Button>
						) : (
							props.footer
						)
					) : null
				}
				onOpenChange={setOpen}
				open={open}
			>
				{loadingBody ? <LoadingContent /> : props.children}
			</Dialog>
		</div>
	);
}

const meta = {
	title: "Components/Dialog",
	component: Dialog,
	tags: ["autodocs"],
	args: {
		open: true,
		onOpenChange: () => {},
		title: "Session details",
		description: "Review the details of your current session.",
		showFooter: true,
		loadingBody: false,
		showCloseButton: true,
		dismissible: true,
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
		showFooter: { name: "Show footer", control: "boolean" },
		loadingBody: { name: "Loading body", control: "boolean" },
		size: { control: "select", options: ["sm", "md", "lg"] },
		showCloseButton: { control: "boolean" },
		dismissible: { control: "boolean" },
		bodyLayout: { control: "inline-radio", options: ["scroll", "contained"] },
	},
	parameters: {
		docs: {
			page: CompactDocsPage,
			story: { inline: false, height: "640px" },
			description: {
				component:
					"A controlled dialog with a scrollable body and optional footer. The host owns actions and saving. Dismissible controls Escape, outside clicks, and the close button; explicit footer actions remain independent.",
			},
		},
	},
	render: (args) => <Example {...args} />,
} satisfies Meta<DialogStoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Saving: Story = {
	args: {
		title: "Save session details",
		description: "The dialog stays open while the simulated save finishes.",
		showCloseButton: false,
		dismissible: false,
	},
	argTypes: {
		showFooter: { control: false },
		loadingBody: { control: false },
	},
	parameters: {
		docs: {
			description: {
				story:
					"Save focuses and disables its footer button. Focus stays inside the open dialog while both actions are disabled.",
			},
		},
	},
	render: function Saving({
		showFooter: _showFooter,
		loadingBody: _loadingBody,
		...props
	}) {
		const [open, setOpen] = useState(true);
		const [pending, setPending] = useState(false);
		useEffect(() => {
			if (!pending) return;
			const timeout = setTimeout(() => {
				setPending(false);
				setOpen(false);
			}, 2000);
			return () => clearTimeout(timeout);
		}, [pending]);

		return (
			<div className="p-6">
				<Button
					onClick={() => setOpen(true)}
					tone="neutral"
					variant="secondary"
				>
					Reopen dialog
				</Button>
				<Dialog
					{...props}
					open={open}
					onOpenChange={(nextOpen) => {
						setOpen(nextOpen);
						if (!nextOpen) setPending(false);
					}}
					footer={
						<>
							<Button
								size="sm"
								tone="neutral"
								variant="secondary"
								disabled={pending}
								onClick={() => setOpen(false)}
							>
								Cancel
							</Button>
							<Button
								size="sm"
								tone="neutral"
								disabled={pending}
								loading={pending}
								onClick={(event) => {
									event.currentTarget.focus();
									setPending(true);
								}}
							>
								Save details
							</Button>
						</>
					}
				/>
			</div>
		);
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
					"The body scrolls while the title, close button, and footer stay visible.",
			},
		},
	},
};
