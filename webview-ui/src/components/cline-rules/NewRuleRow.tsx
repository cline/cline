import { useState, useRef, useEffect } from "react"
import { vscode } from "@/utils/vscode"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

interface NewRuleRowProps {
	isGlobal: boolean // To determine where to create the file
}

const NewRuleRow: React.FC<NewRuleRowProps> = ({ isGlobal }) => {
	const [isExpanded, setIsExpanded] = useState(false)
	const [filename, setFilename] = useState("")
	const inputRef = useRef<HTMLInputElement>(null)
	const [error, setError] = useState<string | null>(null)

	// Focus the input when expanded
	useEffect(() => {
		if (isExpanded && inputRef.current) {
			inputRef.current.focus()
		}
	}, [isExpanded])

	const getExtension = (filename: string): string => {
		if (filename.startsWith(".") && !filename.includes(".", 1)) return ""
		const match = filename.match(/\.[^.]+$/)
		return match ? match[0].toLowerCase() : ""
	}

	const isValidExtension = (ext: string): boolean => {
		// Valid if it's empty (no extension) or .md or .txt
		return ext === "" || ext === ".md" || ext === ".txt"
	}

	const handleCreateRule = () => {
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

			vscode.postMessage({
				type: "createRuleFile",
				isGlobal,
				filename: finalFilename,
			})

			setFilename("")
			setError(null)
			setIsExpanded(false)
		}
	}

	const handleBlur = () => {
		setIsExpanded(false)
		setError(null)
		setFilename("")
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			handleCreateRule()
		} else if (e.key === "Escape") {
			setIsExpanded(false)
			setFilename("")
		}
	}

	return (
		<div
			className={`mb-2.5 transition-all duration-300 ease-in-out ${isExpanded ? "opacity-100" : "opacity-70 hover:opacity-100"}`}
			onClick={() => !isExpanded && setIsExpanded(true)}>
			<div
				className={`flex items-center p-2 rounded bg-[var(--vscode-input-background)] transition-all duration-300 ease-in-out h-[18px] ${
					isExpanded ? "shadow-sm" : ""
				}`}>
				{isExpanded ? (
					<>
						<input
							ref={inputRef}
							type="text"
							placeholder="rule-name (.md, .txt, or no extension)"
							value={filename}
							onChange={(e) => setFilename(e.target.value)}
							onBlur={handleBlur}
							onKeyDown={handleKeyDown}
							className="flex-1 bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border-0 outline-0 rounded focus:outline-none focus:ring-0 focus:border-transparent"
							style={{
								outline: "none",
							}}
						/>

						<div className="flex items-center ml-2 space-x-2">
							<VSCodeButton
								appearance="icon"
								aria-label="Create rule file"
								title="Create rule file"
								onClick={handleCreateRule}
								style={{ padding: "0px" }}>
								<span className="codicon codicon-add text-[14px]" />
							</VSCodeButton>
						</div>
					</>
				) : (
					<>
						<span className="flex-1 text-[var(--vscode-descriptionForeground)] bg-[var(--vscode-input-background)] italic text-xs">
							New rule file...
						</span>
						<div className="flex items-center ml-2 space-x-2">
							<VSCodeButton
								appearance="icon"
								aria-label="New rule file"
								title="New rule file"
								onClick={(e) => {
									e.stopPropagation()
									setIsExpanded(true)
								}}
								style={{ padding: "0px" }}>
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
