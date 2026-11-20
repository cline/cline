"use client";

import { clsx } from "clsx";
import {
	type ComponentPropsWithoutRef,
	type ComponentType,
	type CSSProperties,
	forwardRef,
	type MouseEventHandler,
	type ReactNode,
	type SVGProps,
	useContext,
	useLayoutEffect,
	useState,
} from "react";
import { ButtonControl } from "./button-control.js";
import { DetailListColumnsContext } from "./detail-list.js";
import { hasContent } from "./has-content.js";

export interface DetailListItemPrimaryAction {
	onClick: MouseEventHandler<HTMLButtonElement>;
	label?: string;
	disabled?: boolean;
}

export interface DetailListItemProps
	extends Omit<ComponentPropsWithoutRef<"div">, "title" | "children"> {
	/** Primary label. Use display content only when primaryAction is supplied. */
	title: ReactNode;
	/** Optional decorative SVG component. The item owns its size, color, and spacing. */
	leadingIcon?: ComponentType<SVGProps<SVGSVGElement>>;
	/** An optional count beside the title. Zero remains visible. */
	count?: number;
	/** Supporting text below the title. */
	description?: ReactNode;
	/** A value or secondary text, aligned to the end on wide containers. */
	trailingText?: ReactNode;
	/** Independent trailing controls or links; consumers own their behavior. */
	actions?: ReactNode;
	/** Values keyed by the containing list's columns; missing values display an em dash. */
	values?: Readonly<Record<string, ReactNode>>;
	/** Activates the row, except independent controls. Adds no hover preview. */
	primaryAction?: DetailListItemPrimaryAction;
}

/** A detail item with an optional leading icon and count. Render inside a DetailList. */
export const DetailListItem = forwardRef<HTMLDivElement, DetailListItemProps>(
	function DetailListItem(
		{
			title,
			leadingIcon: LeadingIcon,
			count,
			description,
			trailingText,
			actions,
			values,
			primaryAction,
			className,
			style,
			...props
		},
		ref,
	) {
		const columns = useContext(DetailListColumnsContext);
		const hasColumns = columns.length > 0;
		const hasDescription = hasContent(description);
		const hasTrailingText = hasContent(trailingText);
		const hasActions = hasContent(actions);
		const [trailingElement, setTrailingElement] = useState<HTMLElement | null>(
			null,
		);
		const [stacked, setStacked] = useState(false);

		useLayoutEffect(() => {
			const row = trailingElement?.parentElement;
			if (!row || !trailingElement || hasColumns) return;
			const measure = () => {
				if (!row.clientWidth) return;
				const rowStyle = getComputedStyle(row);
				const availableWidth =
					row.clientWidth -
					Number.parseFloat(rowStyle.paddingLeft || "0") -
					Number.parseFloat(rowStyle.paddingRight || "0");
				const gap = Number.parseFloat(rowStyle.columnGap) || 0;
				const rem = Number.parseFloat(
					getComputedStyle(row.ownerDocument.documentElement).fontSize,
				);
				// Reserve 18rem for the icon and text. Measure the trailing slot in
				// both layouts so expanding the label after stacking cannot undo it.
				setStacked(
					availableWidth - trailingElement.offsetWidth - gap < 18 * rem,
				);
			};
			measure();
			if (typeof ResizeObserver === "undefined") return;
			const observer = new ResizeObserver(measure);
			observer.observe(row);
			observer.observe(trailingElement);
			return () => observer.disconnect();
		}, [trailingElement, hasColumns]);

		const titleContent = (
			<>
				{title}
				{count !== undefined ? (
					<span
						className="cline-ui-detail-list-item__count"
						data-slot="detail-list-item-count"
					>
						{count}
					</span>
				) : null}
			</>
		);
		const label = LeadingIcon ? (
			<>
				<LeadingIcon
					aria-hidden="true"
					className="cline-ui-detail-list-item__icon"
					focusable="false"
				/>
				<span className="cline-ui-detail-list-item__title-content">
					{titleContent}
				</span>
			</>
		) : (
			titleContent
		);
		return (
			<div
				{...props}
				ref={ref}
				className={clsx("cline-ui-detail-list-item", className)}
				data-slot="detail-list-item"
				data-has-leading-icon={LeadingIcon ? "true" : undefined}
				data-has-description={hasDescription ? "true" : undefined}
				data-has-trailing-text={hasTrailingText ? "true" : undefined}
				data-has-actions={hasActions ? "true" : undefined}
				data-layout={hasColumns ? "columns" : undefined}
				data-stacked={!hasColumns && stacked ? "true" : undefined}
				data-has-primary-action={primaryAction ? "true" : undefined}
				style={
					hasColumns
						? ({
								"--cline-ui-detail-list-item-row-span":
									1 + Number(hasDescription) + Number(hasTrailingText),
								...style,
							} as CSSProperties)
						: style
				}
			>
				<dt className="cline-ui-detail-list-item__title">
					{primaryAction ? (
						<ButtonControl
							className="cline-ui-detail-list-item__primary"
							pressScale={false}
							data-slot="detail-list-item-primary"
							onClick={primaryAction.onClick}
							disabled={primaryAction.disabled}
							aria-label={primaryAction.label}
						>
							{label}
						</ButtonControl>
					) : (
						label
					)}
				</dt>
				{hasDescription ? (
					<dd className="cline-ui-detail-list-item__description">
						{description}
					</dd>
				) : null}
				{hasColumns ? (
					<>
						{hasTrailingText ? (
							<dd
								className="cline-ui-detail-list-item__supplement"
								data-slot="detail-list-item-trailing-text"
								style={{ gridRow: hasDescription ? 3 : 2 }}
							>
								{trailingText}
							</dd>
						) : null}
						<dd className="cline-ui-detail-list-item__values">
							<dl className="cline-ui-detail-list-item__fields">
								{columns.map((column) => (
									<div
										key={column.key}
										data-slot="detail-list-item-value"
										data-column={column.key}
									>
										<dt className="cline-ui-detail-list-item__value-label">
											{column.label}
										</dt>
										<dd className="cline-ui-detail-list-item__value-content">
											{hasContent(values?.[column.key])
												? values?.[column.key]
												: "—"}
										</dd>
									</div>
								))}
							</dl>
						</dd>
						<dd className="cline-ui-detail-list-item__column-actions">
							{hasActions ? (
								<div className="cline-ui-detail-list-item__actions">
									{actions}
								</div>
							) : null}
						</dd>
					</>
				) : hasTrailingText || hasActions || !hasDescription ? (
					<dd
						ref={setTrailingElement}
						className="cline-ui-detail-list-item__trailing"
					>
						{hasTrailingText ? (
							<div className="cline-ui-detail-list-item__trailing-text">
								{trailingText}
							</div>
						) : null}
						{hasActions ? (
							<div className="cline-ui-detail-list-item__actions">
								{actions}
							</div>
						) : null}
					</dd>
				) : null}
			</div>
		);
	},
);
