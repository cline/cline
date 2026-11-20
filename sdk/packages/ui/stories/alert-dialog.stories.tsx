import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import {
	AlertDialog,
	type AlertDialogProps,
} from "../components/alert-dialog.js";
import { Button } from "../components/button.js";
import { CompactDocsPage } from "./compact-docs-page";

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
		confirmTone: "neutral",
		confirmDisabled: false,
		cancelDisabled: false,
		confirmLoading: false,
		closeOnConfirm: true,
		dismissible: true,
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
		confirmLoading: { control: "boolean" },
		closeOnConfirm: { control: "boolean" },
		dismissible: { control: "boolean" },
	},
	parameters: {
		docs: {
			page: CompactDocsPage,
			story: { inline: false, height: "520px" },
			description: {
				component:
					"Confirmation with independently controlled actions and Escape dismissal. Use the controls to compare tones, disabled actions, and loading. The host owns completion and cancellation.",
			},
		},
	},
	render: (args) => <Example {...args} />,
} satisfies Meta<typeof AlertDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function Example(props: AlertDialogProps) {
	const [open, setOpen] = useState(true);
	return (
		<div className="p-6">
			<Button onClick={() => setOpen(true)} tone="neutral" variant="secondary">
				Reopen dialog
			</Button>
			<AlertDialog {...props} open={open} onOpenChange={setOpen} />
		</div>
	);
}

export const Playground: Story = {};

export const PendingConfirmation: Story = {
	args: {
		title: "Save session details?",
		description: "The dialog stays open until the simulated save finishes.",
		confirmLabel: "Save details",
		closeOnConfirm: false,
	},
	argTypes: {
		confirmLoading: { control: false },
		closeOnConfirm: { control: false },
	},
	parameters: {
		docs: {
			description: {
				story:
					"Save disables the focused confirmation while keeping the dialog open. Cancel and Escape remain independently configurable; closing cancels the simulated save.",
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
				<AlertDialog
					{...args}
					open={open}
					onOpenChange={(nextOpen) => {
						setOpen(nextOpen);
						if (!nextOpen) setPending(false);
					}}
					closeOnConfirm={false}
					onConfirm={(event) => {
						event.currentTarget.focus();
						setPending(true);
					}}
					confirmLabel={pending ? "Saving…" : args.confirmLabel}
					confirmLoading={pending}
				/>
			</div>
		);
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
