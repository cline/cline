"use client";

import { clsx } from "clsx";
import { X } from "lucide-react";
import {
	type ComponentPropsWithoutRef,
	forwardRef,
	type ReactNode,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import { Button, IconButton } from "./button.js";
import { hasContent } from "./has-content.js";

export type BannerTone = "neutral" | "info" | "success" | "warning" | "error";

export interface BannerAction
	extends Omit<
		ComponentPropsWithoutRef<"button">,
		"children" | "className" | "style" | "color" | "dangerouslySetInnerHTML"
	> {
	/** Stable identity, including when the label or disabled state changes. */
	id: string;
	label: ReactNode;
	/** Marks an action that removes or discards data. Other actions match the banner tone. */
	destructive?: boolean;
}

export interface BannerProps
	extends Omit<ComponentPropsWithoutRef<"div">, "title"> {
	tone?: BannerTone;
	size?: "sm" | "md";
	title?: ReactNode;
	/** Supporting content; children are used only when description is omitted. */
	description?: ReactNode;
	/** Optional leading icon. Mark decorative icons aria-hidden. */
	icon?: ReactNode;
	/** Actions in priority order. Banner owns their button size and appearance. */
	actions?: readonly BannerAction[];
	/** Shows a dismiss button. The host controls visibility when invoked. */
	onDismiss?: () => void;
	/** Accessible dismiss button label. Defaults to "Dismiss banner". */
	dismissLabel?: string;
}

/** A persistent inline notice. Hosts own visibility, actions, and async state. */
export const Banner = forwardRef<HTMLDivElement, BannerProps>(function Banner(
	{
		tone = "info",
		size = "md",
		title,
		children,
		description = children,
		icon,
		actions,
		onDismiss,
		dismissLabel = "Dismiss banner",
		role = tone === "error" ? "alert" : "status",
		className,
		...props
	},
	ref,
) {
	const hasTitle = hasContent(title);
	const hasDescription = hasContent(description);
	const hasIcon = hasContent(icon);
	const hasBody = hasTitle || hasDescription || hasIcon;
	const hasActions = Boolean(actions?.length);
	const isDismissible = Boolean(onDismiss);
	const bodyRef = useRef<HTMLDivElement>(null);
	const actionsRef = useRef<HTMLDivElement>(null);
	const [actionsWrapped, setActionsWrapped] = useState(false);

	useLayoutEffect(() => {
		const body = bodyRef.current;
		const actionRow = actionsRef.current;
		const banner = body?.parentElement;
		if (
			!isDismissible ||
			!hasBody ||
			!hasActions ||
			!body ||
			!actionRow ||
			!banner
		) {
			setActionsWrapped(false);
			return;
		}
		const measure = () => {
			const bodyBounds = body.getBoundingClientRect();
			const actionBounds = actionRow.getBoundingClientRect();
			setActionsWrapped(
				bodyBounds.height > 0 && actionBounds.top >= bodyBounds.bottom,
			);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(banner);
		observer.observe(body);
		observer.observe(actionRow);
		return () => observer.disconnect();
	}, [hasBody, hasActions, isDismissible]);

	return (
		<div
			{...props}
			ref={ref}
			role={role}
			className={clsx("cline-ui-banner", className)}
			data-slot="banner"
			data-tone={tone}
			data-size={size}
			data-dismissible={onDismiss ? "true" : undefined}
		>
			{hasBody ? (
				<div ref={bodyRef} className="cline-ui-banner__body">
					{hasIcon ? (
						<div className="cline-ui-banner__icon" data-slot="banner-icon">
							{icon}
						</div>
					) : null}
					<div className="cline-ui-banner__content">
						{hasTitle ? (
							<div className="cline-ui-banner__title" data-slot="banner-title">
								{title}
							</div>
						) : null}
						{hasDescription ? (
							<div
								className="cline-ui-banner__description"
								data-slot="banner-description"
							>
								{description}
							</div>
						) : null}
					</div>
				</div>
			) : null}
			{actions?.length ? (
				<div
					ref={actionsRef}
					className="cline-ui-banner__actions"
					data-slot="banner-actions"
					data-wrapped={actionsWrapped ? "true" : undefined}
				>
					{actions.map(({ id, label, destructive, ...buttonProps }) => (
						<Button
							{...buttonProps}
							key={id}
							className="cline-ui-banner__action"
							size={size === "sm" ? "sm" : "md"}
							tone={destructive ? "destructive" : "neutral"}
							variant="ghost"
						>
							{label}
						</Button>
					))}
				</div>
			) : null}
			{onDismiss ? (
				<IconButton
					icon={X}
					aria-label={dismissLabel}
					className="cline-ui-banner__dismiss"
					onClick={onDismiss}
					size={size === "sm" ? "xs" : "sm"}
					tone="neutral"
					variant="ghost"
				/>
			) : null}
		</div>
	);
});
