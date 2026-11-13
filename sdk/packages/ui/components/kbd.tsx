"use client";

import { clsx } from "clsx";
import { forwardRef, type HTMLAttributes } from "react";

export interface KbdProps extends HTMLAttributes<HTMLElement> {}

/** A single keyboard key, following the shadcn Kbd component API. */
export const Kbd = forwardRef<HTMLElement, KbdProps>(
	({ className, ...props }, ref) => (
		<kbd
			{...props}
			className={clsx(
				"pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 rounded-cline-ui-sm bg-cline-ui-surface-hover-lighter px-1 font-sans font-medium text-cline-ui-muted-foreground text-cline-ui-xs [&_svg:not([class*='size-'])]:size-3",
				className,
			)}
			data-slot="kbd"
			ref={ref}
		/>
	),
);
Kbd.displayName = "Kbd";

export interface KbdGroupProps extends HTMLAttributes<HTMLElement> {}

/** Groups several Kbd keys that make up one shortcut. */
export const KbdGroup = forwardRef<HTMLElement, KbdGroupProps>(
	({ className, ...props }, ref) => (
		<kbd
			{...props}
			className={clsx("inline-flex items-center gap-1", className)}
			data-slot="kbd-group"
			ref={ref}
		/>
	),
);
KbdGroup.displayName = "KbdGroup";
