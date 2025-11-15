import { RuleFileRequest } from "@shared/proto/index.cline"
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
			className={cn("mb-2.5 transition-all duration-300 ease-in-out", {
				"opacity-100": isExpanded,
				"opacity-70 hover:opacity-100": !isExpanded,
			})}
			onClick={() => !isExpanded && setIsExpanded(true)}
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
									: "rule-name (.md, .txt, or no extension)"
								: ruleType === "workflow"
									? "New workflow file..."
									: "New rule file..."
						}
						ref={inputRef}
						type="text"
						value={isExpanded ? filename : ""}
					/>

					<Button
						aria-label={
							isExpanded
								? "Create rule file"
								: ruleType === "workflow"
									? "New workflow file..."
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
						title={isExpanded ? "Create rule file" : "New rule file"}
						type={isExpanded ? "submit" : "button"}
						variant="icon">
						<PlusIcon />
					</Button>
				</form>
			</div>
			{isExpanded && error && <div className="text-error text-xs mt-1 ml-2">{error}</div>}
		</div>
	)
}

export default NewRuleRow
