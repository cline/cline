"use client";

import { clsx } from "clsx";
import {
	type ComponentPropsWithoutRef,
	type CSSProperties,
	createContext,
	forwardRef,
	type ReactNode,
} from "react";

export type DetailListColumnWidth =
	| number
	| `${number}px`
	| `${number}rem`
	| `${number}fr`;

export interface DetailListColumn {
	/** Stable key used to read each item's values. */
	key: string;
	/** Visible header and accessible label for each value. */
	label: ReactNode;
	/** Fixed px/rem or proportional fr width. Numbers are pixels; omitted widths use 1fr. */
	width?: DetailListColumnWidth;
}

export interface DetailListProps extends ComponentPropsWithoutRef<"dl"> {
	/** Opt into aligned entity rows. Omit or pass an empty array for ordinary details. */
	columns?: readonly DetailListColumn[];
	/** Label above the title column when columns are supplied. */
	titleLabel?: ReactNode;
	/** Space reserved for independent actions in column mode. Defaults to 4rem. */
	actionsWidth?: number | `${number}px` | `${number}rem`;
}

// Internal context also resets for nested ordinary lists.
export const DetailListColumnsContext = createContext<
	readonly DetailListColumn[]
>([]);

/** A bordered description list. Compose direct DetailListItem children. */
export const DetailList = forwardRef<HTMLDListElement, DetailListProps>(
	function DetailList(
		{
			className,
			children,
			columns = [],
			titleLabel = "Title",
			actionsWidth = "4rem",
			style,
			...props
		},
		ref,
	) {
		const hasColumns = columns.length > 0;
		const valueTracks = columns
			.map(({ width = "1fr" }) =>
				typeof width === "number"
					? `${width}px`
					: width.endsWith("fr")
						? `minmax(0, ${width})`
						: width,
			)
			.join(" ");
		const actionTrack =
			typeof actionsWidth === "number" ? `${actionsWidth}px` : actionsWidth;
		const columnStyle = hasColumns
			? ({
					"--cline-ui-detail-list-columns": [
						"minmax(0, 1fr)",
						valueTracks,
						actionTrack,
					].join(" "),
					"--cline-ui-detail-list-value-columns": valueTracks,
					"--cline-ui-detail-list-column-count": columns.length,
					"--cline-ui-detail-list-actions-width": actionTrack,
					...style,
				} as CSSProperties)
			: style;
		return (
			<DetailListColumnsContext.Provider value={columns}>
				<dl
					{...props}
					ref={ref}
					className={clsx("cline-ui-detail-list", className)}
					data-slot="detail-list"
					data-layout={hasColumns ? "columns" : undefined}
					style={columnStyle}
				>
					{hasColumns ? (
						<div
							className="cline-ui-detail-list__header"
							data-slot="detail-list-header"
							aria-hidden="true"
						>
							<dt>{titleLabel}</dt>
							{columns.map((column) => (
								<dd key={column.key}>{column.label}</dd>
							))}
							<dd />
						</div>
					) : null}
					{children}
				</dl>
			</DetailListColumnsContext.Provider>
		);
	},
);
