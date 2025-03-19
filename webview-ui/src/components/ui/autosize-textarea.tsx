import * as React from "react"

import { cn } from "@/lib/utils"

interface UseAutosizeTextAreaProps {
	textAreaRef: React.MutableRefObject<HTMLTextAreaElement | null>
	minHeight?: number
	maxHeight?: number
	triggerAutoSize: string
}

export const useAutosizeTextArea = ({
	textAreaRef,
	triggerAutoSize,
	maxHeight = Number.MAX_SAFE_INTEGER,
	minHeight = 0,
}: UseAutosizeTextAreaProps) => {
	const [init, setInit] = React.useState(true)

	React.useEffect(() => {
		// We need to reset the height momentarily to get the correct scrollHeight
		// for the textarea.
		const offsetBorder = 6
		const textAreaElement = textAreaRef.current

		if (textAreaElement) {
			if (init) {
				textAreaElement.style.minHeight = `${minHeight + offsetBorder}px`

				if (maxHeight > minHeight) {
					textAreaElement.style.maxHeight = `${maxHeight}px`
				}

				setInit(false)
			}

			textAreaElement.style.height = `${minHeight + offsetBorder}px`
			const scrollHeight = textAreaElement.scrollHeight

			// We then set the height directly, outside of the render loop
			// Trying to set this with state or a ref will product an incorrect value.
			if (scrollHeight > maxHeight) {
				textAreaElement.style.height = `${maxHeight}px`
			} else {
				textAreaElement.style.height = `${scrollHeight + offsetBorder}px`
			}
		}
	}, [init, minHeight, maxHeight, textAreaRef, triggerAutoSize])
}

export type AutosizeTextAreaRef = {
	textArea: HTMLTextAreaElement
	minHeight: number
	maxHeight: number
}

type AutosizeTextAreaProps = {
	minHeight: number
	maxHeight: number
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>

export const AutosizeTextarea = React.forwardRef<AutosizeTextAreaRef, AutosizeTextAreaProps>(
	(
		{ minHeight, maxHeight, className, onChange, value, ...props }: AutosizeTextAreaProps,
		ref: React.Ref<AutosizeTextAreaRef>,
	) => {
		const textAreaRef = React.useRef<HTMLTextAreaElement | null>(null)
		const [triggerAutoSize, setTriggerAutoSize] = React.useState("")

		useAutosizeTextArea({
			textAreaRef,
			triggerAutoSize: triggerAutoSize,
			maxHeight,
			minHeight,
		})

		React.useImperativeHandle(ref, () => ({
			textArea: textAreaRef.current as HTMLTextAreaElement,
			focus: () => textAreaRef?.current?.focus(),
			maxHeight,
			minHeight,
		}))

		React.useEffect(() => {
			setTriggerAutoSize(value as string)
		}, [props?.defaultValue, value])

		return (
			<textarea
				{...props}
				value={value}
				ref={textAreaRef}
				className={cn(
					"flex w-full rounded-xs ring-offset-background placeholder:text-muted-foreground focus:outline-0 focus-visible:outline-none focus-visible:border-vscode-focusBorder disabled:cursor-not-allowed disabled:opacity-50 scrollbar-hide",
					"border-[var(--vscode-input-border,var(--vscode-input-background))] focus-visible:border-vscode-focusBorder",
					"bg-vscode-input-background",
					"text-vscode-input-foreground",
					className,
				)}
				onChange={(e) => {
					setTriggerAutoSize(e.target.value)
					onChange?.(e)
				}}
			/>
		)
	},
)
AutosizeTextarea.displayName = "AutosizeTextarea"
