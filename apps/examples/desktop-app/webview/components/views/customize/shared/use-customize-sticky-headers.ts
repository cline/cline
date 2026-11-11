import { useLayoutEffect, useRef } from "react";
import { useScrollHeaderFade } from "@/hooks/use-scroll-header-fade";
import { findScrollViewport, followScroll } from "../../shared/page-scroll";

/** The page header and toolbar parts the sticky category row is positioned against. */
function findStickyHeaderParts(content: HTMLElement, categories: HTMLElement) {
	const viewport = findScrollViewport(content);
	const header = viewport?.querySelector<HTMLElement>("[data-page-header]");
	const title = header?.querySelector("h1");
	return {
		viewport,
		header,
		headerContent: header?.firstElementChild,
		actions: header?.querySelector<HTMLElement>("[data-page-header-actions]"),
		title,
		titleBaseline: title?.querySelector<HTMLElement>(
			"[data-customize-title-baseline]",
		),
		pillBaseline: categories.querySelector<HTMLElement>(
			"[data-customize-pill-baseline]",
		),
		pills: categories.querySelector<HTMLElement>(
			"[data-customize-category-page]",
		),
		toolbarActions: categories.querySelector<HTMLElement>(
			"[data-customize-toolbar-actions]",
		),
	};
}

const lengthOf = (value: string | undefined) => Number.parseFloat(value ?? "");

/**
 * Width the pills and their toolbar actions need on a single line. Sums the
 * unwrapped items rather than reading scrollWidth, which changes when pills
 * wrap and would make the breakpoint oscillate on resize.
 */
function unwrappedToolbarWidth(
	pills: HTMLElement | null,
	toolbarActions: HTMLElement | null,
) {
	const items = Array.from(
		pills?.querySelectorAll<HTMLElement>("[role=radio]") ?? [],
	);
	const pillStyle = pills ? getComputedStyle(pills) : undefined;
	const row = pills?.parentElement;
	const pillsWidth =
		items.reduce(
			(width, item) => width + item.getBoundingClientRect().width,
			0,
		) +
		Math.max(0, items.length - 1) * (lengthOf(pillStyle?.columnGap) || 0) +
		(lengthOf(pillStyle?.paddingLeft) || 0) +
		(lengthOf(pillStyle?.paddingRight) || 0);
	return (
		pillsWidth +
		(toolbarActions?.getBoundingClientRect().width ?? 0) +
		(row ? lengthOf(getComputedStyle(row).columnGap) || 0 : 0)
	);
}

/**
 * Dock the category row beside the page header only when every control fits
 * without wrapping. Native sticky positioning owns the scroll threshold;
 * section headings stay below the row.
 */
export function useCustomizeStickyHeaders(pageScroll = true, enabled = true) {
	const contentRef = useRef<HTMLDivElement>(null);
	const categoriesRef = useRef<HTMLDivElement>(null);
	useScrollHeaderFade(categoriesRef, enabled);

	useLayoutEffect(() => {
		if (!enabled) return;
		const content = contentRef.current;
		const categories = categoriesRef.current;
		if (!content || !categories) return;
		const {
			viewport,
			header,
			headerContent,
			actions,
			title,
			titleBaseline,
			pillBaseline,
			pills,
			toolbarActions,
		} = findStickyHeaderParts(content, categories);
		let toolbarEnd = 0;
		let filterOffset: string | undefined;

		/**
		 * Align the filter to the content edge at rest, then clear the search
		 * field before entering its row. The pills keep their width and position.
		 */
		const measureFilterOffset = () => {
			const headerRect = header?.getBoundingClientRect();
			const progress = headerRect?.height
				? Math.max(
						0,
						Math.min(
							1,
							(categories.getBoundingClientRect().top - headerRect.bottom) /
								headerRect.height,
						),
					)
				: 0;
			const offset = `${toolbarEnd * progress}px`;
			// The offset only moves while the header collapses; restyling the whole
			// list for an unchanged value would cost a layout on every scroll.
			if (offset === filterOffset) return undefined;
			return () => {
				filterOffset = offset;
				content.style.setProperty("--customize-filter-offset", offset);
			};
		};

		const measure = () => {
			const gap = headerContent
				? lengthOf(getComputedStyle(headerContent).columnGap) || 24
				: 24;
			const contentRect = content.getBoundingClientRect();
			const actionsRect = actions?.getBoundingClientRect();
			const hasPills = Boolean(pills?.querySelector("[role=radio]"));
			const inline = Boolean(
				pageScroll &&
					hasPills &&
					actionsRect &&
					title &&
					title.getBoundingClientRect().right + gap <= contentRect.left &&
					actionsRect.left - gap - contentRect.left >=
						unwrappedToolbarWidth(pills, toolbarActions),
			);
			// The title and pills have separate sticky containers. Align their
			// text baselines rather than their differently sized control boxes.
			const toolbarTop =
				header && titleBaseline && pillBaseline
					? titleBaseline.getBoundingClientRect().top -
						header.getBoundingClientRect().top -
						(pillBaseline.getBoundingClientRect().top -
							categories.getBoundingClientRect().top)
					: 0;
			content.style.setProperty(
				"--customize-toolbar-top",
				inline ? `${toolbarTop}px` : "var(--page-content-top, 0px)",
			);
			toolbarEnd = inline
				? Math.max(0, contentRect.right - (actionsRect?.left ?? 0) + gap)
				: 0;
			content.style.setProperty("--customize-toolbar-end", `${toolbarEnd}px`);
			content.style.setProperty(
				"--customize-section-top",
				pageScroll
					? `max(var(--page-header-height, 0px), calc(var(--customize-toolbar-top) + ${categories.getBoundingClientRect().height}px))`
					: "0px",
			);
			measureFilterOffset()?.();
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(categories);
		observer.observe(content);
		if (headerContent) observer.observe(headerContent);
		if (title) observer.observe(title);
		if (actions) observer.observe(actions);
		if (toolbarActions) observer.observe(toolbarActions);
		for (const item of pills?.querySelectorAll("[role=radio]") ?? [])
			observer.observe(item);
		// Browse connectors may arrive after the first render.
		const mutationObserver = new MutationObserver(measure);
		if (pills) mutationObserver.observe(pills, { childList: true });
		const stopFollowing =
			pageScroll && viewport
				? followScroll(viewport, measureFilterOffset)
				: undefined;
		return () => {
			observer.disconnect();
			mutationObserver.disconnect();
			stopFollowing?.();
		};
	}, [pageScroll, enabled]);

	return { contentRef, categoriesRef };
}
