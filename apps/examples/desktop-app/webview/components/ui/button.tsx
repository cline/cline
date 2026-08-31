import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground hover:bg-primary/90",
				destructive:
					"bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
				outline:
					"border bg-background shadow-xs hover:bg-surface-hover hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-surface-hover",
				ghost:
					"hover:bg-surface-hover hover:text-foreground dark:hover:bg-surface-hover",
				link: "text-primary underline-offset-4 hover:underline",
				sidebar:
					"w-full text-left gap-2 rounded-none text-sm font-medium text-muted-foreground hover:bg-surface-hover hover:text-sidebar-foreground self-start",
				sidebarItem:
					"!h-auto w-full justify-start text-left gap-2 rounded-md !px-2 py-2 !text-sm font-medium text-muted-foreground hover:bg-surface-hover hover:text-sidebar-foreground",
				sidebarText:
					"!h-auto justify-start gap-1 px-3 py-1.5 !text-sm font-normal text-muted-foreground hover:text-sidebar-foreground",
				text: "bg-transparent text-sm font-medium text-muted-foreground hover:text-foreground",
			},
			size: {
				default: "h-9 px-4 py-2 has-[>svg]:pl-2 has-[>svg]:pr-2.5 text-base",
				sm: "h-8 gap-1.5 px-2.5 py-1.5 has-[>svg]:pl-2.5 has-[>svg]:pr-3 text-sm",
				// (has-[>svg]:size-3 was a leftover from when xs was a 12px micro
				// button; it collapsed any xs button containing an icon.)
				xs: "h-7 gap-1.5 px-2.5 py-1.5 has-[>svg]:px-2 text-xs",
				lg: "h-10 rounded-md px-6 has-[>svg]:px-4 text-lg",
				icon: "size-5",
				"icon-sm": "size-3 p-1",
				"icon-lg": "size-10",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant,
	size,
	asChild = false,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
	}) {
	const Comp = asChild ? Slot : "button";

	return (
		<Comp
			className={cn(buttonVariants({ variant, size, className }))}
			data-slot="button"
			{...props}
		/>
	);
}

export { Button, buttonVariants };
