"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
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
	const { image } = release;
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
				{image ? (
					<div className="relative aspect-video max-h-80 w-full overflow-hidden border-b bg-muted sm:aspect-2/1">
						<img
							alt={image.alt}
							className={cn(
								"size-full object-cover object-top",
								image.dark && "dark:hidden",
							)}
							draggable={false}
							src={image.light}
						/>
						{image.dark ? (
							<img
								alt={image.alt}
								className="hidden size-full object-cover object-top dark:block"
								draggable={false}
								src={image.dark}
							/>
						) : null}
					</div>
				) : null}
				<div className="flex flex-col gap-5 p-6">
					<DialogHeader className="gap-1.5">
						<p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
							<Sparkles className="size-3.5" />
							What's new in Cline
						</p>
						<DialogTitle className="text-xl leading-tight">
							{release.title}
						</DialogTitle>
						<DialogDescription className="text-sm">
							{release.description}
						</DialogDescription>
					</DialogHeader>
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
						) : (
							<span />
						)}
						<Button onClick={() => onOpenChange(false)} size="sm" type="button">
							Continue
						</Button>
					</DialogFooter>
				</div>
			</DialogContent>
		</Dialog>
	);
}
