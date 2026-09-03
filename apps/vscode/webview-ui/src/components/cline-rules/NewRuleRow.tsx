import { CreateHookRequest, CreateSkillRequest, RuleFileRequest } from "@shared/proto/index.cline"
import { PlusIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
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

// `name` values are hook identifiers used to create files and must stay in English;
// `description` holds an i18n key resolved with t() at the render site.
const HOOK_TYPES = [
	{ name: "TaskStart", description: "rules:hookTypes.taskStart" },
	{ name: "TaskResume", description: "rules:hookTypes.taskResume" },
	{ name: "TaskCancel", description: "rules:hookTypes.taskCancel" },
	{ name: "TaskComplete", description: "rules:hookTypes.taskComplete" },
	{ name: "PreToolUse", description: "rules:hookTypes.preToolUse" },
	{ name: "PostToolUse", description: "rules:hookTypes.postToolUse" },
	{ name: "UserPromptSubmit", description: "rules:hookTypes.userPromptSubmit" },
	{ name: "PreCompact", description: "rules:hookTypes.preCompact" },
]

const NewRuleRow: React.FC<NewRuleRowProps> = ({ isGlobal, ruleType, existingHooks = [], workspaceName }) => {
	const { t } = useTranslation()
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
					setError(t("rules:errors.invalidSkillName"))
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
					setError(err instanceof Error ? err.message : t("rules:errors.createSkillFailed"))
				}
				return
			}

			const extension = getExtension(trimmedFilename)

			if (!isValidExtension(extension)) {
				setError(t("rules:errors.invalidExtension"))
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
								{t("rules:selectHookType")}
							</label>
							<span className="sr-only" id="hook-select-description">
								{t("rules:hookSelectDescription", {
									hooks: availableHookTypes.map((h) => h.name).join(", "),
								})}
							</span>
							{/* Controlled with a constant empty value so the trigger
							    resets to the placeholder after each hook is created. */}
							<Select
								disabled={availableHookTypes.length === 0}
								onValueChange={(hookName) => handleCreateHook(hookName)}
								value="">
								<SelectTrigger
									aria-describedby="hook-select-description"
									aria-label={t("rules:selectHookType")}
									className="flex-1 data-[size=default]:h-5 min-h-0 border-0 bg-transparent px-2 py-0 rounded shadow-none italic text-input-foreground data-[placeholder]:text-input-foreground cursor-pointer focus-visible:ring-0"
									id="hook-type-select">
									<SelectValue
										placeholder={
											availableHookTypes.length === 0
												? t("rules:allHooksCreated")
												: t("rules:newHookPlaceholder")
										}
									/>
								</SelectTrigger>
								<SelectContent container={dropdownContainer ?? undefined}>
									{availableHookTypes.map((hook) => (
										<SelectItem key={hook.name} title={t(hook.description)} value={hook.name}>
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
											? t("rules:workflowNameHint")
											: ruleType === "skill"
												? t("rules:skillNameHint")
												: t("rules:ruleNameHint")
										: ruleType === "workflow"
											? t("rules:newWorkflowPlaceholder")
											: ruleType === "skill"
												? t("rules:newSkillPlaceholder")
												: t("rules:newRulePlaceholder")
								}
								ref={inputRef}
								type="text"
								value={isExpanded ? filename : ""}
							/>

							<Button
								aria-label={
									isExpanded
										? ruleType === "skill"
											? t("rules:createSkill")
											: t("rules:createFile")
										: ruleType === "workflow"
											? t("rules:newWorkflowPlaceholder")
											: ruleType === "skill"
												? t("rules:newSkillPlaceholder")
												: t("rules:newRulePlaceholder")
								}
								className="mx-0.5"
								onClick={(e) => {
									e.stopPropagation()
									if (!isExpanded) {
										setIsExpanded(true)
									}
								}}
								size="icon"
								title={
									isExpanded
										? ruleType === "skill"
											? t("rules:createSkill")
											: t("rules:createFile")
										: t("rules:newFile")
								}
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
