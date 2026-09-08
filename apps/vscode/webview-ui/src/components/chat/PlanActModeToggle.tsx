import { useCallback } from "react"
import styled from "styled-components"
import { cn } from "@/lib/utils"

const PLAN_MODE_COLOR = "var(--vscode-activityWarningBadge-background)"
const ACT_MODE_COLOR = "var(--vscode-focusBorder)"

const SwitchContainer = styled.div`
	display: flex;
	align-items: center;
	background-color: transparent;
	border: 1px solid var(--vscode-input-border);
	border-radius: 12px;
	overflow: hidden;
	cursor: pointer;
	transform: scale(1);
	transform-origin: right center;
	margin-left: 0;
	user-select: none;
`

const Slider = styled.div.withConfig({
	shouldForwardProp: (prop) => !["isAct", "isPlan"].includes(prop),
})<{ isAct: boolean; isPlan?: boolean }>`
	position: absolute;
	height: 100%;
	width: 50%;
	background-color: ${(props) => (props.isPlan ? PLAN_MODE_COLOR : ACT_MODE_COLOR)};
	transition: transform 0.2s ease;
	transform: translateX(${(props) => (props.isAct ? "100%" : "0%")});
`

export type PlanActMode = "plan" | "act"

interface PlanActModeToggleProps {
	mode: PlanActMode
	onModeToggle: () => void
	onHover?: (mode: PlanActMode | null) => void
	className?: string
}

/**
 * Plan / Act mode selector.
 *
 * Exposed as a `radiogroup` so screen readers announce it as a single
 * mutually-exclusive choice rather than two independent switches (the
 * regression tracked in cline/cline#4932). The active option is the only
 * tab stop; arrow keys, Space, and Enter move/select the mode.
 */
const PlanActModeToggle = ({ mode, onModeToggle, onHover, className }: PlanActModeToggleProps) => {
	const onKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			const isToggleKey = event.key === "Enter" || event.key === " "
			if (isToggleKey) {
				event.preventDefault()
				onModeToggle()
				return
			}

			if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
				return
			}

			event.preventDefault()
			if (mode === "plan") {
				onModeToggle()
			}
		},
		[mode, onModeToggle],
	)

	const options: { label: string; value: PlanActMode; ariaLabel: string }[] = [
		{ label: "Plan", value: "plan", ariaLabel: "Plan mode" },
		{ label: "Act", value: "act", ariaLabel: "Act mode" },
	]

	return (
		<SwitchContainer
			aria-label="Mode selection"
			className={className}
			data-testid="mode-switch"
			onClick={onModeToggle}
			onKeyDown={onKeyDown}
			onMouseLeave={() => onHover?.(null)}
			role="radiogroup">
			<Slider isAct={mode === "act"} isPlan={mode === "plan"} />
			{options.map((option) => {
				const isActive = mode === option.value
				return (
					<div
						aria-checked={isActive}
						aria-label={option.ariaLabel}
						className={cn(
							"pt-0.5 pb-px px-2 z-10 text-xs w-1/2 text-center bg-transparent",
							isActive ? "text-white" : "text-input-foreground",
						)}
						key={option.value}
						onMouseEnter={() => onHover?.(option.value)}
						role="radio"
						tabIndex={isActive ? 0 : -1}>
						{option.label}
					</div>
				)
			})}
		</SwitchContainer>
	)
}

export default PlanActModeToggle
