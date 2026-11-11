import {
	type ReactNode,
	type RefObject,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib/utils";
import styles from "./item-details.module.css";
import { findScrollViewport, followScroll } from "./page-scroll";

const ACTION_FOCUS_TARGETS =
	'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export type ItemDetailsProps = {
	title: string;
	renderHeader: (
		titleRef: RefObject<HTMLHeadingElement | null>,
		headerActions: ReactNode,
	) => ReactNode;
	/** Actions beside the heading that remain available in the compact scroll header. */
	headerActions?: ReactNode;
	actions?: ReactNode;
	leadingActions?: ReactNode;
	feedback?: ReactNode;
	aside?: ReactNode;
	className?: string;
	children: ReactNode;
};

/** A detail page's content, with a compact scroll title and an optional supporting column. */
export function ItemDetails({
	title,
	renderHeader,
	headerActions,
	actions,
	leadingActions,
	feedback,
	aside,
	className,
	children,
}: ItemDetailsProps) {
	const layoutRef = useRef<HTMLDivElement>(null);
	const titleRef = useRef<HTMLHeadingElement>(null);
	const scrollHeaderRef = useRef<HTMLDivElement>(null);
	const inlineActionsRef = useRef<HTMLDivElement>(null);
	const stickyActionsRef = useRef<HTMLDivElement>(null);
	const scrollTitleVisibleRef = useRef(false);
	const pendingActionFocusRef = useRef<{
		source: HTMLElement;
		index: number;
		sticky: boolean;
	} | null>(null);
	const [showScrollTitle, setShowScrollTitle] = useState(false);
	const hasHeaderActions = Boolean(headerActions);
	const stickyActionsActive = showScrollTitle;
	useLayoutEffect(() => {
		const layout = layoutRef.current;
		const heading = titleRef.current;
		const scrollHeader = scrollHeaderRef.current;
		const viewport = findScrollViewport(layout);
		if (!layout || !heading || !scrollHeader || !viewport) return;
		const heightProperty = "--item-details-scroll-header-height";
		const previousHeight = viewport.style.getPropertyValue(heightProperty);
		const previousPriority = viewport.style.getPropertyPriority(heightProperty);

		/** The compact header's height only changes with its content, never by scrolling. */
		const syncScrollPadding = () => {
			const headerHeight = scrollHeader.getBoundingClientRect().height;
			if (headerHeight <= 0) return;
			const height = `${headerHeight}px`;
			if (viewport.style.getPropertyValue(heightProperty) !== height) {
				viewport.style.setProperty(heightProperty, height);
			}
		};
		const measureTitle = () => {
			const titleBottom =
				viewport.getBoundingClientRect().top +
				scrollHeader.getBoundingClientRect().height -
				Number.parseFloat(getComputedStyle(scrollHeader).paddingBottom || "0");
			const nextVisible = heading.getBoundingClientRect().bottom <= titleBottom;
			if (nextVisible === scrollTitleVisibleRef.current) return undefined;
			return () => {
				const source = nextVisible
					? inlineActionsRef.current
					: stickyActionsRef.current;
				const focused = document.activeElement;
				pendingActionFocusRef.current = null;
				if (focused instanceof HTMLElement && source?.contains(focused)) {
					const index = Array.from(
						source.querySelectorAll<HTMLElement>(ACTION_FOCUS_TARGETS),
					).indexOf(focused);
					if (index >= 0) {
						pendingActionFocusRef.current = {
							source: focused,
							index,
							sticky: nextVisible,
						};
					}
				}
				scrollTitleVisibleRef.current = nextVisible;
				setShowScrollTitle(nextVisible);
			};
		};
		const update = () => {
			const showOrHideTitle = measureTitle();
			syncScrollPadding();
			showOrHideTitle?.();
		};
		update();
		const stopFollowing = followScroll(viewport, measureTitle);
		const observer = new ResizeObserver(update);
		observer.observe(viewport);
		observer.observe(layout);
		observer.observe(heading);
		observer.observe(scrollHeader);
		return () => {
			stopFollowing();
			observer.disconnect();
			if (previousHeight) {
				viewport.style.setProperty(
					heightProperty,
					previousHeight,
					previousPriority,
				);
			} else {
				viewport.style.removeProperty(heightProperty);
			}
		};
	}, []);
	useLayoutEffect(() => {
		const pending = pendingActionFocusRef.current;
		pendingActionFocusRef.current = null;
		if (
			!pending ||
			pending.sticky !== stickyActionsActive ||
			(document.activeElement !== pending.source &&
				document.activeElement !== document.body)
		) {
			return;
		}
		const destination = stickyActionsActive
			? stickyActionsRef.current
			: inlineActionsRef.current;
		destination
			?.querySelectorAll<HTMLElement>(ACTION_FOCUS_TARGETS)
			[pending.index]?.focus({ preventScroll: true });
	}, [stickyActionsActive]);

	const inlineHeaderActions = hasHeaderActions ? (
		<div
			ref={inlineActionsRef}
			className={styles.headerActions}
			data-item-header-actions="inline"
			data-active={!stickyActionsActive}
			inert={stickyActionsActive}
			aria-hidden={stickyActionsActive || undefined}
		>
			{headerActions}
		</div>
	) : null;

	return (
		<div
			ref={layoutRef}
			className={cn(
				styles.layout,
				styles.page,
				Boolean(aside) && styles.withAside,
				className,
			)}
		>
			<div
				className={styles.scrollHeaderAnchor}
				aria-hidden={!hasHeaderActions || !stickyActionsActive || undefined}
			>
				<div
					ref={scrollHeaderRef}
					className={styles.scrollHeader}
					data-visible={showScrollTitle}
					data-scroll-fade={showScrollTitle}
					data-item-scroll-header=""
					data-tauri-drag-region="deep"
				>
					<div
						className={cn(
							styles.scrollTitle,
							"truncate font-cline-ui-medium text-foreground text-lg mt-0.5",
						)}
						aria-hidden="true"
					>
						{title}
					</div>
					{hasHeaderActions ? (
						<div
							ref={stickyActionsRef}
							className={styles.headerActions}
							data-item-header-actions="sticky"
							inert={!stickyActionsActive}
							aria-hidden={!stickyActionsActive || undefined}
						>
							{headerActions}
						</div>
					) : null}
				</div>
			</div>
			<header className={styles.header} data-tauri-drag-region="deep">
				{renderHeader(titleRef, inlineHeaderActions)}
				{leadingActions || actions ? (
					<div className={styles.actionBar}>
						{leadingActions}
						<div className={styles.actions}>{actions}</div>
					</div>
				) : null}
				{feedback}
			</header>

			{aside ? <div className={styles.aside}>{aside}</div> : null}

			<div className={styles.body}>{children}</div>
		</div>
	);
}
