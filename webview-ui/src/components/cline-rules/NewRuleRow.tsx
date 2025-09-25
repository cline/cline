import { RuleFileRequest } from "@shared/proto/index.cline"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useRef, useState } from "react"
import { useClickAway } from "react-use"
import { FileServiceClient } from "@/services/grpc-client"

interface NewRuleRowProps {
	isGlobal: boolean
	ruleType?: string
}

const NewRuleRow: React.FC<NewRuleRowProps> = ({ isGlobal, ruleType }) => {
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
		<div
			className={`mb-2.5 transition-all duration-300 ease-in-out ${isExpanded ? "opacity-100" : "opacity-70 hover:opacity-100"}`}
			onClick={() => !isExpanded && setIsExpanded(true)}
			ref={componentRef}>
			<div
				className={`flex items-center p-2 rounded bg-[var(--vscode-input-background)] transition-all duration-300 ease-in-out h-[18px] ${
					isExpanded ? "shadow-sm" : ""
				}`}>
				{isExpanded ? (
					<form className="flex flex-1 items-center" onSubmit={handleSubmit}>
						<input
							className="flex-1 bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border-0 outline-0 rounded focus:outline-none focus:ring-0 focus:border-transparent"
							onChange={(e) => setFilename(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder={
								ruleType === "workflow"
									? "workflow-name (.md, .txt, or no extension)"
									: "rule-name (.md, .txt, or no extension)"
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
								aria-label="Create rule file"
								style={{ padding: "0px" }}
								title="Create rule file"
								type="submit">
								<span className="codicon codicon-add text-[14px]" />
							</VSCodeButton>
						</div>
					</form>
				) : (
					<>
						<span className="flex-1 text-[var(--vscode-descriptionForeground)] bg-[var(--vscode-input-background)] italic text-xs">
							{ruleType === "workflow" ? "New workflow file..." : "New rule file..."}
						</span>
						<div className="flex items-center ml-2 space-x-2">
							<VSCodeButton
								appearance="icon"
								aria-label={ruleType === "workflow" ? "New workflow file..." : "New rule file..."}
								onClick={(e) => {
									e.stopPropagation()
									setIsExpanded(true)
								}}
								style={{ padding: "0px" }}
								title="New rule file">
								<span className="codicon codicon-add text-[14px]" />
							</VSCodeButton>
						</div>
					</>
				)}
			</div>
			{isExpanded && error && <div className="text-[var(--vscode-errorForeground)] text-xs mt-1 ml-2">{error}</div>}
		</div>
	)
}

export default NewRuleRow
