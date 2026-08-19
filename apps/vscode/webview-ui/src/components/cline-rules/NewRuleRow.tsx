import { CreateHookRequest, CreateSkillRequest, RuleFileRequest } from "@shared/proto/index.cline"
import { PlusIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useClickAway } from "react-use"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"

interface NewRuleRowProps {
	isGlobal: boolean
	ruleType?: string
	existingHooks?: string[]
	workspaceName?: string
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

const NewRuleRow: React.FC<NewRuleRowProps> = ({ isGlobal, ruleType, existingHooks = [], workspaceName }) => {
	const [isExpanded, setIsExpanded] = useState(false)
	const [filename, setFilename] = useState("")
	const inputRef = useRef<HTMLInputElement>(null)
	const [error, setError] = useState<string | null>(null)

	const componentRef = useRef<HTMLDivElement | null>(null)
	// Portal target for the hook-type dropdown. Rendering the dropdown inside
	// this component (instead of document.body) keeps clicks on its options
	// from triggering the rules modal's click-away handler.
	const [dropdownContainer, setDropdownContainer] = useState<HTMLDivElement | null>(null)

	// Calculate available hook types by filtering out existing hooks
	const availableHookTypes = useMemo(() => HOOK_TYPES.filter((type) => !existingHooks.includes(type.name)), [existingHooks])

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
		if (!hookName) return

		try {
			await FileServiceClient.createHook(
				CreateHookRequest.create({
					hookName,
					isGlobal,
					workspaceName,
				}),
			)
		} catch (err) {
			console.error("Error creating hook:", err)
		}
	}

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		if (filename.trim()) {
			const trimmedFilename = filename.trim()

			// Skills use directory names, not file extensions
			if (ruleType === "skill") {
				// Validate skill name - only allow alphanumeric, dashes, underscores
				if (!/^[a-zA-Z0-9_-]+$/.test(trimmedFilename)) {
					setError("Skill name can only contain letters, numbers, dashes, and underscores")
					return
				}

				try {
					await FileServiceClient.createSkillFile(
						CreateSkillRequest.create({
							skillName: trimmedFilename,
							isGlobal,
						}),
					)
					setFilename("")
					setError(null)
					setIsExpanded(false)
				} catch (err) {
					setError(err instanceof Error ? err.message : "Failed to create skill")
				}
				return
			}

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
				ref={(node) => {
					componentRef.current = node
					setDropdownContainer(node)
				}}>
				<div
					className={cn(
						"flex items-center px-2 py-4 rounded bg-input-background transition-all duration-300 ease-in-out h-5",
						{
							"shadow-sm": isExpanded,
						},
					)}>
					{ruleType === "hook" ? (
						<>
							<label className="sr-only" htmlFor="hook-type-select">
								Select hook type to create
							</label>
							<span className="sr-only" id="hook-select-description">
								Choose a hook type to create. Hooks execute at specific points in Cline's lifecycle. Available:{" "}
								{availableHookTypes.map((h) => h.name).join(", ")}
							</span>
							{/* Controlled with a constant empty value so the trigger
							    resets to the placeholder after each hook is created. */}
							<Select
								disabled={availableHookTypes.length === 0}
								onValueChange={(hookName) => handleCreateHook(hookName)}
								value="">
								<SelectTrigger
									aria-describedby="hook-select-description"
									aria-label="Select hook type to create"
									className="flex-1 data-[size=default]:h-5 min-h-0 border-0 bg-transparent px-2 py-0 rounded shadow-none italic text-input-foreground data-[placeholder]:text-input-foreground cursor-pointer focus-visible:ring-0"
									id="hook-type-select">
									<SelectValue
										placeholder={availableHookTypes.length === 0 ? "All hooks created" : "New hook..."}
									/>
								</SelectTrigger>
								<SelectContent container={dropdownContainer ?? undefined}>
									{availableHookTypes.map((hook) => (
										<SelectItem key={hook.name} title={hook.description} value={hook.name}>
											{hook.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</>
					) : (
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
											: ruleType === "skill"
												? "skill-name (letters, numbers, dashes, underscores)"
												: "rule-name (.md, .txt, or no extension)"
										: ruleType === "workflow"
											? "New workflow file..."
											: ruleType === "skill"
												? "New skill..."
												: "New rule file..."
								}
								ref={inputRef}
								type="text"
								value={isExpanded ? filename : ""}
							/>

							<Button
								aria-label={
									isExpanded
										? ruleType === "skill"
											? "Create skill"
											: "Create file"
										: ruleType === "workflow"
											? "New workflow file..."
											: ruleType === "skill"
												? "New skill..."
												: "New rule file..."
								}
								className="mx-0.5"
								onClick={(e) => {
									e.stopPropagation()
									if (!isExpanded) {
										setIsExpanded(true)
									}
								}}
								size="icon"
								title={isExpanded ? (ruleType === "skill" ? "Create skill" : "Create file") : "New file"}
								type={isExpanded ? "submit" : "button"}
								variant="icon">
								<PlusIcon />
							</Button>
						</form>
					)}
				</div>
				{isExpanded && error && <div className="text-error text-xs mt-1 ml-2">{error}</div>}
			</div>
		</>
	)
}

export default NewRuleRow
