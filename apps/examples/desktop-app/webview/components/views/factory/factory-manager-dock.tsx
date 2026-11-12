"use client";

import { ArrowLeft, Maximize2, SquarePen, X } from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { WorkspacePanelFrame } from "@/components/views/chat/workspace-panel-frame";
import { FACTORY_MANAGER } from "@/lib/factory-copy";

/** Below this Factory-area width the panel takes the whole area. */
const NARROW_WIDTH = 1040;

export const FACTORY_MANAGER_DOCK = {
	back: "Back to Factory",
	close: "Close Ask Factory",
	newConversation: "New conversation",
	openFullPage: "Open full page",
	about: (shortId: string) => `About ${shortId}`,
	dismissContext: (shortId: string) => `Don't send ${shortId} as context`,
} as const;

function isEditable(target: EventTarget): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			target.tagName === "TEXTAREA" ||
			target.tagName === "INPUT" ||
			target.tagName === "SELECT")
	);
}

/**
 * Factory with Ask Factory docked on its right. Both stay mounted while the
 * panel is hidden or covers a narrow Factory area, so the selected card, its
 * scroll and the conversation survive toggling.
 */
export function FactoryManagerDock({
	open,
	onClose,
	onNewConversation,
	onOpenFullPage,
	contextCard,
	onDismissContext,
	notice,
	main,
	panel,
}: {
	open: boolean;
	onClose: () => void;
	onNewConversation: () => void;
	onOpenFullPage: () => void;
	/** The card offered as context, shown as a dismissible chip. */
	contextCard?: { shortId: string } | null;
	onDismissContext: () => void;
	/** One line above the conversation, such as a proposed rule on another card. */
	notice?: ReactNode;
	main: ReactNode;
	panel: ReactNode;
}) {
	const host = useRef<HTMLDivElement>(null);
	const [narrow, setNarrow] = useState(false);
	useEffect(() => {
		const element = host.current;
		if (!element) return;
		const measure = () => {
			const width = element.getBoundingClientRect().width;
			if (width > 0) setNarrow(width < NARROW_WIDTH);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const takeover = open && narrow;
	const header = useRef<HTMLElement>(null);
	// Esc closes from the header, or anywhere but a text field while the panel
	// covers Factory; never from the composer. Menus portalled out of the
	// panel are not inside it and handle their own Esc.
	const closeOnEscape = (event: KeyboardEvent<HTMLElement>) => {
		const target = event.target;
		if (
			event.key !== "Escape" ||
			event.defaultPrevented ||
			!(target instanceof Node) ||
			!event.currentTarget.contains(target) ||
			!(header.current?.contains(target) || (takeover && !isEditable(target)))
		)
			return;
		event.preventDefault();
		onClose();
	};
	return (
		<div ref={host} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
			<div
				className="flex min-h-0 min-w-0 flex-1 flex-col"
				style={{ display: takeover ? "none" : "flex" }}
				inert={takeover || undefined}
				aria-hidden={takeover || undefined}
				data-testid="factory-manager-dock-main"
			>
				{main}
			</div>
			<WorkspacePanelFrame visible={open} narrow={narrow} panel="factory">
				<section
					aria-label={FACTORY_MANAGER.title}
					className="flex min-h-0 min-w-0 flex-1 flex-col [&_[data-testid=factory-manager-model-label]]:sr-only"
					onKeyDown={closeOnEscape}
				>
					<header
						ref={header}
						className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2"
					>
						{takeover ? (
							<Button variant="ghost" size="sm" onClick={onClose}>
								<ArrowLeft className="mr-1 size-4" />
								{FACTORY_MANAGER_DOCK.back}
							</Button>
						) : (
							<h2 className="truncate px-1 text-sm font-semibold">
								{FACTORY_MANAGER.title}
							</h2>
						)}
						{contextCard ? (
							<span className="ml-1 inline-flex shrink-0 items-center gap-0.5 rounded-full border bg-card py-0.5 pr-0.5 pl-2 text-xs text-muted-foreground">
								{FACTORY_MANAGER_DOCK.about(contextCard.shortId)}
								<button
									type="button"
									aria-label={FACTORY_MANAGER_DOCK.dismissContext(
										contextCard.shortId,
									)}
									className="rounded-full p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									onClick={onDismissContext}
								>
									<X className="size-3" />
								</button>
							</span>
						) : null}
						<span className="flex-1" />
						<Button
							variant="ghost"
							size="icon"
							className="size-8"
							aria-label={FACTORY_MANAGER_DOCK.newConversation}
							title={FACTORY_MANAGER_DOCK.newConversation}
							onClick={onNewConversation}
						>
							<SquarePen className="size-4" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="size-8"
							aria-label={FACTORY_MANAGER_DOCK.openFullPage}
							title={FACTORY_MANAGER_DOCK.openFullPage}
							onClick={onOpenFullPage}
						>
							<Maximize2 className="size-4" />
						</Button>
						{takeover ? null : (
							<Button
								variant="ghost"
								size="icon"
								className="size-8"
								aria-label={FACTORY_MANAGER_DOCK.close}
								title={FACTORY_MANAGER_DOCK.close}
								onClick={onClose}
							>
								<X className="size-4" />
							</Button>
						)}
					</header>
					{notice ? (
						<div
							className="shrink-0 border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
							data-testid="factory-manager-dock-notice"
						>
							{notice}
						</div>
					) : null}
					<div className="flex min-h-0 flex-1 flex-col">{panel}</div>
				</section>
			</WorkspacePanelFrame>
		</div>
	);
}
