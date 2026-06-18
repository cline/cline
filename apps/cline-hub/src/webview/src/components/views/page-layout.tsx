import type { ComponentType, ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type PageFrameProps = {
	children: ReactNode;
	className?: string;
	contentClassName?: string;
};

export function PageFrame({
	children,
	className,
	contentClassName,
}: PageFrameProps) {
	return (
		<ScrollArea className="h-full">
			<div
				className={cn(
					"px-18 py-10 max-[1200px]:px-8 max-[720px]:px-4 max-[720px]:py-5",
					className,
				)}
			>
				<div className={cn("max-w-[86rem]", contentClassName)}>{children}</div>
			</div>
		</ScrollArea>
	);
}

type PageHeaderProps = {
	actions?: ReactNode;
	className?: string;
	description?: ReactNode;
	icon?: ComponentType<{ className?: string }>;
	meta?: ReactNode;
	title: ReactNode;
};

export function PageHeader({
	actions,
	className,
	description,
	icon: Icon,
	meta,
	title,
}: PageHeaderProps) {
	return (
		<section
			className={cn(
				"mb-8 flex items-start justify-between gap-6 max-[860px]:flex-col max-[860px]:items-stretch",
				className,
			)}
		>
			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-3">
					{Icon ? <Icon className="size-8 shrink-0 text-primary" /> : null}
					<h1 className="truncate text-[32px] font-semibold leading-[1.15] tracking-normal text-foreground">
						{title}
					</h1>
					{meta}
				</div>
				{description ? (
					<p className="mt-3 max-w-2xl text-[15px] leading-6 text-muted-foreground">
						{description}
					</p>
				) : null}
			</div>
			{actions ? (
				<div className="flex shrink-0 flex-wrap items-center justify-end gap-2 max-[860px]:justify-start">
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
