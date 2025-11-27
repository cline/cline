import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

function ItemGroup({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("group/item-group flex flex-col", className)} data-slot="item-group" role="list" {...props} />
}

function ItemSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
	return <Separator className={cn("my-0", className)} data-slot="item-separator" orientation="horizontal" {...props} />
}

const itemVariants = cva(
	"group/item [a]:hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-ring/50 flex flex-wrap items-center rounded-sm border border-transparent text-sm outline-none focus-visible:ring-[3px]",
	{
		variants: {
			variant: {
				default: "bg-transparent",
				outline: "border-input-foreground/30",
				select: "bg-input-background/50 hover:bg-input-background/70 border border-input-foreground/10",
				muted: "bg-muted/50",
			},
			size: {
				default: "gap-1 p-2 ",
				sm: "gap-2.5 px-4 py-3",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
)

function Item({
	className,
	variant = "default",
	size = "default",
	asChild = false,
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof itemVariants> & { asChild?: boolean }) {
	const Comp = asChild ? Slot : "div"
	return (
		<Comp
			className={cn(itemVariants({ variant, size, className }))}
			data-size={size}
			data-slot="item"
			data-variant={variant}
			{...props}
		/>
	)
}

const itemMediaVariants = cva(
	"flex shrink-0 items-center justify-center gap-2 group-has-[[data-slot=item-description]]/item:translate-y-0.5 group-has-[[data-slot=item-description]]/item:self-start [&_svg]:pointer-events-none",
	{
		variants: {
			variant: {
				default: "bg-transparent",
				icon: "bg-transparent size-8 rounded-sm [&_svg:not([class*='size-'])]:size-4",
				image: "size-10 overflow-hidden rounded-sm [&_img]:size-full [&_img]:object-cover",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
)

function ItemMedia({
	className,
	variant = "default",
	selected = false,
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof itemMediaVariants> & { selected?: boolean }) {
	return (
		<div className={cn(itemMediaVariants({ variant, className }))} data-slot="item-media" data-variant={variant} {...props} />
	)
}

function ItemContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("w-full flex flex-1 flex-col gap-1 [&+[data-slot=item-content]]:flex-none", className)}
			data-slot="item-content"
			{...props}
		/>
	)
}

function ItemTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("w-full flex items-center gap-2 text-sm font-medium leading-snug", className)}
			data-slot="item-title"
			{...props}
		/>
	)
}

function ItemDescription({ className, ...props }: React.ComponentProps<"p">) {
	return (
		<p
			className={cn(
				"w-full text-muted-foreground line-clamp-2 text-pretty text-sm font-normal leading-normal p-0 m-0",
				"[&>a:hover]:text-foreground [&>a]:underline [&>a]:underline-offset-4",
				className,
			)}
			data-slot="item-description"
			{...props}
		/>
	)
}

function ItemActions({ className, ...props }: React.ComponentProps<"div">) {
	return <div className={cn("flex items-center gap-2", className)} data-slot="item-actions" {...props} />
}

function ItemHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("w-full flex basis-full items-center justify-between gap-2", className)}
			data-slot="item-header"
			{...props}
		/>
	)
}

function ItemFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div className={cn("flex basis-full items-center justify-between gap-2", className)} data-slot="item-footer" {...props} />
	)
}

export { Item, ItemMedia, ItemContent, ItemActions, ItemGroup, ItemSeparator, ItemTitle, ItemDescription, ItemHeader, ItemFooter }
