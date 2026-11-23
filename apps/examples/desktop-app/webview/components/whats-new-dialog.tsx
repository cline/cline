"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ConnectorLogo } from "@/components/views/settings/composio-connectors-view";
import { COMPOSIO_RECIPES } from "@/lib/composio-recipes";
import type { WhatsNewRelease } from "@/lib/whats-new-content";

// A fixed deep-violet hero in both themes: the brand glow reads the same on a
// light or dark dialog and keeps the white title at full contrast.
const HERO_BACKGROUND =
	"radial-gradient(120% 140% at 15% 0%, oklch(0.55 0.22 293) 0%, transparent 55%), radial-gradient(90% 120% at 100% 100%, oklch(0.45 0.16 275) 0%, transparent 60%), oklch(0.27 0.1 293)";

const SPOTLIGHT_CONNECTORS = [
	{ slug: "gmail", name: "Gmail" },
	{ slug: "slack", name: "Slack" },
	{ slug: "googlecalendar", name: "Google Calendar" },
	{ slug: "linear", name: "Linear" },
	{ slug: "sentry", name: "Sentry" },
	{ slug: "notion", name: "Notion" },
	{ slug: "github", name: "GitHub" },
];

/**
 * Catch-up dialog for a `WhatsNewRelease`. Shown once by the app shell after
 * an update that carries a new catch-up, and replayable from Settings → About.
 */
export function WhatsNewDialog({
	release,
	open,
	onOpenChange,
	onShowAllChanges,
	onOpenConnectors,
}: {
	release: WhatsNewRelease;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Omit when the dialog is opened from the About page itself. */
	onShowAllChanges?: () => void;
	onOpenConnectors: () => void;
}) {
	const spotlight = "spotlight" in release;
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent
				aria-describedby={undefined}
				className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto rounded-2xl p-0 outline-none sm:max-w-[560px] [&_[data-slot=dialog-close]]:text-white"
				// Focus the dialog itself so the first control doesn't open looking selected.
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					(event.currentTarget as HTMLElement).focus();
				}}
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
					{spotlight ? (
						<ConnectorsSpotlight onOpenConnectors={onOpenConnectors} />
					) : (
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
					)}
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
						{spotlight ? (
							<Button onClick={onOpenConnectors} type="button">
								Open Connectors
								<ArrowRight className="size-4" />
							</Button>
						) : (
							<Button onClick={() => onOpenChange(false)} type="button">
								Get Started
							</Button>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function ConnectorsSpotlight({
	onOpenConnectors,
}: {
	onOpenConnectors: () => void;
}) {
	const recipe = COMPOSIO_RECIPES.find(
		(candidate) => candidate.id === "organize-your-day",
	);
	return (
		<div className="grid gap-4">
			<div className="flex gap-2">
				{SPOTLIGHT_CONNECTORS.map((connector, index) => (
					<span
						className="animate-in fade-in slide-in-from-bottom-2 duration-500"
						key={connector.slug}
						style={{
							animationDelay: `${index * 60}ms`,
							animationFillMode: "both",
						}}
					>
						<ConnectorLogo
							className="size-9 rounded-lg border p-1.5 shadow-xs"
							name={connector.name}
							slug={connector.slug}
						/>
					</span>
				))}
			</div>
			<p className="text-sm leading-relaxed text-muted-foreground">
				Gmail, Slack, Calendar, Linear, Notion, and hundreds more, in one click.
				Cline pulls context from them and acts on your behalf.
			</p>
			{recipe ? (
				<button
					className="group grid cursor-pointer gap-1 rounded-xl border bg-muted/30 p-4 text-left transition-colors hover:border-foreground/20 hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
					onClick={onOpenConnectors}
					type="button"
				>
					<span className="flex items-center justify-between">
						<span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
							Example
						</span>
						<ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
					</span>
					<span className="text-sm font-semibold text-foreground">
						{recipe.title}
					</span>
					<span className="text-sm leading-relaxed text-muted-foreground">
						&ldquo;{recipe.prompt}&rdquo;
					</span>
					<span className="mt-2 flex flex-wrap gap-1.5">
						{recipe.connectors.map((connector) => (
							<span
								className="inline-flex h-6 items-center gap-1.5 rounded-md border bg-background px-2 text-xs text-foreground"
								key={connector.slug}
							>
								<ConnectorLogo
									className="size-3.5"
									name={connector.name}
									slug={connector.slug}
								/>
								{connector.name}
							</span>
						))}
					</span>
				</button>
			) : null}
		</div>
	);
}
