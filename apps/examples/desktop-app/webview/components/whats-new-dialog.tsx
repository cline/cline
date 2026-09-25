"use client";

import { ArrowRight, Bug, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ISSUES_URL } from "@/lib/changelog";
import { openExternalUrl } from "@/lib/desktop-client";
import type { WhatsNewRelease } from "@/lib/whats-new-content";

/**
 * Catch-up dialog for a `WhatsNewRelease`. Shown once by the app shell after
 * an update that carries a new catch-up, and replayable from Settings → About.
 */
export function WhatsNewDialog({
	release,
	open,
	onOpenChange,
	onShowAllChanges,
}: {
	release: WhatsNewRelease;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Omit when the dialog is opened from the About page itself. */
	onShowAllChanges?: () => void;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
				<DialogHeader
					className="gap-1.5 px-6 pt-14 pb-6 text-left"
					style={{
						// The brand surface is tuned to carry near-white text in both
						// themes; the radials only add depth on top of it.
						background:
							"radial-gradient(120% 140% at 15% 0%, var(--brand-periwinkle) 0%, transparent 55%), radial-gradient(90% 120% at 100% 100%, color-mix(in oklab, var(--brand-violet-surface) 65%, black) 0%, transparent 60%), var(--brand-violet-surface)",
						color: "var(--brand-violet-surface-foreground)",
					}}
				>
					<p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider opacity-80">
						<Sparkles className="size-3.5" />
						What's new in Cline
					</p>
					<DialogTitle className="text-2xl leading-tight text-inherit">
						{release.title}
					</DialogTitle>
					<DialogDescription className="text-sm text-inherit opacity-80">
						{release.description}
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-5 p-6">
					<ul className="grid gap-4 sm:grid-cols-2">
						{release.highlights.map((highlight) => (
							<li className="flex gap-3" key={highlight.title}>
								<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
									<highlight.icon className="size-4" />
								</span>
								<div className="min-w-0">
									<p className="text-sm font-semibold text-foreground">
										{highlight.title}
									</p>
									<p className="mt-0.5 text-sm text-muted-foreground">
										{highlight.description}
									</p>
								</div>
							</li>
						))}
					</ul>
					<DialogFooter className="sm:justify-between">
						<div className="flex flex-wrap gap-1">
							{onShowAllChanges ? (
								<Button
									className="text-muted-foreground"
									onClick={onShowAllChanges}
									size="sm"
									type="button"
									variant="ghost"
								>
									See all changes
									<ArrowRight className="size-3.5" />
								</Button>
							) : null}
							<Button
								className="text-muted-foreground"
								onClick={() => void openExternalUrl(ISSUES_URL)}
								size="sm"
								type="button"
								variant="ghost"
							>
								<Bug className="size-3.5" />
								Report an issue
							</Button>
						</div>
						<Button onClick={() => onOpenChange(false)} size="sm" type="button">
							Continue
						</Button>
					</DialogFooter>
				</div>
			</DialogContent>
		</Dialog>
	);
}
