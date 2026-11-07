import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import {
	AlertDialog,
	type AlertDialogProps,
} from "../components/alert-dialog.js";
import { Button } from "../components/button.js";

const meta = {
	title: "Components/AlertDialog",
	component: AlertDialog,
	tags: ["autodocs"],
	args: {
		open: true,
		onOpenChange: () => {},
		title: "Continue with this action?",
		description: "Review the details before continuing.",
		confirmLabel: "Continue",
		onConfirm: () => {},
	},
	argTypes: {
		open: { control: false },
		onOpenChange: { control: false },
		onConfirm: { control: false },
		onCancel: { control: false },
		children: { control: false },
		confirmTone: {
			control: "select",
			options: ["accent", "neutral", "destructive"],
		},
		confirmDisabled: { control: "boolean" },
		cancelDisabled: { control: "boolean" },
	},
	parameters: {
		docs: {
			story: { inline: false, height: "520px" },
			description: {
				component:
					"A controlled, accessible confirmation dialog using shared Button styles. " +
					"Actions request closure unless the mouse handler calls event.preventDefault(). " +
					"Keep loading, retries, and dismissal guards in the caller. " +
					"These examples use harmless callbacks. " +
					"Use the toolbar to compare light and dark themes.",
			},
		},
	},
	render: (args) => <Example {...args} />,
} satisfies Meta<typeof AlertDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function Example({
	blocking = false,
	...props
}: AlertDialogProps & { blocking?: boolean }) {
	const [open, setOpen] = useState(true);
	return (
		<div className="p-6">
			<Button onClick={() => setOpen(true)} tone="neutral" variant="secondary">
				Reopen dialog
			</Button>
			<AlertDialog
				{...props}
				open={open}
				onOpenChange={(nextOpen) => {
					if (!blocking) setOpen(nextOpen);
				}}
				onCancel={
					blocking
						? (event) => {
								event.preventDefault();
								setOpen(false);
							}
						: props.onCancel
				}
				onConfirm={
					blocking
						? (event) => {
								event.preventDefault();
								setOpen(false);
							}
						: props.onConfirm
				}
			/>
		</div>
	);
}

export const Default: Story = {};

export const Destructive: Story = {
	args: { confirmTone: "destructive" },
};

export const WithDetails: Story = {
	args: {
		children: (
			<div className="wrap-break-word max-h-32 overflow-y-auto rounded-md bg-cline-ui-muted p-3 font-mono text-sm">
				https://docs.cline.bot/getting-started/installing-cline
			</div>
		),
	},
};

export const LongContent: Story = {
	args: {
		title:
			"Delete this session, its generated workspace, and all saved checkpoints?",
		description: (
			<>
				<p>
					This session contains a long conversation, several saved checkpoints,
					and a generated workspace with changes that have not been committed.
					Review the details below before deciding whether to remove them.
				</p>
				<p>
					Deleting the session removes its messages, attached context, command
					output, and local history. You will no longer be able to reopen the
					conversation or use its checkpoints to restore an earlier version of
					the workspace.
				</p>
				<p>
					The generated git worktree and its branch will also be removed. Any
					uncommitted edits, new files, or local configuration stored only in
					that worktree will be lost. Copy anything you want to keep to another
					location before continuing.
				</p>
				<p>
					Files already committed and pushed to your remote repository remain
					available there. Other sessions and workspaces are not included in
					this action, even when they belong to the same project or use a
					similar branch name.
				</p>
				<p>
					If you are unsure whether a file has been saved elsewhere, cancel this
					dialog and inspect the workspace first. You can return to this
					confirmation after reviewing the affected paths and saving any
					remaining work.
				</p>
			</>
		),
		children: (
			<div className="space-y-3 text-cline-ui-sm">
				<h3 className="font-cline-ui-medium">Affected paths</h3>
				<ul className="space-y-2 rounded-cline-ui-md bg-cline-ui-muted p-3 font-cline-ui-mono text-cline-ui-xs">
					{[
						"apps/dashboard/src/components/workspace-settings/WorkspaceSettings.tsx",
						"apps/dashboard/src/components/workspace-settings/WorkspaceMembers.tsx",
						"apps/dashboard/src/components/workspace-settings/WorkspacePermissions.tsx",
						"apps/dashboard/src/components/activity-feed/ActivityFeed.tsx",
						"apps/dashboard/src/components/activity-feed/ActivityFeedFilters.tsx",
						"apps/dashboard/src/components/session-history/SessionHistory.tsx",
						"apps/dashboard/src/components/session-history/SessionHistoryDetails.tsx",
						"apps/dashboard/src/components/notifications/NotificationPreferences.tsx",
					].map((path) => (
						<li className="wrap-anywhere" key={path}>
							{path}
						</li>
					))}
				</ul>
			</div>
		),
		cancelLabel: "Keep session and workspace",
		confirmLabel: "Delete session and workspace",
		confirmTone: "destructive",
	},
	parameters: {
		docs: {
			description: {
				story:
					"Long title, multiple description paragraphs, file paths, and action labels exercise wrapping in a height-limited dialog. The content scrolls while the actions remain visible.",
			},
		},
	},
};

export const DisabledActions: Story = {
	args: { confirmDisabled: true, cancelDisabled: true },
	parameters: {
		docs: {
			description: {
				story:
					"Confirm and cancel can be disabled independently using the controls.",
			},
		},
	},
};

export const PendingConfirmation: Story = {
	args: {
		title: "Save session details?",
		description: "The dialog stays open until the simulated save finishes.",
		confirmLabel: "Save details",
	},
	parameters: {
		docs: {
			description: {
				story:
					"Confirm prevents automatic dismissal, disables both actions during a simulated save, and closes on completion. The caller rejects Escape dismissal while saving.",
			},
		},
	},
	render: function PendingConfirmation(args) {
		const [open, setOpen] = useState(true);
		const [pending, setPending] = useState(false);
		useEffect(() => {
			if (!pending) return;
			const timeout = setTimeout(() => {
				setPending(false);
				setOpen(false);
			}, 1200);
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
				<AlertDialog
					{...args}
					open={open}
					onOpenChange={(nextOpen) => {
						if (!pending) setOpen(nextOpen);
					}}
					onConfirm={(event) => {
						event.preventDefault();
						setPending(true);
					}}
					confirmLabel={pending ? "Saving…" : args.confirmLabel}
					confirmDisabled={pending || args.confirmDisabled}
					cancelDisabled={pending || args.cancelDisabled}
				/>
			</div>
		);
	},
};

export const Blocking: Story = {
	parameters: {
		docs: {
			description: {
				story:
					"The caller rejects Escape dismissal. Either action explicitly closes the dialog.",
			},
		},
	},
	render: (args) => <Example {...args} blocking />,
};
