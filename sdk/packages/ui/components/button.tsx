"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import {
	type ComponentType,
	cloneElement,
	type ForwardedRef,
	forwardRef,
	isValidElement,
	type ReactNode,
	type SVGProps,
	useCallback,
	useLayoutEffect,
	useRef,
} from "react";
import { ButtonControl, type ButtonControlProps } from "./button-control.js";

// Defaults live in the component CSS layer so host utilities can override them.
const VARIANTS = {
	variant: {
		primary: "cline-ui-button-primary",
		secondary: "cline-ui-button-secondary",
		ghost: "cline-ui-button-ghost",
		/** @deprecated Use primary. */
		fill: "cline-ui-button-primary",
		/** @deprecated Use secondary. */
		surface: "cline-ui-button-secondary",
	},
	tone: {
		accent: "cline-ui-button-accent",
		neutral: "cline-ui-button-neutral",
		destructive: "cline-ui-button-destructive",
	},
	size: {
		xs: "cline-ui-button-xs",
		sm: "cline-ui-button-sm",
		md: "cline-ui-button-md",
		lg: "cline-ui-button-lg",
	},
};

const BUTTON_CONFIG = {
	variants: VARIANTS,
	defaultVariants: {
		variant: "primary",
		tone: "accent",
		size: "md",
	},
} as const;

const ICON_BUTTON_CONFIG = {
	variants: VARIANTS,
	defaultVariants: {
		variant: "ghost",
		tone: "neutral",
		size: "sm",
	},
} as const;

const buttonClasses = cva("cline-ui-button", BUTTON_CONFIG);
const iconButtonClasses = cva(
	"cline-ui-button cline-ui-icon-button",
	ICON_BUTTON_CONFIG,
);

// Consumers of the helpers supply their own content, so retain the legacy SVG
// defaults. React components opt into managed icons without sizing unrelated SVGs.
export const buttonVariants = cva(
	"cline-ui-button cline-ui-button-legacy-icons",
	BUTTON_CONFIG,
);
export const iconButtonVariants = cva(
	"cline-ui-button cline-ui-icon-button cline-ui-button-legacy-icons",
	ICON_BUTTON_CONFIG,
);

export type ButtonVariant = NonNullable<
	VariantProps<typeof buttonVariants>["variant"]
>;
export type ButtonTone = NonNullable<
	VariantProps<typeof buttonVariants>["tone"]
>;
export type ButtonSize = NonNullable<
	VariantProps<typeof buttonVariants>["size"]
>;

/** An SVG icon component that forwards its props to the SVG element. */
export type ButtonIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface ButtonProps
	extends ButtonControlProps,
		VariantProps<typeof buttonVariants> {
	leadingIcon?: ButtonIcon;
	trailingIcon?: ButtonIcon;
	/** Show a busy indicator without changing disabled behavior. */
	loading?: boolean;
	/** Replace the label while loading; defaults to the existing children. */
	loadingLabel?: ReactNode;
	/** Replace the default spinner. The button owns its rotation and reduced motion. */
	loadingIcon?: ButtonIcon;
	/** Color managed icons independently of the label. Defaults to inherit. */
	iconTone?: "inherit" | "muted";
}

function renderIcon(
	Icon: ButtonIcon | undefined,
	position: "leading" | "trailing" | "icon",
	loading = false,
) {
	return Icon ? (
		<Icon
			aria-hidden="true"
			className={`cline-ui-button__icon${loading ? " cline-ui-button__icon--loading" : ""}`}
			data-icon={position}
			focusable="false"
		/>
	) : null;
}

function composeContent(
	children: ReactNode,
	asChild: boolean | undefined,
	renderContent: (children: ReactNode) => ReactNode,
	loading = false,
) {
	if (!asChild) return renderContent(children);
	if (
		!isValidElement<Pick<ButtonControlProps, "children" | "aria-busy">>(
			children,
		)
	)
		return children;

	// Keep the actual target as Slot's only child so ButtonControl can preserve
	// its ref, native button type, and disabled event handling.
	return cloneElement(
		children,
		loading ? { "aria-busy": true } : undefined,
		renderContent(children.props.children),
	);
}

/** Animate content-driven width changes without changing the button's DOM or sizing. */
function useButtonWidthTransition(ref: ForwardedRef<HTMLButtonElement>) {
	const element = useRef<HTMLButtonElement | null>(null);
	const previous = useRef<{ node: HTMLElement; width: number } | null>(null);
	const animation = useRef<Animation | null>(null);
	const setRef = useCallback(
		(node: HTMLButtonElement | null) => {
			element.current = node;
			if (typeof ref === "function") {
				const cleanup: unknown = ref(node);
				if (typeof cleanup === "function") {
					return () => {
						element.current = null;
						cleanup();
					};
				}
			} else if (ref) {
				ref.current = node;
			}
			return undefined;
		},
		[ref],
	);

	useLayoutEffect(() => {
		const node = element.current;
		if (!node) return;
		// Computed width excludes pressScale and other transforms on the button.
		const measure = () => Number.parseFloat(getComputedStyle(node).width);
		const last = previous.current;
		const running =
			animation.current?.playState === "running" ? animation.current : null;
		const currentTime = running?.currentTime;
		const from =
			last?.node === node ? (running ? measure() : last.width) : undefined;
		animation.current?.cancel();
		animation.current = null;
		const width = measure();
		previous.current = { node, width };
		const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
		if (
			!motion?.matches &&
			node.animate &&
			from !== undefined &&
			from > 0 &&
			width > 0 &&
			Number.isFinite(from) &&
			Number.isFinite(width) &&
			Math.abs(from - width) > 0.5
		) {
			if (running && currentTime != null && last?.width === width) {
				// Unrelated parent renders must not restart the easing or duration.
				running.currentTime = currentTime;
				running.play();
				animation.current = running;
			} else {
				animation.current = node.animate(
					[
						{ width: `${from}px`, overflow: "clip" },
						{ width: `${width}px`, overflow: "clip" },
					],
					{ duration: 180, easing: "ease-out" },
				);
			}
		}

		// Keep the baseline current after layout/font changes, without observing
		// our animation frames as new content widths.
		const observer =
			typeof ResizeObserver === "undefined"
				? undefined
				: new ResizeObserver(() => {
						if (animation.current?.playState !== "running") {
							previous.current = { node, width: measure() };
						}
					});
		observer?.observe(node);
		const stopForReducedMotion = () => {
			if (motion?.matches) animation.current?.cancel();
		};
		motion?.addEventListener?.("change", stopForReducedMotion);
		return () => {
			observer?.disconnect();
			motion?.removeEventListener?.("change", stopForReducedMotion);
		};
	});
	useLayoutEffect(() => () => animation.current?.cancel(), []);
	return setRef;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	(
		{
			asChild,
			children,
			className,
			leadingIcon,
			trailingIcon,
			loading = false,
			loadingLabel,
			loadingIcon = LoaderCircle,
			iconTone = "inherit",
			size,
			tone,
			variant,
			...props
		},
		ref,
	) => {
		const animatedRef = useButtonWidthTransition(ref);
		const activeLeadingIcon = loading ? loadingIcon : leadingIcon;
		return (
			<ButtonControl
				{...props}
				aria-busy={loading || props["aria-busy"]}
				asChild={asChild}
				className={buttonClasses({
					className: [
						!activeLeadingIcon &&
							!trailingIcon &&
							"cline-ui-button-legacy-icons",
						className,
					],
					size,
					tone,
					variant,
				})}
				data-slot="button"
				data-icon-tone={iconTone}
				data-loading={loading || undefined}
				ref={animatedRef}
			>
				{/* Stable slots preserve label state when loading adds a leading icon. */}
				{composeContent(
					children,
					asChild,
					(label) => (
						<>
							{renderIcon(activeLeadingIcon, "leading", loading)}
							{loading && loadingLabel !== undefined ? loadingLabel : label}
							{renderIcon(trailingIcon, "trailing")}
						</>
					),
					loading,
				)}
			</ButtonControl>
		);
	},
);
Button.displayName = "Button";

export interface IconButtonProps
	extends Omit<ButtonProps, "leadingIcon" | "trailingIcon" | "loadingLabel"> {
	"aria-label": string;
	/** Managed icon content. When omitted, existing children render unchanged. */
	icon?: ButtonIcon;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
	(
		{
			asChild,
			children,
			className,
			icon,
			loading = false,
			loadingIcon = LoaderCircle,
			iconTone = "inherit",
			size,
			tone,
			variant,
			...props
		},
		ref,
	) => {
		const activeIcon = loading ? loadingIcon : icon;
		return (
			<ButtonControl
				{...props}
				aria-busy={loading || props["aria-busy"]}
				asChild={asChild}
				className={iconButtonClasses({
					className: [!activeIcon && "cline-ui-button-legacy-icons", className],
					size,
					tone,
					variant,
				})}
				data-slot="icon-button"
				data-icon-tone={iconTone}
				data-loading={loading || undefined}
				ref={ref}
			>
				{activeIcon
					? composeContent(
							children,
							asChild,
							() => renderIcon(activeIcon, "icon", loading),
							loading,
						)
					: children}
			</ButtonControl>
		);
	},
);
IconButton.displayName = "IconButton";
