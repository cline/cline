import { RuleFileRequest } from "@shared/proto/index.cline"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useClickAway } from "react-use"
import { FileServiceClient } from "@/services/grpc-client"

interface NewRuleRowProps {
	isGlobal: boolean
	ruleType?: string
}

const NewRuleRow: React.FC<NewRuleRowProps> = ({ isGlobal, ruleType }) => {
	const { t } = useTranslation()
	const [isExpanded, setIsExpanded] = useState(false)
	const [filename, setFilename] = useState("")
	const inputRef = useRef<HTMLInputElement>(null)
	const [error, setError] = useState<string | null>(null)

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

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		if (filename.trim()) {
			const trimmedFilename = filename.trim()
			const extension = getExtension(trimmedFilename)

			if (!isValidExtension(extension)) {
				setError(t("new_rule_row.invalid_extension"))
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
		<div
			className={`mb-2.5 transition-all duration-300 ease-in-out ${isExpanded ? "opacity-100" : "opacity-70 hover:opacity-100"}`}
			onClick={() => !isExpanded && setIsExpanded(true)}
			ref={componentRef}>
			<div
				className={`flex items-center p-2 py-4 rounded bg-input-background transition-all duration-300 ease-in-out h-[18px] ${
					isExpanded ? "shadow-sm" : ""
				}`}>
				{isExpanded ? (
					<form className="flex flex-1 items-center" onSubmit={handleSubmit}>
						<input
							className="flex-1 bg-input-background text-(--vscode-input-foreground) border-0 outline-0 rounded focus:outline-none focus:ring-0 focus:border-transparent"
							onChange={(e) => setFilename(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder={
								ruleType === "workflow"
									? t("new_rule_row.workflow_placeholder")
									: t("new_rule_row.rule_placeholder")
							}
							ref={inputRef}
							style={{
								outline: "none",
							}}
							type="text"
							value={filename}
						/>

						<div className="flex items-center ml-2 space-x-2">
							<VSCodeButton
								appearance="icon"
								aria-label={t("new_rule_row.create_rule_file")}
								style={{ padding: "0px" }}
								title={t("new_rule_row.create_rule_file")}
								type="submit">
								<span className="codicon codicon-add text-[14px]" />
							</VSCodeButton>
						</div>
					</form>
				) : (
					<>
						<span className="flex-1 text-(--vscode-descriptionForeground) bg-input-background italic text-xs">
							{ruleType === "workflow" ? t("new_rule_row.new_workflow_file") : t("new_rule_row.new_rule_file")}
						</span>
						<div className="flex items-center ml-2 space-x-2">
							<VSCodeButton
								appearance="icon"
								aria-label={
									ruleType === "workflow"
										? t("new_rule_row.new_workflow_file")
										: t("new_rule_row.new_rule_file")
								}
								onClick={(e) => {
									e.stopPropagation()
									setIsExpanded(true)
								}}
								style={{ padding: "0px" }}
								title={t("new_rule_row.new_rule_file")}>
								<span className="codicon codicon-add text-[14px]" />
							</VSCodeButton>
						</div>
					</>
				)}
			</div>
			{isExpanded && error && <div className="text-(--vscode-errorForeground) text-xs mt-1 ml-2">{error}</div>}
		</div>
	)
}

export default NewRuleRow
