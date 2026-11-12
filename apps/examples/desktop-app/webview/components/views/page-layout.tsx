import type { ComponentType, ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type PageFrameProps = {
	children: ReactNode;
	className?: string;
	contentClassName?: string;
	/**
	 * Lays the page out in the width it really has, not the window's: the
	 * content is never wider than the visible area (so `truncate` works), and
	 * padding follows the frame's own width through the `page` container,
	 * which a `fit` PageHeader inside also uses.
	 */
	fit?: boolean;
};

/**
 * Radix wraps the viewport's content in a `display: table` box that grows to
 * the content's intrinsic width; with no horizontal scrollbar, anything wider
 * than the viewport is cut off. A block box keeps the content to its width.
 */
export const PAGE_FRAME_FIT_VIEWPORT = "[&>div]:block!";

export function PageFrame({
	children,
	className,
	contentClassName,
	fit = false,
}: PageFrameProps) {
	return (
		<ScrollArea
			className={cn("h-full", fit && "@container/page")}
			viewportClassName={fit ? PAGE_FRAME_FIT_VIEWPORT : undefined}
			data-page-frame-fit={fit ? "" : undefined}
		>
			<div
				className={cn(
					fit
						? "px-4 py-5 @min-[720px]/page:px-8 @min-[720px]/page:py-10 @min-[1200px]/page:px-18"
						: "px-18 py-10 max-[1200px]:px-8 max-[720px]:px-4 max-[720px]:py-5",
					className,
				)}
			>
				<div className={cn("max-w-344", contentClassName)}>{children}</div>
			</div>
		</ScrollArea>
	);
}

type PageHeaderProps = {
	actions?: ReactNode;
	className?: string;
	/**
	 * Stacks below 860px of the enclosing `fit` PageFrame rather than of the
	 * window, and lets the actions wrap instead of pushing past the edge.
	 */
	fit?: boolean;
	description?: ReactNode;
	icon?: ComponentType<{ className?: string }>;
	meta?: ReactNode;
	title: ReactNode;
};

export function PageHeader({
	actions,
	className,
	description,
	fit = false,
	icon: Icon,
	meta,
	title,
}: PageHeaderProps) {
	return (
		<section
			className={cn(
				"mb-8 flex items-start justify-between gap-6",
				fit
					? "@max-[860px]/page:flex-col @max-[860px]/page:items-stretch"
					: "max-[860px]:flex-col max-[860px]:items-stretch",
				className,
			)}
		>
			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-3">
					{Icon ? <Icon className="size-8 shrink-0 text-primary" /> : null}
					<h1 className="truncate text-3xl font-semibold  text-foreground">
						{title}
					</h1>
					{meta}
				</div>
				{description ? (
					<p className="mt-3 max-w-2xl text-base text-muted-foreground">
						{description}
					</p>
				) : null}
			</div>
			{actions ? (
				<div
					data-page-header-actions
					className={cn(
						"flex flex-wrap items-center justify-end gap-2",
						fit
							? "min-w-0 @max-[860px]/page:justify-start"
							: "shrink-0 max-[860px]:justify-start",
					)}
				>
					{actions}
				</div>
			) : null}
		</section>
	);
}

type PageEmptyStateProps = {
	children: ReactNode;
	className?: string;
};

export function PageEmptyState({ children, className }: PageEmptyStateProps) {
	return (
		<div
			className={cn(
				"rounded-lg border border-dashed border-border bg-card px-5 py-4 text-sm leading-6 text-muted-foreground",
				className,
			)}
		>
			{children}
		</div>
	);
}

type CommandBadgeProps = {
	children: ReactNode;
	className?: string;
};

export function CommandBadge({ children, className }: CommandBadgeProps) {
	return (
		<span
			className={cn(
				"rounded-md border border-border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground",
				className,
			)}
		>
			{children}
		</span>
	);
}
