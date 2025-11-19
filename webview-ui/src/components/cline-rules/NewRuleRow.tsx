import { CreateHookRequest, RuleFileRequest } from "@shared/proto/index.cline"
import { PlusIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useClickAway } from "react-use"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"

interface NewRuleRowProps {
	isGlobal: boolean
	ruleType?: string
}

const HOOK_TYPES = [
	{ name: "TaskStart", description: "Executes when a new task begins" },
	{ name: "TaskResume", description: "Executes when a task is resumed" },
	{ name: "TaskCancel", description: "Executes when a task is cancelled" },
	{ name: "TaskComplete", description: "Executes when a task completes" },
	{ name: "PreToolUse", description: "Executes before any tool is used" },
	{ name: "PostToolUse", description: "Executes after any tool is used" },
	{ name: "UserPromptSubmit", description: "Executes when user submits a prompt" },
	{ name: "PreCompact", description: "Executes before conversation compaction" },
]

const NewRuleRow: React.FC<NewRuleRowProps> = ({ isGlobal, ruleType }) => {
	const [isExpanded, setIsExpanded] = useState(false)
	const [filename, setFilename] = useState("")
	const inputRef = useRef<HTMLInputElement>(null)
	const [error, setError] = useState<string | null>(null)
	const [showHookSelector, setShowHookSelector] = useState(false)
	const [selectedHook, setSelectedHook] = useState<string | null>(null)

	const componentRef = useRef<HTMLDivElement>(null)

	// Focus the input when expanded
	useEffect(() => {
		if (isExpanded && inputRef.current) {
			inputRef.current.focus()
		}
	}, [isExpanded])

	useClickAway(componentRef, () => {
		if (isExpanded) {
			setIsExpanded(false)
			setFilename("")
			setError(null)
		}
	})

	const getExtension = (filename: string): string => {
		if (filename.startsWith(".") && !filename.includes(".", 1)) {
			return ""
		}
		const match = filename.match(/\.[^.]+$/)
		return match ? match[0].toLowerCase() : ""
	}

	const isValidExtension = (ext: string): boolean => {
		return ext === "" || ext === ".md" || ext === ".txt"
	}

	const handleCreateHook = async (hookName: string) => {
		try {
			await FileServiceClient.createHook(
				CreateHookRequest.create({
					hookName,
					isGlobal,
				}),
			)
			setShowHookSelector(false)
			setSelectedHook(null)
		} catch (err) {
			console.error("Error creating hook:", err)
		}
	}

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		// Handle hook creation
		if (ruleType === "hook") {
			setShowHookSelector(true)
			return
		}

		if (filename.trim()) {
			const trimmedFilename = filename.trim()
			const extension = getExtension(trimmedFilename)

			if (!isValidExtension(extension)) {
				setError("Only .md, .txt, or no file extension allowed")
				return
			}

			let finalFilename = trimmedFilename
			if (extension === "") {
				finalFilename = `${trimmedFilename}.md`
			}

			try {
				await FileServiceClient.createRuleFile(
					RuleFileRequest.create({
						isGlobal,
						filename: finalFilename,
						type: ruleType || "cline",
					}),
				)
			} catch (err) {
				console.error("Error creating rule file:", err)
			}

			setFilename("")
			setError(null)
			setIsExpanded(false)
		}
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			setIsExpanded(false)
			setFilename("")
		}
	}

	return (
		<>
			<div
				className={cn("mb-2.5 transition-all duration-300 ease-in-out", {
					"opacity-100": isExpanded,
					"opacity-70 hover:opacity-100": !isExpanded,
				})}
				onClick={() => !isExpanded && ruleType !== "hook" && setIsExpanded(true)}
				ref={componentRef}>
				<div
					className={cn(
						"flex items-center px-2 py-4 rounded bg-input-background transition-all duration-300 ease-in-out h-5",
						{
							"shadow-sm": isExpanded,
						},
					)}>
					<form className="flex flex-1 items-center" onSubmit={handleSubmit}>
						<input
							className={cn(
								"flex-1 bg-input-background text-input-foreground border-0 outline-0 rounded focus:outline-none focus:ring-0 focus:border-transparent",
								{
									italic: !isExpanded,
								},
							)}
							onChange={(e) => setFilename(e.target.value)}
							placeholder={
								isExpanded
									? ruleType === "workflow"
										? "workflow-name (.md, .txt, or no extension)"
										: ruleType === "hook"
											? "Select hook type..."
											: "rule-name (.md, .txt, or no extension)"
									: ruleType === "workflow"
										? "New workflow file..."
										: ruleType === "hook"
											? "New hook..."
											: "New rule file..."
							}
							readOnly={ruleType === "hook"}
							ref={inputRef}
							type="text"
							value={isExpanded && ruleType !== "hook" ? filename : ""}
						/>

						<Button
							aria-label={
								isExpanded
									? "Create file"
									: ruleType === "workflow"
										? "New workflow file..."
										: ruleType === "hook"
											? "New hook..."
											: "New rule file..."
							}
							className="mx-0.5"
							onClick={(e) => {
								e.stopPropagation()
								if (!isExpanded && ruleType !== "hook") {
									setIsExpanded(true)
								} else if (ruleType === "hook") {
									setShowHookSelector(true)
								}
							}}
							size="icon"
							title={isExpanded ? "Create file" : ruleType === "hook" ? "New hook" : "New file"}
							type={isExpanded && ruleType !== "hook" ? "submit" : "button"}
							variant="icon">
							<PlusIcon />
						</Button>
					</form>
				</div>
				{isExpanded && error && <div className="text-error text-xs mt-1 ml-2">{error}</div>}
			</div>

			{/* Hook Selector Modal */}
			{showHookSelector && (
				<div
					className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1001]"
					onClick={() => setShowHookSelector(false)}>
					<div
						className="bg-vscode-editor-background border border-vscode-panel-border rounded p-4 max-w-lg w-full mx-4"
						onClick={(e) => e.stopPropagation()}>
						<h3 className="text-lg font-semibold mb-3">Create {isGlobal ? "Global" : "Workspace"} Hook</h3>

						<div className="mb-4 text-xs text-description">Select which hook type to create:</div>

						<div className="flex flex-col gap-2 max-h-96 overflow-y-auto mb-4">
							{HOOK_TYPES.map((hook) => (
								<div
									className={cn(
										"p-3 border rounded cursor-pointer transition-colors",
										selectedHook === hook.name
											? "border-vscode-focusBorder bg-vscode-list-activeSelectionBackground"
											: "border-vscode-panel-border hover:bg-vscode-list-hoverBackground",
									)}
									key={hook.name}
									onClick={() => setSelectedHook(hook.name)}>
									<div className="font-medium">{hook.name}</div>
									<div className="text-xs text-description">{hook.description}</div>
								</div>
							))}
						</div>

						<div className="flex gap-2 justify-end">
							<Button
								onClick={() => {
									setShowHookSelector(false)
									setSelectedHook(null)
								}}
								variant="secondary">
								Cancel
							</Button>
							<Button
								disabled={!selectedHook}
								onClick={() => {
									if (selectedHook) {
										handleCreateHook(selectedHook)
									}
								}}>
								Create Hook
							</Button>
						</div>
					</div>
				</div>
			)}
		</>
	)
}

export default NewRuleRow
