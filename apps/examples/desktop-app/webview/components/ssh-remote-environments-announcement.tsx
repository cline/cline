"use client";

import {
	BookOpen,
	Check,
	Folder,
	GitBranch,
	Laptop,
	Server,
	Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { openExternalUrl } from "@/lib/desktop-client";
import { REMOTE_ENVIRONMENTS_DOCS_URL } from "@/lib/remote-environments";

export type SshRemoteEnvironmentsAnnouncementProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Primary action: takes the user to Settings → Remote. */
	onSetUpHost: () => void;
};

const STEPS = [
	"Add a host in Settings → Remote",
	"Pick it from the environment selector",
	"Open a project on that machine",
];

/**
 * Static replica of the new-chat toolbar with the environment selector open,
 * so the spotlight shows where the (otherwise unlabeled) entry point lives.
 */
function EnvironmentSelectorPreview() {
	return (
		<div
			aria-hidden
			className="flex flex-col overflow-hidden rounded-lg border border-border bg-muted/40 p-4"
			data-testid="ssh-announcement-preview"
		>
			<div className="flex items-center gap-2">
				<span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground ring-2 ring-purple-500/70 ring-offset-2 ring-offset-muted">
					<Laptop className="size-4" />
				</span>
				<span className="flex h-9 min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground">
					<Folder className="size-3 shrink-0" />
					<span className="truncate text-foreground">~/dev/api</span>
					<span className="text-muted-foreground/60">/</span>
					<GitBranch className="size-3 shrink-0" />
					<span>main</span>
				</span>
			</div>
			<div className="mt-2 w-full rounded-md border border-border bg-popover p-1 text-xs text-popover-foreground shadow-lg">
				<div className="flex h-7 items-center gap-2 rounded-sm px-2">
					<Laptop className="size-3.5" />
					<span className="uppercase">Local</span>
				</div>
				<div className="my-1 h-px bg-border" />
				<div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
					<span className="flex items-center gap-2">
						<Server className="size-3.5" />
						Remote
					</span>
					<Settings className="size-3" />
				</div>
				<div className="flex h-7 items-center gap-2 rounded-sm bg-purple-500/20 px-2">
					<span className="min-w-0 flex-1 truncate">Build server</span>
					<Check className="size-3.5" />
				</div>
				<div className="flex h-7 items-center gap-2 rounded-sm px-2">
					<span className="min-w-0 flex-1 truncate">Raspberry Pi</span>
				</div>
			</div>
		</div>
	);
}

export function SshRemoteEnvironmentsAnnouncement({
	open,
	onOpenChange,
	onSetUpHost,
}: SshRemoteEnvironmentsAnnouncementProps) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent
				aria-describedby={undefined}
				className="gap-6 outline-none sm:max-w-2xl"
				onOpenAutoFocus={(event) => {
					// Keep focus on the dialog itself rather than lighting up "Maybe
					// later" with a focus ring the moment the spotlight appears.
					event.preventDefault();
					(event.currentTarget as HTMLElement | null)?.focus();
				}}
			>
				<DialogHeader className="gap-3">
					<span className="w-fit rounded-full border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-purple-700 dark:text-purple-300">
						New
					</span>
					<DialogTitle className="text-xl">
						Run Cline on any machine over SSH
					</DialogTitle>
				</DialogHeader>
				<div className="grid items-center gap-6 sm:grid-cols-[minmax(0,16rem)_1fr]">
					<EnvironmentSelectorPreview />
					<ol className="flex flex-col gap-5">
						{STEPS.map((step, index) => (
							<li className="flex items-center gap-3" key={step}>
								<span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-muted-foreground">
									{index + 1}
								</span>
								<span className="text-sm font-medium">{step}</span>
							</li>
						))}
					</ol>
				</div>
				<DialogFooter>
					<Button onClick={() => onOpenChange(false)} variant="ghost">
						Maybe later
					</Button>
					<Button
						onClick={() => void openExternalUrl(REMOTE_ENVIRONMENTS_DOCS_URL)}
						variant="outline"
					>
						<BookOpen />
						Read the guide
					</Button>
					<Button onClick={onSetUpHost}>Set up an SSH host</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
