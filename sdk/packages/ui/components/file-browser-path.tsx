"use client";

import { ChevronRight } from "lucide-react";
import {
	Fragment,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

type PathEntry = number | "ellipsis";

const useBrowserLayoutEffect =
	typeof document === "undefined" ? useEffect : useLayoutEffect;

/** Keep the root and the closest parent folders when the full path cannot fit. */
export function fitFileBrowserPath(
	segmentWidths: readonly number[],
	availableWidth: number,
	separatorWidth: number,
	gap: number,
	ellipsisWidth: number,
): PathEntry[] {
	const entries = segmentWidths.map((_, index) => index);
	const fits = (items: PathEntry[]) =>
		items.reduce<number>(
			(width, item) =>
				width + (item === "ellipsis" ? ellipsisWidth : segmentWidths[item]),
			(items.length - 1) * (separatorWidth + gap * 2),
		) <= availableWidth;

	if (entries.length < 2 || fits(entries)) return entries;
	// Hide folders after the root, nearest the root first; always hide at least one.
	for (let start = 2; start < entries.length; start++) {
		const candidate: PathEntry[] = [0, "ellipsis", ...entries.slice(start)];
		if (fits(candidate)) return candidate;
	}
	const filename = entries.length - 1;
	return fits(["ellipsis", filename]) ? ["ellipsis", filename] : [filename];
}

export function FileBrowserPath({ path, id }: { path: string; id?: string }) {
	const segments = useMemo(() => path.split(/[\\/]+/).filter(Boolean), [path]);
	const containerRef = useRef<HTMLSpanElement>(null);
	const measureRef = useRef<HTMLSpanElement>(null);
	const [fitted, setFitted] = useState<{
		path: string;
		entries: PathEntry[];
	}>();
	const entries =
		fitted?.path === path ? fitted.entries : segments.map((_, index) => index);

	useBrowserLayoutEffect(() => {
		const container = containerRef.current;
		const measure = measureRef.current;
		if (!container || !measure) return;

		const update = () => {
			const availableWidth = container.getBoundingClientRect().width;
			if (availableWidth <= 0) return;
			const segmentWidths = Array.from(
				measure.querySelectorAll<HTMLElement>("[data-path-measure-segment]"),
				(segment) => segment.getBoundingClientRect().width,
			);
			const separatorWidth =
				measure
					.querySelector(".cline-ui-file-browser__path-separator")
					?.getBoundingClientRect().width ?? 0;
			const ellipsisWidth =
				measure
					.querySelector(".cline-ui-file-browser__path-ellipsis")
					?.getBoundingClientRect().width ?? 0;
			const gap = Number.parseFloat(getComputedStyle(measure).columnGap) || 0;
			const nextEntries = fitFileBrowserPath(
				segmentWidths,
				availableWidth,
				separatorWidth,
				gap,
				ellipsisWidth,
			);
			setFitted((previous) =>
				previous?.path === path &&
				previous.entries.length === nextEntries.length &&
				previous.entries.every((entry, index) => entry === nextEntries[index])
					? previous
					: { path, entries: nextEntries },
			);
		};

		update();
		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", update);
			return () => window.removeEventListener("resize", update);
		}
		const observer = new ResizeObserver(update);
		observer.observe(container);
		observer.observe(measure);
		return () => observer.disconnect();
	}, [path]);

	return (
		<span
			className="cline-ui-file-browser__path cline-ui-file-browser__breadcrumbs"
			id={id}
			ref={containerRef}
			title={path}
		>
			<span className="cline-ui-file-browser__path-full">{path}</span>
			<span aria-hidden="true" className="cline-ui-file-browser__path-visible">
				{entries.map((entry, index) => (
					<Fragment key={entry}>
						{index > 0 && (
							<ChevronRight className="cline-ui-file-browser__path-separator" />
						)}
						{entry === "ellipsis" ? (
							<span className="cline-ui-file-browser__path-ellipsis">…</span>
						) : (
							<span
								className="cline-ui-file-browser__path-segment"
								data-current={entry === segments.length - 1 || undefined}
							>
								{segments[entry]}
							</span>
						)}
					</Fragment>
				))}
			</span>
			<span
				aria-hidden="true"
				className="cline-ui-file-browser__path-measure"
				ref={measureRef}
			>
				{segments.map((segment, index) => (
					<Fragment key={segments.slice(0, index + 1).join("/")}>
						{index > 0 && (
							<ChevronRight className="cline-ui-file-browser__path-separator" />
						)}
						<span
							className="cline-ui-file-browser__path-segment"
							data-current={index === segments.length - 1 || undefined}
							data-path-measure-segment=""
						>
							{segment}
						</span>
					</Fragment>
				))}
				<span className="cline-ui-file-browser__path-ellipsis">…</span>
			</span>
		</span>
	);
}
