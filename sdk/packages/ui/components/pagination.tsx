"use client";

import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
	type ComponentPropsWithoutRef,
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Button, type ButtonSize, IconButton } from "./button.js";

export type PaginationSize = "xxs" | ButtonSize;

export interface PaginationProps
	extends Omit<
		ComponentPropsWithoutRef<"nav">,
		"children" | "defaultValue" | "onChange"
	> {
	/** Total pages. Zero hides the control. */
	pageCount: number;
	/** One-based page, when controlled. */
	page?: number;
	defaultPage?: number;
	onPageChange?: (page: number) => void;
	/** Total page/ellipsis slots, from 5 to 50. Defaults to 5. Excludes arrows. */
	visiblePages?: number;
	/** xxs adds a compact 1.5rem height at default spacing. Defaults to xs. */
	size?: PaginationSize;
	disabled?: boolean;
	previousLabel?: string;
	nextLabel?: string;
	getPageLabel?: (page: number) => string;
}

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));
const integer = (value: number, fallback: number) =>
	Number.isFinite(value) ? Math.floor(value) : fallback;
const pageLabel = (page: number) => `Go to page ${page}`;
const useBrowserLayoutEffect =
	typeof window === "undefined" ? useEffect : useLayoutEffect;

/** A bounded number strip with a sliding rounded selection. Hosts own page data. */
export const Pagination = forwardRef<HTMLElement, PaginationProps>(
	(
		{
			pageCount,
			page,
			defaultPage = 1,
			onPageChange,
			visiblePages = 5,
			size = "xs",
			disabled = false,
			previousLabel = "Previous page",
			nextLabel = "Next page",
			getPageLabel = pageLabel,
			className,
			onFocusCapture,
			onBlurCapture,
			onKeyDown,
			"aria-label": ariaLabel = "Pagination",
			...props
		},
		ref,
	) => {
		const total = clamp(integer(pageCount, 0), 0, Number.MAX_SAFE_INTEGER);
		const slots = Math.min(total, clamp(integer(visiblePages, 5), 5, 50));
		const truncated = total > slots;
		const count = truncated ? slots - 4 : total;
		// Fixed boundary slots show adjacent numbers when no gap is needed.
		const firstPage = truncated ? 3 : 1;
		const lastPage = truncated ? total - 2 : total;
		const [uncontrolledPage, setUncontrolledPage] = useState(defaultPage);
		const current = clamp(integer(page ?? uncontrolledPage, 1), 1, total || 1);
		// Shrinking a result set must not resurrect an out-of-range page later.
		if (page === undefined && uncontrolledPage !== current) {
			setUncontrolledPage(current);
		}
		const lastStart = Math.max(firstPage, lastPage - count + 1);
		// Keep the selection centered until the window reaches either end.
		const start = clamp(current - Math.floor(count / 2), firstPage, lastStart);
		const height = "var(--cline-ui-pagination-height)";
		// Long page numbers widen the slots without changing the control height.
		const pageWidth = `max(${height}, ${String(total).length + 1}ch)`;

		const navRef = useRef<HTMLElement>(null);
		const trackRef = useRef<HTMLDivElement>(null);
		const interruptedTrack = useRef<{
			offset: number;
			step: number;
			renderStart: number;
		} | null>(null);
		const pageHasFocus = useRef(false);
		const previous = useRef({
			page: current,
			start,
			count,
			size,
			pageWidth,
		});
		useImperativeHandle(ref, () => navRef.current as HTMLElement);

		// Keep a viewport of overscan on both sides so rapid changes do not
		// remove numbers that are still visible in an interrupted slide.
		// This stays bounded even when jumping to a distant page.
		const overscan = Math.max(1, count - 1);
		const renderStart = Math.max(firstPage, start - overscan);
		const renderCount =
			Math.min(lastPage, start + count - 1 + overscan) - renderStart + 1;
		const buttonSize = size === "xxs" ? "xs" : size;
		const position = useCallback(
			(index: number) => `calc(${index} * ${pageWidth})`,
			[pageWidth],
		);

		// Restore focus after a page button is removed, even when the strip stays put.
		useBrowserLayoutEffect(() => {
			if (!navRef.current) {
				pageHasFocus.current = false;
				return;
			}
			if (
				pageHasFocus.current &&
				(previous.current.page !== current ||
					!navRef.current?.contains(document.activeElement))
			) {
				navRef.current
					?.querySelector<HTMLButtonElement>('[aria-current="page"]')
					?.focus({ preventScroll: true });
			}
		});

		useBrowserLayoutEffect(() => {
			const before = previous.current;
			const interrupted = interruptedTrack.current;
			interruptedTrack.current = null;
			previous.current = { page: current, start, count, size, pageWidth };
			const track = trackRef.current;
			if (
				(before.page === current && !interrupted) ||
				before.count !== count ||
				before.size !== size ||
				before.pageWidth !== pageWidth ||
				Math.abs(start - before.start) > overscan ||
				(before.start === start && !interrupted) ||
				!track?.animate ||
				!globalThis.matchMedia?.("(prefers-reduced-motion: no-preference)")
					.matches
			)
				return;
			// Rebase an interrupted strip to the new overscan origin without
			// jumping to its previous destination.
			const offset = interrupted
				? interrupted.offset +
					(renderStart - interrupted.renderStart) * interrupted.step
				: 0;
			// Snap a burst that has outrun the bounded overscan, avoiding blanks.
			if (
				interrupted &&
				(offset > 0 || offset < -(renderCount - count) * interrupted.step)
			)
				return;
			const from = interrupted
				? `${offset}px`
				: position(renderStart - before.start);
			// Transform movement keeps the strip's layout fixed during each frame.
			const animation = track.animate(
				[{ translate: from }, { translate: position(renderStart - start) }],
				{ duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
			);
			return () => {
				if (animation.playState === "running") {
					const style = getComputedStyle(track);
					const offset = Number.parseFloat(style.translate);
					const step = Number.parseFloat(style.gridAutoColumns);
					if (Number.isFinite(offset) && Number.isFinite(step) && step > 0)
						interruptedTrack.current = { offset, step, renderStart };
				}
				animation.cancel();
			};
		}, [
			current,
			start,
			count,
			size,
			pageWidth,
			overscan,
			renderStart,
			renderCount,
			position,
		]);

		const selectPage = (next: number) => {
			const selected = clamp(next, 1, total);
			if (disabled || selected === current) return;
			if (page === undefined) setUncontrolledPage(selected);
			onPageChange?.(selected);
		};

		if (!total) return null;
		const renderedPages = Array.from(
			{ length: renderCount },
			(_, index) => renderStart + index,
		);
		const end = start + count - 1;
		const selectedIndex =
			!truncated || current < firstPage
				? current - 1
				: current > lastPage
					? slots - (total - current) - 1
					: 2 + current - start;

		const renderPage = (number: number, visible = true) => (
			<div
				className="cline-ui-pagination__cell"
				key={number}
				style={{ inlineSize: pageWidth }}
			>
				{visible ? (
					<Button
						aria-current={number === current ? "page" : undefined}
						aria-label={getPageLabel(number)}
						className="cline-ui-pagination__page"
						data-page={number}
						disabled={disabled}
						onClick={() => selectPage(number)}
						pressScale={false}
						size={buttonSize}
						style={{ inlineSize: pageWidth, blockSize: "100%" }}
						tone="neutral"
						variant="ghost"
					>
						{number}
					</Button>
				) : (
					<span aria-hidden="true" className="cline-ui-pagination__outgoing">
						{number}
					</span>
				)}
			</div>
		);
		const ellipsis = (
			<span
				aria-hidden="true"
				className="cline-ui-pagination__cell cline-ui-pagination__ellipsis"
				style={{ inlineSize: pageWidth }}
			>
				…
			</span>
		);
		const row = (
			<div className="cline-ui-pagination__row">
				{truncated && renderPage(1)}
				{truncated && (start === firstPage ? renderPage(2) : ellipsis)}
				<div
					className="cline-ui-pagination__viewport"
					style={{ inlineSize: position(count), blockSize: height }}
				>
					<div
						className="cline-ui-pagination__track"
						ref={trackRef}
						style={{
							gridAutoColumns: pageWidth,
							translate: position(renderStart - start),
						}}
					>
						{renderedPages.map((number) =>
							renderPage(number, number >= start && number <= end),
						)}
					</div>
				</div>
				{truncated && (end === lastPage ? renderPage(total - 1) : ellipsis)}
				{truncated && renderPage(total)}
			</div>
		);

		return (
			<nav
				{...props}
				aria-label={ariaLabel}
				className={clsx(
					"cline-ui-pagination",
					size !== "xxs" && `cline-ui-control-size-${size}`,
					className,
				)}
				data-slot="pagination"
				data-size={size}
				data-disabled={disabled || undefined}
				ref={navRef}
				onFocusCapture={(event) => {
					pageHasFocus.current = (event.target as HTMLElement).hasAttribute(
						"data-page",
					);
					onFocusCapture?.(event);
				}}
				onBlurCapture={(event) => {
					if (
						!event.relatedTarget ||
						!event.currentTarget.contains(event.relatedTarget as Node)
					)
						pageHasFocus.current = false;
					onBlurCapture?.(event);
				}}
				onKeyDown={(event) => {
					onKeyDown?.(event);
					if (
						event.defaultPrevented ||
						event.altKey ||
						event.ctrlKey ||
						event.metaKey ||
						disabled ||
						!["Home", "End", "ArrowRight", "ArrowLeft"].includes(event.key) ||
						!(event.target as HTMLElement).hasAttribute("data-page")
					)
						return;
					const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
					const focused = Number((event.target as HTMLElement).dataset.page);
					const next =
						event.key === "Home"
							? 1
							: event.key === "End"
								? total
								: event.key === "ArrowRight"
									? focused + (rtl ? -1 : 1)
									: focused + (rtl ? 1 : -1);
					event.preventDefault();
					// Reselection does not rerender, so move focus independently.
					navRef.current
						?.querySelector<HTMLButtonElement>(
							`[data-page="${clamp(next, 1, total)}"]`,
						)
						?.focus({ preventScroll: true });
					selectPage(next);
				}}
			>
				<IconButton
					aria-label={previousLabel}
					className="cline-ui-pagination__arrow"
					disabled={disabled || current === 1}
					icon={ChevronLeft}
					onClick={() => selectPage(current - 1)}
					size={buttonSize}
				/>
				<div
					className="cline-ui-pagination__pages"
					style={{ inlineSize: position(slots), blockSize: height }}
				>
					{row}
					{/* Keep one text layer above the moving highlight. */}
					<div
						aria-hidden="true"
						className="cline-ui-pagination__marker"
						style={{
							inlineSize: pageWidth,
							translate: position(selectedIndex),
						}}
					/>
				</div>
				<IconButton
					aria-label={nextLabel}
					className="cline-ui-pagination__arrow"
					disabled={disabled || current === total}
					icon={ChevronRight}
					onClick={() => selectPage(current + 1)}
					size={buttonSize}
				/>
			</nav>
		);
	},
);
Pagination.displayName = "Pagination";
