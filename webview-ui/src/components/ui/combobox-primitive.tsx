/* eslint-disable react/jsx-pascal-case */
"use client"

import * as React from "react"
import { composeEventHandlers } from "@radix-ui/primitive"
import { useComposedRefs } from "@radix-ui/react-compose-refs"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { Primitive } from "@radix-ui/react-primitive"
import * as RovingFocusGroupPrimitive from "@radix-ui/react-roving-focus"
import { useControllableState } from "@radix-ui/react-use-controllable-state"
import { Command as CommandPrimitive } from "cmdk"

export type ComboboxContextProps = {
	inputValue: string
	onInputValueChange: (inputValue: string, reason: "inputChange" | "itemSelect" | "clearClick") => void
	onInputBlur?: (e: React.FocusEvent<HTMLInputElement, Element>) => void
	open: boolean
	onOpenChange: (open: boolean) => void
	currentTabStopId: string | null
	onCurrentTabStopIdChange: (currentTabStopId: string | null) => void
	inputRef: React.RefObject<HTMLInputElement>
	tagGroupRef: React.RefObject<React.ElementRef<typeof RovingFocusGroupPrimitive.Root>>
	disabled?: boolean
	required?: boolean
} & (
	| Required<Pick<ComboboxSingleProps, "type" | "value" | "onValueChange">>
	| Required<Pick<ComboboxMultipleProps, "type" | "value" | "onValueChange">>
)

const ComboboxContext = React.createContext<ComboboxContextProps>({
	type: "single",
	value: "",
	onValueChange: () => {},
	inputValue: "",
	onInputValueChange: () => {},
	onInputBlur: () => {},
	open: false,
	onOpenChange: () => {},
	currentTabStopId: null,
	onCurrentTabStopIdChange: () => {},
	inputRef: { current: null },
	tagGroupRef: { current: null },
	disabled: false,
	required: false,
})

export const useComboboxContext = () => React.useContext(ComboboxContext)

export type ComboboxType = "single" | "multiple"

export interface ComboboxBaseProps
	extends React.ComponentProps<typeof PopoverPrimitive.Root>,
		Omit<React.ComponentProps<typeof CommandPrimitive>, "value" | "defaultValue" | "onValueChange" | "children"> {
	type?: ComboboxType | undefined
	inputValue?: string
	defaultInputValue?: string
	onInputValueChange?: (inputValue: string, reason: "inputChange" | "itemSelect" | "clearClick") => void
	onInputBlur?: (e: React.FocusEvent<HTMLInputElement, Element>) => void
	disabled?: boolean
	required?: boolean
}

export type ComboboxValue<T extends ComboboxType = "single"> = T extends "single"
	? string
	: T extends "multiple"
		? string[]
		: never

export interface ComboboxSingleProps {
	type: "single"
	value?: string
	defaultValue?: string
	onValueChange?: (value: string) => void
}

export interface ComboboxMultipleProps {
	type: "multiple"
	value?: string[]
	defaultValue?: string[]
	onValueChange?: (value: string[]) => void
}

export type ComboboxProps = ComboboxBaseProps & (ComboboxSingleProps | ComboboxMultipleProps)

export const Combobox = React.forwardRef(
	<T extends ComboboxType = "single">(
		{
			type = "single" as T,
			open: openProp,
			onOpenChange,
			defaultOpen,
			modal,
			children,
			value: valueProp,
			defaultValue,
			onValueChange,
			inputValue: inputValueProp,
			defaultInputValue,
			onInputValueChange,
			onInputBlur,
			disabled,
			required,
			...props
		}: ComboboxProps,
		ref: React.ForwardedRef<React.ElementRef<typeof CommandPrimitive>>,
	) => {
		const [value = type === "multiple" ? [] : "", setValue] = useControllableState<ComboboxValue<T>>({
			prop: valueProp as ComboboxValue<T>,
			defaultProp: defaultValue as ComboboxValue<T>,
			onChange: onValueChange as (value: ComboboxValue<T>) => void,
		})
		const [inputValue = "", setInputValue] = useControllableState({
			prop: inputValueProp,
			defaultProp: defaultInputValue,
		})
		const [open = false, setOpen] = useControllableState({
			prop: openProp,
			defaultProp: defaultOpen,
			onChange: onOpenChange,
		})
		const [currentTabStopId, setCurrentTabStopId] = React.useState<string | null>(null)
		const inputRef = React.useRef<HTMLInputElement>(null)
		const tagGroupRef = React.useRef<React.ElementRef<typeof RovingFocusGroupPrimitive.Root>>(null)

		const handleInputValueChange: ComboboxContextProps["onInputValueChange"] = React.useCallback(
			(inputValue, reason) => {
				setInputValue(inputValue)
				onInputValueChange?.(inputValue, reason)
			},
			[setInputValue, onInputValueChange],
		)

		return (
			<ComboboxContext.Provider
				value={
					{
						type,
						value,
						onValueChange: setValue,
						inputValue,
						onInputValueChange: handleInputValueChange,
						onInputBlur,
						open,
						onOpenChange: setOpen,
						currentTabStopId,
						onCurrentTabStopIdChange: setCurrentTabStopId,
						inputRef,
						tagGroupRef,
						disabled,
						required,
					} as ComboboxContextProps
				}>
				<PopoverPrimitive.Root open={open} onOpenChange={setOpen} modal={modal}>
					<CommandPrimitive ref={ref} {...props}>
						{children}
						{!open && <CommandPrimitive.List aria-hidden hidden />}
					</CommandPrimitive>
				</PopoverPrimitive.Root>
			</ComboboxContext.Provider>
		)
	},
)
Combobox.displayName = "Combobox"

export const ComboboxTagGroup = React.forwardRef<
	React.ElementRef<typeof RovingFocusGroupPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof RovingFocusGroupPrimitive.Root>
>((props, ref) => {
	const { currentTabStopId, onCurrentTabStopIdChange, tagGroupRef, type } = useComboboxContext()

	if (type !== "multiple") {
		throw new Error('<ComboboxTagGroup> should only be used when type is "multiple"')
	}

	const composedRefs = useComposedRefs(ref, tagGroupRef)

	return (
		<RovingFocusGroupPrimitive.Root
			ref={composedRefs}
			tabIndex={-1}
			currentTabStopId={currentTabStopId}
			onCurrentTabStopIdChange={onCurrentTabStopIdChange}
			onBlur={() => onCurrentTabStopIdChange(null)}
			{...props}
		/>
	)
})
ComboboxTagGroup.displayName = "ComboboxTagGroup"

export interface ComboboxTagGroupItemProps
	extends React.ComponentPropsWithoutRef<typeof RovingFocusGroupPrimitive.Item> {
	value: string
	disabled?: boolean
}

const ComboboxTagGroupItemContext = React.createContext<Pick<ComboboxTagGroupItemProps, "value" | "disabled">>({
	value: "",
	disabled: false,
})

const useComboboxTagGroupItemContext = () => React.useContext(ComboboxTagGroupItemContext)

export const ComboboxTagGroupItem = React.forwardRef<
	React.ElementRef<typeof RovingFocusGroupPrimitive.Item>,
	ComboboxTagGroupItemProps
>(({ onClick, onKeyDown, value: valueProp, disabled, ...props }, ref) => {
	const { value, onValueChange, inputRef, currentTabStopId, type } = useComboboxContext()

	if (type !== "multiple") {
		throw new Error('<ComboboxTagGroupItem> should only be used when type is "multiple"')
	}

	const lastItemValue = value.at(-1)

	return (
		<ComboboxTagGroupItemContext.Provider value={{ value: valueProp, disabled }}>
			<RovingFocusGroupPrimitive.Item
				ref={ref}
				onKeyDown={composeEventHandlers(onKeyDown, (event) => {
					if (event.key === "Escape") {
						inputRef.current?.focus()
					}
					if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault()
						inputRef.current?.focus()
					}
					if (event.key === "ArrowRight" && currentTabStopId === lastItemValue) {
						inputRef.current?.focus()
					}
					if (event.key === "Backspace" || event.key === "Delete") {
						onValueChange(value.filter((v) => v !== currentTabStopId))
						inputRef.current?.focus()
					}
				})}
				onClick={composeEventHandlers(onClick, () => disabled && inputRef.current?.focus())}
				tabStopId={valueProp}
				focusable={!disabled}
				data-disabled={disabled}
				active={valueProp === lastItemValue}
				{...props}
			/>
		</ComboboxTagGroupItemContext.Provider>
	)
})
ComboboxTagGroupItem.displayName = "ComboboxTagGroupItem"

export const ComboboxTagGroupItemRemove = React.forwardRef<
	React.ElementRef<typeof Primitive.button>,
	React.ComponentPropsWithoutRef<typeof Primitive.button>
>(({ onClick, ...props }, ref) => {
	const { value, onValueChange, type } = useComboboxContext()

	if (type !== "multiple") {
		throw new Error('<ComboboxTagGroupItemRemove> should only be used when type is "multiple"')
	}

	const { value: valueProp, disabled } = useComboboxTagGroupItemContext()

	return (
		<Primitive.button
			ref={ref}
			aria-hidden
			tabIndex={-1}
			disabled={disabled}
			onClick={composeEventHandlers(onClick, () => onValueChange(value.filter((v) => v !== valueProp)))}
			{...props}
		/>
	)
})
ComboboxTagGroupItemRemove.displayName = "ComboboxTagGroupItemRemove"

export const ComboboxInput = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Input>,
	Omit<React.ComponentProps<typeof CommandPrimitive.Input>, "value" | "onValueChange">
>(({ onKeyDown, onMouseDown, onFocus, onBlur, ...props }, ref) => {
	const {
		type,
		inputValue,
		onInputValueChange,
		onInputBlur,
		open,
		onOpenChange,
		value,
		onValueChange,
		inputRef,
		disabled,
		required,
		tagGroupRef,
	} = useComboboxContext()

	const composedRefs = useComposedRefs(ref, inputRef)

	return (
		<CommandPrimitive.Input
			ref={composedRefs}
			disabled={disabled}
			required={required}
			value={inputValue}
			onValueChange={(search) => {
				if (!open) {
					onOpenChange(true)
				}
				// Schedule input value change to the next tick.
				setTimeout(() => onInputValueChange(search, "inputChange"))
				if (!search && type === "single") {
					onValueChange("")
				}
			}}
			onKeyDown={composeEventHandlers(onKeyDown, (event) => {
				if (event.key === "ArrowUp" || event.key === "ArrowDown") {
					if (!open) {
						event.preventDefault()
						onOpenChange(true)
					}
				}
				if (type !== "multiple") {
					return
				}
				if (event.key === "ArrowLeft" && !inputValue && value.length) {
					tagGroupRef.current?.focus()
				}
				if (event.key === "Backspace" && !inputValue) {
					onValueChange(value.slice(0, -1))
				}
			})}
			onMouseDown={composeEventHandlers(onMouseDown, () => onOpenChange(!!inputValue || !open))}
			onFocus={composeEventHandlers(onFocus, () => onOpenChange(true))}
			onBlur={composeEventHandlers(onBlur, (event) => {
				if (!event.relatedTarget?.hasAttribute("cmdk-list")) {
					onInputBlur?.(event)
				}
			})}
			{...props}
		/>
	)
})
ComboboxInput.displayName = "ComboboxInput"

export const ComboboxClear = React.forwardRef<
	React.ElementRef<typeof Primitive.button>,
	React.ComponentPropsWithoutRef<typeof Primitive.button>
>(({ onClick, ...props }, ref) => {
	const { value, onValueChange, inputValue, onInputValueChange, type } = useComboboxContext()

	const isValueEmpty = type === "single" ? !value : !value.length

	return (
		<Primitive.button
			ref={ref}
			disabled={isValueEmpty && !inputValue}
			onClick={composeEventHandlers(onClick, () => {
				if (type === "single") {
					onValueChange("")
				} else {
					onValueChange([])
				}
				onInputValueChange("", "clearClick")
			})}
			{...props}
		/>
	)
})
ComboboxClear.displayName = "ComboboxClear"

export const ComboboxTrigger = PopoverPrimitive.Trigger

export const ComboboxAnchor = PopoverPrimitive.Anchor

export const ComboboxPortal = PopoverPrimitive.Portal

export const ComboboxContent = React.forwardRef<
	React.ElementRef<typeof PopoverPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ children, onOpenAutoFocus, onInteractOutside, ...props }, ref) => (
	<PopoverPrimitive.Content
		asChild
		ref={ref}
		onOpenAutoFocus={composeEventHandlers(onOpenAutoFocus, (event) => event.preventDefault())}
		onCloseAutoFocus={composeEventHandlers(onOpenAutoFocus, (event) => event.preventDefault())}
		onInteractOutside={composeEventHandlers(onInteractOutside, (event) => {
			if (event.target instanceof Element && event.target.hasAttribute("cmdk-input")) {
				event.preventDefault()
			}
		})}
		{...props}>
		<CommandPrimitive.List>{children}</CommandPrimitive.List>
	</PopoverPrimitive.Content>
))
ComboboxContent.displayName = "ComboboxContent"

export const ComboboxEmpty = CommandPrimitive.Empty

export const ComboboxLoading = CommandPrimitive.Loading

export interface ComboboxItemProps extends Omit<React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>, "value"> {
	value: string
}

const ComboboxItemContext = React.createContext({ isSelected: false })

const useComboboxItemContext = () => React.useContext(ComboboxItemContext)

const findComboboxItemText = (children: React.ReactNode) => {
	let text = ""

	React.Children.forEach(children, (child) => {
		if (text) {
			return
		}

		if (React.isValidElement<{ children: React.ReactNode }>(child)) {
			if (child.type === ComboboxItemText) {
				text = child.props.children as string
			} else {
				text = findComboboxItemText(child.props.children)
			}
		}
	})

	return text
}

export const ComboboxItem = React.forwardRef<React.ElementRef<typeof CommandPrimitive.Item>, ComboboxItemProps>(
	({ value: valueProp, children, onMouseDown, ...props }, ref) => {
		const { type, value, onValueChange, onInputValueChange, onOpenChange } = useComboboxContext()

		const inputValue = React.useMemo(() => findComboboxItemText(children), [children])

		const isSelected = type === "single" ? value === valueProp : value.includes(valueProp)

		return (
			<ComboboxItemContext.Provider value={{ isSelected }}>
				<CommandPrimitive.Item
					ref={ref}
					onMouseDown={composeEventHandlers(onMouseDown, (event) => event.preventDefault())}
					onSelect={() => {
						if (type === "multiple") {
							onValueChange(
								value.includes(valueProp)
									? value.filter((v) => v !== valueProp)
									: [...value, valueProp],
							)
							onInputValueChange("", "itemSelect")
						} else {
							onValueChange(valueProp)
							onInputValueChange(inputValue, "itemSelect")
							// Schedule open change to the next tick.
							setTimeout(() => onOpenChange(false))
						}
					}}
					value={inputValue}
					{...props}>
					{children}
				</CommandPrimitive.Item>
			</ComboboxItemContext.Provider>
		)
	},
)
ComboboxItem.displayName = "ComboboxItem"

export const ComboboxItemIndicator = React.forwardRef<
	React.ElementRef<typeof Primitive.span>,
	React.ComponentPropsWithoutRef<typeof Primitive.span>
>((props, ref) => {
	const { isSelected } = useComboboxItemContext()

	if (!isSelected) {
		return null
	}

	return <Primitive.span ref={ref} aria-hidden {...props} />
})
ComboboxItemIndicator.displayName = "ComboboxItemIndicator"

export interface ComboboxItemTextProps extends React.ComponentPropsWithoutRef<typeof React.Fragment> {
	children: string
}

export const ComboboxItemText = (props: ComboboxItemTextProps) => <React.Fragment {...props} />
ComboboxItemText.displayName = "ComboboxItemText"

export const ComboboxGroup = CommandPrimitive.Group

export const ComboboxSeparator = CommandPrimitive.Separator

const Root = Combobox
const TagGroup = ComboboxTagGroup
const TagGroupItem = ComboboxTagGroupItem
const TagGroupItemRemove = ComboboxTagGroupItemRemove
const Input = ComboboxInput
const Clear = ComboboxClear
const Trigger = ComboboxTrigger
const Anchor = ComboboxAnchor
const Portal = ComboboxPortal
const Content = ComboboxContent
const Empty = ComboboxEmpty
const Loading = ComboboxLoading
const Item = ComboboxItem
const ItemIndicator = ComboboxItemIndicator
const ItemText = ComboboxItemText
const Group = ComboboxGroup
const Separator = ComboboxSeparator

export {
	Root,
	TagGroup,
	TagGroupItem,
	TagGroupItemRemove,
	Input,
	Clear,
	Trigger,
	Anchor,
	Portal,
	Content,
	Empty,
	Loading,
	Item,
	ItemIndicator,
	ItemText,
	Group,
	Separator,
}
