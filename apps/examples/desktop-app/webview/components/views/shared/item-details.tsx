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

export type ItemDetailsProps = {
	title: string;
	renderHeader: (
		titleRef: RefObject<HTMLHeadingElement | null>,
		headerActions: ReactNode,
	) => ReactNode;
	/** Actions rendered once beside the editable heading. */
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
	const scrollTitleVisibleRef = useRef(false);
	const [showScrollTitle, setShowScrollTitle] = useState(false);
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

	const inlineHeaderActions = headerActions ? (
		<div className={styles.headerActions} data-item-header-actions="inline">
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
			<div className={styles.scrollHeaderAnchor} aria-hidden="true">
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
