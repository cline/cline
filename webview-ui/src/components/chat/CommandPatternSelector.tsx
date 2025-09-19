import React, { useState, useMemo } from "react"
import { Check, CheckCheck, ChevronUp, X } from "lucide-react"
import { cn } from "../../lib/utils"
import { useTranslation } from "react-i18next"
import { StandardTooltip } from "../ui/standard-tooltip"

interface CommandPattern {
	pattern: string
	description?: string
}

interface CommandPatternSelectorProps {
	patterns: CommandPattern[]
	allowedCommands: string[]
	deniedCommands: string[]
	onAllowPatternChange: (pattern: string) => void
	onDenyPatternChange: (pattern: string) => void
}

export const CommandPatternSelector: React.FC<CommandPatternSelectorProps> = ({
	patterns,
	allowedCommands,
	deniedCommands,
	onAllowPatternChange,
	onDenyPatternChange,
}) => {
	const { t } = useTranslation()
	const [isExpanded, setIsExpanded] = useState(false)
	const [editingStates, setEditingStates] = useState<Record<string, { isEditing: boolean; value: string }>>({})

	// Create a combined list with full command first, then patterns
	const allPatterns = useMemo(() => {
		// Create a set to track unique patterns we've already seen
		const seenPatterns = new Set<string>()

		// Filter out any patterns that are duplicates or are the same as the full command
		const uniquePatterns = patterns.filter((p) => {
			if (seenPatterns.has(p.pattern)) {
				return false
			}
			seenPatterns.add(p.pattern)
			return true
		})

		return uniquePatterns
	}, [patterns])

	const getPatternStatus = (pattern: string): "allowed" | "denied" | "none" => {
		if (allowedCommands.includes(pattern)) return "allowed"
		if (deniedCommands.includes(pattern)) return "denied"
		return "none"
	}

	const getEditState = (pattern: string) => {
		return editingStates[pattern] || { isEditing: false, value: pattern }
	}

	const setEditState = (pattern: string, isEditing: boolean, value?: string) => {
		setEditingStates((prev) => ({
			...prev,
			[pattern]: { isEditing, value: value ?? pattern },
		}))
	}

	return (
		<div className="border-t border-vscode-panel-border/50 bg-vscode-sideBar-background/30">
			<button
				onClick={() => setIsExpanded(!isExpanded)}
				className="w-full px-3 py-2 flex items-center justify-between hover:bg-vscode-list-hoverBackground transition-colors">
				<div className="group flex items-center gap-2 cursor-pointer w-full text-left">
					<span
						className={cn(
							"text-sm flex-1 group-hover:opacity-100",
							isExpanded ? "opacity-100" : "opacity-40",
						)}>
						<CheckCheck className="size-3 inline-block mr-2" />
						{t("chat:commandExecution.manageCommands")}
					</span>
					<ChevronUp
						className={cn(
							"group-hover:opacity-100 size-4 transition-transform",
							isExpanded ? "opacity-100" : "opacity-40 -rotate-180",
						)}
					/>
				</div>
			</button>

			{isExpanded && (
				<div className="pl-6 pr-2 pt-1 pb-2 space-y-2">
					{allPatterns.map((item) => {
						const editState = getEditState(item.pattern)
						const status = getPatternStatus(editState.value)

						return (
							<div key={item.pattern} className="flex items-center gap-2">
								<div className="flex-1">
									{editState.isEditing ? (
										<input
											type="text"
											value={editState.value}
											onChange={(e) => setEditState(item.pattern, true, e.target.value)}
											onBlur={() => setEditState(item.pattern, false)}
											onKeyDown={(e) => {
												if (e.key === "Enter") {
													setEditState(item.pattern, false)
												}
												if (e.key === "Escape") {
													setEditState(item.pattern, false, item.pattern)
												}
											}}
											className="font-mono text-xs bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded px-2 py-1.5 w-full focus:outline-0 focus:ring-1 focus:ring-vscode-focusBorder"
											placeholder={item.pattern}
											autoFocus
										/>
									) : (
										<div
											onClick={() => setEditState(item.pattern, true)}
											className="font-mono text-xs text-vscode-foreground cursor-pointer hover:bg-vscode-list-hoverBackground px-2 py-1.5 rounded transition-colors border border-transparent break-all"
											title="Click to edit pattern">
											<span className="break-all">{editState.value}</span>
											{item.description && (
												<span className="text-vscode-descriptionForeground ml-2">
													- {item.description}
												</span>
											)}
										</div>
									)}
								</div>
								<div className="flex items-center gap-1">
									<StandardTooltip
										content={t(
											status === "allowed"
												? "chat:commandExecution.removeFromAllowed"
												: "chat:commandExecution.addToAllowed",
										)}>
										<button
											className={cn("p-1 rounded transition-all cursor-pointer", {
												"bg-green-500/20 text-green-500 hover:bg-green-500/30":
													status === "allowed",
												"text-vscode-descriptionForeground hover:text-green-500 hover:bg-green-500/10":
													status !== "allowed",
											})}
											onClick={() => onAllowPatternChange(editState.value)}
											aria-label={t(
												status === "allowed"
													? "chat:commandExecution.removeFromAllowed"
													: "chat:commandExecution.addToAllowed",
											)}>
											<Check className="size-3.5" />
										</button>
									</StandardTooltip>
									<StandardTooltip
										content={t(
											status === "denied"
												? "chat:commandExecution.removeFromDenied"
												: "chat:commandExecution.addToDenied",
										)}>
										<button
											className={cn("p-1 rounded transition-all cursor-pointer", {
												"bg-red-500/20 text-red-500 hover:bg-red-500/30": status === "denied",
												"text-vscode-descriptionForeground hover:text-red-500 hover:bg-red-500/10":
													status !== "denied",
											})}
											onClick={() => onDenyPatternChange(editState.value)}
											aria-label={t(
												status === "denied"
													? "chat:commandExecution.removeFromDenied"
													: "chat:commandExecution.addToDenied",
											)}>
											<X className="size-3.5" />
										</button>
									</StandardTooltip>
								</div>
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
}
