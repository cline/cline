"use client";

import { Slot } from "@radix-ui/react-slot";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
	type ComponentProps,
	type ComponentPropsWithoutRef,
	cloneElement,
	createContext,
	forwardRef,
	type ReactElement,
	useContext,
} from "react";

export type TooltipProviderProps = ComponentProps<
	typeof TooltipPrimitive.Provider
>;

const TooltipProviderContext = createContext(false);

/** Share hover timing across a group of tooltips. */
export function TooltipProvider({
	delayDuration = 0,
	children,
	...props
}: TooltipProviderProps) {
	return (
		<TooltipProviderContext.Provider value={true}>
			<TooltipPrimitive.Provider delayDuration={delayDuration} {...props}>
				{children}
			</TooltipPrimitive.Provider>
		</TooltipProviderContext.Provider>
	);
}

export type TooltipProps = Pick<
	ComponentProps<typeof TooltipPrimitive.Content>,
	"side" | "align" | "sideOffset"
> & {
	content: string;
	children: ReactElement;
	/** Override the provider's hover delay; standalone tooltips default to 0. */
	delayDuration?: number;
	/** Mount inside a themed wrapper when the host uses scoped tokens. */
	portalContainer?: ComponentProps<typeof TooltipPrimitive.Portal>["container"];
};

// Radix Slot gives child props precedence, so merge descriptions before passing
// through its trigger props without introducing another DOM element.
const TooltipTrigger = forwardRef<
	HTMLElement,
	Omit<ComponentPropsWithoutRef<typeof Slot>, "children"> & {
		children: ReactElement;
	}
>(function TooltipTrigger(
	{ children, "aria-describedby": tooltipId, ...props },
	ref,
) {
	const child = children as ReactElement<{ "aria-describedby"?: string }>;
	const describedBy = [child.props["aria-describedby"], tooltipId]
		.filter(Boolean)
		.join(" ");
	return (
		<Slot {...props} ref={ref}>
			{cloneElement(child, { "aria-describedby": describedBy || undefined })}
		</Slot>
	);
});

/** Wrap one focusable element that forwards its ref and event props. */
export function Tooltip({
	content,
	children,
	side = "top",
	align = "center",
	sideOffset = 6,
	delayDuration,
	portalContainer,
}: TooltipProps) {
	const hasProvider = useContext(TooltipProviderContext);
	const tooltip = (
		<TooltipPrimitive.Root delayDuration={delayDuration}>
			<TooltipPrimitive.Trigger asChild>
				<TooltipTrigger>{children}</TooltipTrigger>
			</TooltipPrimitive.Trigger>
			<TooltipPrimitive.Portal container={portalContainer}>
				<TooltipPrimitive.Content
					className="cline-ui-tooltip__content"
					data-slot="tooltip-content"
					side={side}
					align={align}
					sideOffset={sideOffset}
					collisionPadding={8}
				>
					{content}
					<TooltipPrimitive.Arrow
						asChild
						className="cline-ui-tooltip__arrow"
						width={8}
						height={5}
					>
						<svg viewBox="0 0 8 5" aria-hidden="true">
							{/* Cover the content border at the base; outline only the sloping edges. */}
							<path d="M0 0H8V.5L4 5.5L0 .5Z" />
							<path
								className="cline-ui-tooltip__arrow-outline"
								d="M0 .5L4 5.5L8 .5"
							/>
						</svg>
					</TooltipPrimitive.Arrow>
				</TooltipPrimitive.Content>
			</TooltipPrimitive.Portal>
		</TooltipPrimitive.Root>
	);

	return hasProvider ? tooltip : <TooltipProvider>{tooltip}</TooltipProvider>;
}
