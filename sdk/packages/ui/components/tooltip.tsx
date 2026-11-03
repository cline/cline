"use client";

import { Slot } from "@radix-ui/react-slot";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
	type ComponentProps,
	type ComponentPropsWithoutRef,
	cloneElement,
	forwardRef,
	type ReactElement,
} from "react";

export type TooltipProps = Pick<
	ComponentProps<typeof TooltipPrimitive.Content>,
	"side" | "align" | "sideOffset"
> & {
	content: string;
	children: ReactElement;
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
	delayDuration = 0,
	portalContainer,
}: TooltipProps) {
	return (
		<TooltipPrimitive.Provider delayDuration={delayDuration}>
			<TooltipPrimitive.Root>
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
							className="cline-ui-tooltip__arrow"
							width={8}
							height={4}
						/>
					</TooltipPrimitive.Content>
				</TooltipPrimitive.Portal>
			</TooltipPrimitive.Root>
		</TooltipPrimitive.Provider>
	);
}
