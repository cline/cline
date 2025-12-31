"use client"

import * as SelectPrimitive from "@radix-ui/react-select"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
	return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({ ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
	return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
	return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
	className,
	size = "default",
	children,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
	size?: "sm" | "default"
}) {
	return (
		<SelectPrimitive.Trigger
			className={cn(
				"border-editor-group-border data-[placeholder]:text-input-placeholder [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-editor-group-border focus-visible:ring-ring/20 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-error flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-2",
				className,
			)}
			data-size={size}
			data-slot="select-trigger"
			{...props}>
			{children}
			<SelectPrimitive.Icon asChild>
				<ChevronDownIcon className="size-4 opacity-50" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	)
}

function SelectContent({
	className,
	children,
	position = "popper",
	align = "center",
	...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				align={align}
				className={cn(
					"bg-menu text-menu-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xs border border-editor-group-border shadow-md",
					position === "popper" &&
						"data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
					className,
				)}
				data-slot="select-content"
				position={position}
				{...props}>
				<SelectScrollUpButton />
				<SelectPrimitive.Viewport
					className={cn(
						"p-1",
						position === "popper" &&
							"h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1",
					)}>
					{children}
				</SelectPrimitive.Viewport>
				<SelectScrollDownButton />
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	)
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
	return (
		<SelectPrimitive.Label
			className={cn("text-input-placeholder/80 px-2 py-1 text-sm", className)}
			data-slot="select-label"
			{...props}
		/>
	)
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
	return (
		<SelectPrimitive.Item
			className={cn(
				"focus:bg-button-background/50 focus:text-input [&_svg:not([class*='text-'])]:text-description relative flex w-full cursor-default items-center gap-2 rounded-xs py-1 pr-8 pl-2 text-xs outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-2 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
				className,
			)}
			data-slot="select-item"
			{...props}>
			<span className="absolute right-2 flex size-2 items-center justify-center" data-slot="select-item-indicator">
				<SelectPrimitive.ItemIndicator>
					<CheckIcon className="size-2" />
				</SelectPrimitive.ItemIndicator>
			</span>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	)
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
	return (
		<SelectPrimitive.Separator
			className={cn("bg-editor-group-border pointer-events-none -mx-1 my-1 h-px", className)}
			data-slot="select-separator"
			{...props}
		/>
	)
}

function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
	return (
		<SelectPrimitive.ScrollUpButton
			className={cn("flex cursor-default items-center justify-center py-1", className)}
			data-slot="select-scroll-up-button"
			{...props}>
			<ChevronUpIcon className="size-4" />
		</SelectPrimitive.ScrollUpButton>
	)
}

function SelectScrollDownButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
	return (
		<SelectPrimitive.ScrollDownButton
			className={cn("flex cursor-default items-center justify-center py-1", className)}
			data-slot="select-scroll-down-button"
			{...props}>
			<ChevronDownIcon className="size-4" />
		</SelectPrimitive.ScrollDownButton>
	)
}

export {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectScrollDownButton,
	SelectScrollUpButton,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
}
