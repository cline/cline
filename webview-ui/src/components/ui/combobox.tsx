"use client"

import * as React from "react"
import { Slottable } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority"
import { Check, ChevronsUpDown, Loader, X } from "lucide-react"

import { cn } from "@/lib/utils"
import * as ComboboxPrimitive from "@/components/ui/combobox-primitive"
import { badgeVariants } from "@/components/ui/badge"
// import * as ComboboxPrimitive from "@/registry/default/ui/combobox-primitive"
import {
	InputBase,
	InputBaseAdornmentButton,
	InputBaseControl,
	InputBaseFlexWrapper,
	InputBaseInput,
} from "@/components/ui/input-base"

export const Combobox = ComboboxPrimitive.Root

const ComboboxInputBase = React.forwardRef<
	React.ElementRef<typeof InputBase>,
	React.ComponentPropsWithoutRef<typeof InputBase>
>(({ children, ...props }, ref) => (
	<ComboboxPrimitive.Anchor asChild>
		<InputBase ref={ref} {...props}>
			{children}
			<ComboboxPrimitive.Clear asChild>
				<InputBaseAdornmentButton>
					<X />
				</InputBaseAdornmentButton>
			</ComboboxPrimitive.Clear>
			<ComboboxPrimitive.Trigger asChild>
				<InputBaseAdornmentButton>
					<ChevronsUpDown />
				</InputBaseAdornmentButton>
			</ComboboxPrimitive.Trigger>
		</InputBase>
	</ComboboxPrimitive.Anchor>
))
ComboboxInputBase.displayName = "ComboboxInputBase"

export const ComboboxInput = React.forwardRef<
	React.ElementRef<typeof ComboboxPrimitive.Input>,
	React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Input>
>((props, ref) => (
	<ComboboxInputBase>
		<InputBaseControl>
			<ComboboxPrimitive.Input asChild>
				<InputBaseInput ref={ref} {...props} />
			</ComboboxPrimitive.Input>
		</InputBaseControl>
	</ComboboxInputBase>
))
ComboboxInput.displayName = "ComboboxInput"

export const ComboboxTagsInput = React.forwardRef<
	React.ElementRef<typeof ComboboxPrimitive.Input>,
	React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Input>
>(({ children, ...props }, ref) => (
	<ComboboxInputBase>
		<ComboboxPrimitive.ComboboxTagGroup asChild>
			<InputBaseFlexWrapper className="flex items-center gap-2">
				{children}
				<InputBaseControl>
					<ComboboxPrimitive.Input asChild>
						<InputBaseInput ref={ref} {...props} />
					</ComboboxPrimitive.Input>
				</InputBaseControl>
			</InputBaseFlexWrapper>
		</ComboboxPrimitive.ComboboxTagGroup>
	</ComboboxInputBase>
))
ComboboxTagsInput.displayName = "ComboboxTagsInput"

export const ComboboxTag = React.forwardRef<
	React.ElementRef<typeof ComboboxPrimitive.ComboboxTagGroupItem>,
	React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.ComboboxTagGroupItem>
>(({ children, className, ...props }, ref) => (
	<ComboboxPrimitive.ComboboxTagGroupItem
		ref={ref}
		className={cn(
			badgeVariants({ variant: "outline" }),
			"group gap-1 pr-1.5 data-[disabled]:opacity-50",
			className,
		)}
		{...props}>
		<Slottable>{children}</Slottable>
		<ComboboxPrimitive.ComboboxTagGroupItemRemove className="group-data-[disabled]:pointer-events-none">
			<X className="size-4" />
			<span className="sr-only">Remove</span>
		</ComboboxPrimitive.ComboboxTagGroupItemRemove>
	</ComboboxPrimitive.ComboboxTagGroupItem>
))
ComboboxTag.displayName = "ComboboxTag"

export const ComboboxContent = React.forwardRef<
	React.ElementRef<typeof ComboboxPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Content>
>(({ className, align = "start", alignOffset = 0, ...props }, ref) => (
	<ComboboxPrimitive.Portal>
		<ComboboxPrimitive.Content
			ref={ref}
			align={align}
			alignOffset={alignOffset}
			className={cn(
				"min-w-72 border-vscode-dropdown-border relative z-50 left-0 max-h-96 w-[--radix-popover-trigger-width] overflow-y-auto overflow-x-hidden rounded-xs border bg-popover p-1 text-popover-foreground shadow-md data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
				className,
			)}
			{...props}
		/>
	</ComboboxPrimitive.Portal>
))
ComboboxContent.displayName = "ComboboxContent"

export const ComboboxEmpty = React.forwardRef<
	React.ElementRef<typeof ComboboxPrimitive.Empty>,
	React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Empty>
>(({ className, ...props }, ref) => (
	<ComboboxPrimitive.Empty ref={ref} className={cn("py-6 text-center text-sm", className)} {...props} />
))
ComboboxEmpty.displayName = "ComboboxEmpty"

export const ComboboxLoading = React.forwardRef<
	React.ElementRef<typeof ComboboxPrimitive.Loading>,
	React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Loading>
>(({ className, ...props }, ref) => (
	<ComboboxPrimitive.Loading
		ref={ref}
		className={cn("flex items-center justify-center px-1.5 py-2", className)}
		{...props}>
		<Loader className="size-4 animate-spin [mask:conic-gradient(transparent_45deg,_white)]" />
	</ComboboxPrimitive.Loading>
))
ComboboxLoading.displayName = "ComboboxLoading"

export const ComboboxGroup = React.forwardRef<
	React.ElementRef<typeof ComboboxPrimitive.Group>,
	React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Group>
>(({ className, ...props }, ref) => (
	<ComboboxPrimitive.Group
		ref={ref}
		className={cn(
			"[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-sm [&_[cmdk-group-heading]]:font-semibold",
			className,
		)}
		{...props}
	/>
))
ComboboxGroup.displayName = "ComboboxGroup"

const ComboboxSeparator = React.forwardRef<
	React.ElementRef<typeof ComboboxPrimitive.Separator>,
	React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Separator>
>(({ className, ...props }, ref) => (
	<ComboboxPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
))
ComboboxSeparator.displayName = "ComboboxSeparator"

export const comboboxItemStyle = cva(
	"relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-vscode-dropdown-foreground data-[disabled=true]:opacity-50",
)

export const ComboboxItem = React.forwardRef<
	React.ElementRef<typeof ComboboxPrimitive.Item>,
	Omit<React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.Item>, "children"> &
		Pick<React.ComponentPropsWithoutRef<typeof ComboboxPrimitive.ItemText>, "children">
>(({ className, children, ...props }, ref) => (
	<ComboboxPrimitive.Item ref={ref} className={cn(comboboxItemStyle(), className)} {...props}>
		<ComboboxPrimitive.ItemText>{children}</ComboboxPrimitive.ItemText>
		<ComboboxPrimitive.ItemIndicator className="absolute right-2 flex size-3.5 items-center justify-center">
			<Check className="size-4" />
		</ComboboxPrimitive.ItemIndicator>
	</ComboboxPrimitive.Item>
))
ComboboxItem.displayName = "ComboboxItem"
