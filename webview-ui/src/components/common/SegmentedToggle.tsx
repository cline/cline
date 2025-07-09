import React, { useState, useEffect, useRef } from "react"

interface SegmentedToggleOption {
	value: string
	label: string
}

interface SegmentedToggleProps {
	options: SegmentedToggleOption[]
	value: string
	onChange: (value: string) => void
	className?: string
	disabled?: boolean
}

export const SegmentedToggle: React.FC<SegmentedToggleProps> = ({
	options,
	value,
	onChange,
	className = "",
	disabled = false,
}) => {
	const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({})
	const containerRef = useRef<HTMLDivElement>(null)
	const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

	// Update indicator position when value changes
	useEffect(() => {
		const activeIndex = options.findIndex((option) => option.value === value)
		if (activeIndex !== -1 && optionRefs.current[activeIndex] && containerRef.current) {
			const activeButton = optionRefs.current[activeIndex]
			const container = containerRef.current

			const containerRect = container.getBoundingClientRect()
			const buttonRect = activeButton.getBoundingClientRect()

			const left = buttonRect.left - containerRect.left
			const width = buttonRect.width

			setIndicatorStyle({
				left: `${left}px`,
				width: `${width}px`,
				transition: "all 0.2s ease-in-out",
			})
		}
	}, [value, options])

	// Initialize indicator position on mount and when options change
	useEffect(() => {
		// Small delay to ensure DOM is ready
		const timer = setTimeout(() => {
			const activeIndex = options.findIndex((option) => option.value === value)
			if (activeIndex !== -1 && optionRefs.current[activeIndex] && containerRef.current) {
				const activeButton = optionRefs.current[activeIndex]
				const container = containerRef.current

				const containerRect = container.getBoundingClientRect()
				const buttonRect = activeButton.getBoundingClientRect()

				const left = buttonRect.left - containerRect.left
				const width = buttonRect.width

				setIndicatorStyle({
					left: `${left}px`,
					width: `${width}px`,
					transition: "none", // No transition on initial load
				})
			}
		}, 0)

		return () => clearTimeout(timer)
	}, [options])

	const handleOptionClick = (optionValue: string) => {
		if (!disabled && optionValue !== value) {
			onChange(optionValue)
		}
	}

	return (
		<div
			ref={containerRef}
			className={`
				relative inline-flex
				bg-[var(--vscode-input-background)]
				border border-[var(--vscode-input-border)]
				rounded-md
				p-1
				${disabled ? "opacity-50 cursor-not-allowed" : ""}
				${className}
			`}
			role="radiogroup">
			{/* Sliding indicator */}
			<div
				className="
					absolute top-1 bottom-1
					bg-[var(--vscode-button-background)]
					rounded-sm
					pointer-events-none
					z-10
				"
				style={indicatorStyle}
			/>

			{/* Options */}
			{options.map((option, index) => {
				const isActive = option.value === value

				return (
					<button
						key={option.value}
						ref={(el) => (optionRefs.current[index] = el)}
						type="button"
						role="radio"
						aria-checked={isActive}
						disabled={disabled}
						className={`
							relative z-20
							px-3 py-1.5
							text-sm font-medium
							rounded-sm
							transition-colors duration-200
							focus:outline-none
							focus:ring-2 focus:ring-[var(--vscode-focusBorder)]
							focus:ring-offset-1
							${
								isActive
									? "text-[var(--vscode-button-foreground)]"
									: "text-[var(--vscode-foreground)] hover:text-[var(--vscode-button-foreground)]"
							}
							${disabled ? "cursor-not-allowed" : "cursor-pointer"}
						`}
						onClick={() => handleOptionClick(option.value)}>
						{option.label}
					</button>
				)
			})}
		</div>
	)
}
