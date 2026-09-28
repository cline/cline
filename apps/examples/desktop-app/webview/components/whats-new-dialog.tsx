"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { WhatsNewRelease } from "@/lib/whats-new-content";

// A fixed deep-violet hero in both themes: the brand glow reads the same on a
// light or dark dialog and keeps the white title at full contrast.
const HERO_BACKGROUND =
	"radial-gradient(120% 140% at 15% 0%, oklch(0.55 0.22 293) 0%, transparent 55%), radial-gradient(90% 120% at 100% 100%, oklch(0.45 0.16 275) 0%, transparent 60%), oklch(0.27 0.1 293)";

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
			<DialogContent
				aria-describedby={undefined}
				className="gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[560px] [&_[data-slot=dialog-close]]:text-white"
			>
				<div
					className="flex min-h-42 flex-col justify-end px-6 pt-10 pb-5.5"
					style={{ background: HERO_BACKGROUND }}
				>
					<p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[oklch(0.88_0.09_315)]">
						What's new in Cline
					</p>
					<DialogTitle className="mt-1.5 text-2xl font-semibold tracking-tight text-white">
						{release.title}
					</DialogTitle>
				</div>
				<div className="px-6 pt-5 pb-5">
					<ul className="grid grid-cols-2 gap-x-6 gap-y-5">
						{release.highlights.map((highlight) => (
							<li key={highlight.title}>
								<highlight.icon className="size-4.5 text-primary" />
								<p className="mt-2 text-sm font-semibold text-foreground">
									{highlight.title}
								</p>
								<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
									{highlight.description}
								</p>
							</li>
						))}
					</ul>
					<div className="mt-5 flex items-center justify-between border-t pt-3.5">
						{onShowAllChanges ? (
							<Button
								className="-ml-2 text-muted-foreground"
								onClick={onShowAllChanges}
								size="sm"
								type="button"
								variant="ghost"
							>
								See all changes
								<ArrowRight className="size-3.5" />
							</Button>
						) : (
							<span />
						)}
						<Button onClick={() => onOpenChange(false)} type="button">
							Get Started
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
