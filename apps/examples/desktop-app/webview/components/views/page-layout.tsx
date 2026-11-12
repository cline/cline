import {
	type ComponentPropsWithRef,
	type ComponentType,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useScrollHeaderFade } from "@/hooks/use-scroll-header-fade";
import { cn } from "@/lib/utils";
import styles from "./page-layout.module.css";
import { queryScrollViewports } from "./shared/page-scroll";

/** Responsive page gutters and header controls shared by top-level views. */
export function PageShell({
	className,
	...props
}: ComponentPropsWithRef<"div">) {
	return (
		<div
			{...props}
			className={cn("h-full overflow-hidden", styles.shell, className)}
		/>
	);
}

type PageFrameBaseProps = {
	children: ReactNode;
	className?: string;
	contentClassName?: string;
	/** Render a shared header that compacts as the page scrolls. */
	header?: Omit<PageHeaderProps, "compact">;
	/** Fade scrolling content beneath the pinned page header. */
	headerFade?: boolean;
	/** Content mode bounds children so they can own their scroll panes. */
	scrollMode?: "page" | "content";
	/** Reserve the native title bar's space until the page scrolls. */
	windowTitleBar?: boolean;
};

type PageFrameProps = PageFrameBaseProps &
	(
		| { navigation?: undefined; navigationLabel?: never }
		| { navigation: ReactNode; navigationLabel: string }
	);

export function PageFrame({
	children,
	className,
	contentClassName,
	header,
	headerFade = false,
	navigation,
	navigationLabel,
	scrollMode = "page",
	windowTitleBar = false,
}: PageFrameProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const headerRef = useRef<HTMLElement>(null);
	const navigationRef = useRef<HTMLElement>(null);
	const [scrolled, setScrolled] = useState(false);
	const hasHeader = Boolean(header);
	const hasNavigation = Boolean(navigation);
	const scrollPage = scrollMode === "page";
	useScrollHeaderFade(headerRef, headerFade && hasHeader && scrollPage);

	useLayoutEffect(() => {
		if (!hasHeader) return;
		const root = scrollRef.current;
		const headerElement = headerRef.current;
		const navigationElement = hasNavigation ? navigationRef.current : null;
		if (!root || !headerElement) return;
		const measure = () => {
			root.style.setProperty(
				"--page-header-height",
				`${headerElement.getBoundingClientRect().height}px`,
			);
			root.style.setProperty(
				"--page-navigation-height",
				`${navigationElement?.getBoundingClientRect().height ?? 0}px`,
			);
			root.style.setProperty(
				"--page-viewport-height",
				`${root.getBoundingClientRect().height}px`,
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(root);
		observer.observe(headerElement);
		if (navigationElement) observer.observe(navigationElement);
		return () => observer.disconnect();
	}, [hasHeader, hasNavigation]);

	// Reset when children take over scrolling without remounting header controls.
	useEffect(() => {
		if (!hasHeader || scrollPage) return;
		const [viewport] = queryScrollViewports(scrollRef.current);
		if (viewport) viewport.scrollTop = 0;
		setScrolled(false);
	}, [hasHeader, scrollPage]);

	const titleBar = windowTitleBar ? (
		<div
			aria-hidden="true"
			className="hidden h-(--window-title-bar-height) shrink-0 md:block"
			data-page-title-bar=""
			data-tauri-drag-region="deep"
		/>
	) : null;

	if (header) {
		return (
			<ScrollArea
				ref={scrollRef}
				data-page-frame=""
				className={cn(
					"[&>[data-slot=scroll-area-viewport]>div]:block! h-full min-w-0",
					"[--page-content-top:calc(var(--page-header-height)+var(--page-navigation-height))] lg:[--page-content-top:var(--page-header-height)]",
					!scrollPage && "[&>[data-slot=scroll-area-viewport]>div]:h-full",
				)}
				onScrollCapture={(event) => {
					if (
						scrollPage &&
						event.target === queryScrollViewports(scrollRef.current)[0]
					) {
						setScrolled((event.target as HTMLElement).scrollTop > 24);
					}
				}}
			>
				<div
					className={cn(
						"flex min-h-full min-w-0 flex-col",
						!scrollPage && "h-full pb-10",
						className,
					)}
				>
					{titleBar}
					<header
						ref={headerRef}
						data-page-header=""
						data-tauri-drag-region={windowTitleBar ? "deep" : undefined}
						className={cn(
							"z-30 shrink-0 p-2 sm:px-8 xl:px-18",
							// Important so a page shell's own gutters cannot undo the
							// room left for the Windows caption buttons.
							windowTitleBar && "in-data-windows-custom-titlebar:md:pr-44!",
							scrollPage && "sticky top-0 bg-background",
						)}
					>
						<PageHeader
							{...header}
							compact={scrollPage && scrolled}
							description={undefined}
							className={cn(
								"mb-0 min-h-9.5 max-w-344 items-center",
								windowTitleBar &&
									"[[data-slot=sidebar-wrapper][data-state=collapsed]_&]:md:pl-4",
								header.className,
							)}
						/>
					</header>
					<div
						data-page-body=""
						className={cn(
							"mb-12 flex min-w-0 flex-col px-4 sm:px-8 xl:px-18",
							!scrollPage && "min-h-0 flex-1",
						)}
					>
						{header.description ? (
							<p className="mb-8 max-w-2xl shrink-0 text-muted-foreground text-sm">
								{header.description}
							</p>
						) : null}
						<div
							data-page-layout=""
							className={cn(
								"flex w-full max-w-344 flex-col gap-6 lg:flex-row lg:gap-10",
								!scrollPage && "min-h-0 flex-1",
							)}
						>
							{navigation ? (
								<nav
									ref={navigationRef}
									data-page-navigation=""
									aria-label={navigationLabel}
									className={cn(
										"flex shrink-0 gap-1.5 lg:w-44 lg:flex-col lg:self-start",
										scrollPage &&
											"sticky top-(--page-header-height) z-20 -my-3 bg-background py-3",
									)}
								>
									{navigation}
								</nav>
							) : null}
							<div
								className={cn(
									"flex min-h-0 min-w-0 flex-1 flex-col",
									contentClassName,
								)}
							>
								{children}
							</div>
						</div>
					</div>
				</div>
			</ScrollArea>
		);
	}

	return (
		<ScrollArea className="h-full">
			{titleBar}
			<div
				className={cn(
					"px-18 py-10 max-[1200px]:px-8 max-[720px]:px-4 max-[720px]:py-5",
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
	compact?: boolean;
	description?: ReactNode;
	icon?: ComponentType<{ className?: string }>;
	meta?: ReactNode;
	title: ReactNode;
};

export function PageHeader({
	actions,
	className,
	compact,
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
				<div
					className={cn(
						"flex min-w-0 items-center gap-3",
						compact !== undefined && "h-8",
					)}
				>
					{Icon ? <Icon className="size-8 shrink-0 text-primary" /> : null}
					<h1
						className={cn(
							"min-w-0 truncate text-foreground",
							compact === undefined
								? "text-3xl font-semibold"
								: "font-cline-ui-medium transition-[font-size,line-height] duration-150 motion-reduce:transition-none",
							compact !== undefined && (compact ? "text-lg" : "text-2xl"),
						)}
					>
						{title}
					</h1>
					{meta}
				</div>
				{description ? (
					<p
						className={cn(
							"mt-3 max-w-2xl text-muted-foreground",
							compact === undefined ? "text-base" : "text-sm",
						)}
					>
						{description}
					</p>
				) : null}
			</div>
			{actions ? (
				<div
					data-page-header-actions=""
					className="flex shrink-0 flex-wrap items-center justify-end gap-2 max-[860px]:justify-start"
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
