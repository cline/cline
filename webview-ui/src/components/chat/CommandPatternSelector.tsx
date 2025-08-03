import React, { useState, useMemo } from "react"
import { Check, ChevronDown, Info, X } from "lucide-react"
import { cn } from "../../lib/utils"
import { useTranslation, Trans } from "react-i18next"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
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

	const handleOpenSettings = () => {
		window.postMessage({ type: "action", action: "settingsButtonClicked", values: { section: "autoApprove" } })
	}

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
		<div className="border-t border-vscode-panel-border bg-vscode-sideBar-background/30">
			<button
				onClick={() => setIsExpanded(!isExpanded)}
				className="w-full px-3 py-2 flex items-center justify-between hover:bg-vscode-list-hoverBackground transition-colors">
				<div className="flex items-center gap-2">
					<ChevronDown
						className={cn("size-4 transition-transform", {
							"-rotate-90": !isExpanded,
						})}
					/>
					<span className="text-sm font-medium">{t("chat:commandExecution.manageCommands")}</span>
					<StandardTooltip
						content={
							<div className="max-w-xs">
								<Trans
									i18nKey="chat:commandExecution.commandManagementDescription"
									components={{
										settingsLink: (
											<VSCodeLink
												href="#"
												onClick={(e) => {
													e.preventDefault()
													handleOpenSettings()
												}}
												className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground"
											/>
										),
									}}
								/>
							</div>
						}>
						<Info className="size-3.5 text-vscode-descriptionForeground" />
					</StandardTooltip>
				</div>
			</button>

			{isExpanded && (
				<div className="px-3 pb-3 space-y-2">
					{allPatterns.map((item) => {
						const editState = getEditState(item.pattern)
						const status = getPatternStatus(editState.value)

						return (
							<div key={item.pattern} className="ml-5 flex items-center gap-2">
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
									<button
										className={cn("p-1 rounded transition-all", {
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
									<button
										className={cn("p-1 rounded transition-all", {
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
								</div>
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
}
