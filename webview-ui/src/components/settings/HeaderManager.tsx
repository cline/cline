import { VSCodeButton, VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { CustomHeader } from "../../../../src/shared/api"

interface HeaderManagerProps {
	headers: CustomHeader[]
	onChange: (headers: CustomHeader[]) => void
}

export const HeaderManager = ({ headers, onChange }: HeaderManagerProps) => {
	const [newHeader, setNewHeader] = useState<CustomHeader>({
		key: "",
		value: "",
		description: "",
		isSecret: false,
	})
	const [validationError, setValidationError] = useState<string>("")

	const validateHeader = (header: CustomHeader): string | null => {
		// Non-empty key validation
		if (!header.key.trim()) {
			return "Header key is required"
		}

		// Valid HTTP header name format (RFC 7230)
		const headerNameRegex = /^[!#$%&'*+\-.^_`|~0-9a-zA-Z]+$/
		if (!headerNameRegex.test(header.key)) {
			return "Invalid header key format"
		}

		// Check for duplicates (case-insensitive)
		const isDuplicate = headers.some((h) => h.key.toLowerCase() === header.key.toLowerCase())
		if (isDuplicate) {
			return "Header key already exists"
		}

		// Non-empty value validation
		if (!header.value.trim()) {
			return "Header value is required"
		}

		return null
	}

	const handleAddHeader = () => {
		const error = validateHeader(newHeader)
		if (error) {
			setValidationError(error)
			return
		}

		onChange([...headers, newHeader])
		setNewHeader({
			key: "",
			value: "",
			description: "",
			isSecret: false,
		})
		setValidationError("")
	}

	const handleRemoveHeader = (index: number) => {
		const newHeaders = [...headers]
		newHeaders.splice(index, 1)
		onChange(newHeaders)
	}

	const handleUpdateHeader = (index: number, field: keyof CustomHeader, value: string | boolean) => {
		const newHeaders = [...headers]
		newHeaders[index] = {
			...newHeaders[index],
			[field]: value,
		}
		onChange(newHeaders)
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
			<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
				<VSCodeTextField
					value={newHeader.key}
					style={{ width: "100%" }}
					onInput={(e) => {
						const target = e.target as HTMLInputElement
						setNewHeader({ ...newHeader, key: target.value })
						setValidationError("")
					}}
					placeholder="Enter header key...">
					<span style={{ fontWeight: 500 }}>New Header Key</span>
				</VSCodeTextField>

				<VSCodeTextField
					value={newHeader.value}
					style={{ width: "100%" }}
					type={newHeader.isSecret ? "password" : "text"}
					onInput={(e) => {
						const target = e.target as HTMLInputElement
						setNewHeader({ ...newHeader, value: target.value })
						setValidationError("")
					}}
					placeholder="Enter header value...">
					<span style={{ fontWeight: 500 }}>New Header Value</span>
				</VSCodeTextField>

				<VSCodeTextField
					value={newHeader.description || ""}
					style={{ width: "100%" }}
					onInput={(e) => {
						const target = e.target as HTMLInputElement
						setNewHeader({ ...newHeader, description: target.value })
					}}
					placeholder="Optional description...">
					<span style={{ fontWeight: 500 }}>Description (Optional)</span>
				</VSCodeTextField>

				<VSCodeCheckbox
					checked={newHeader.isSecret}
					onChange={(e) => {
						const target = e.target as HTMLInputElement
						setNewHeader({ ...newHeader, isSecret: target.checked })
					}}>
					Store as secret
				</VSCodeCheckbox>

				{validationError && (
					<p style={{ color: "var(--vscode-errorForeground)", margin: 0, fontSize: 12 }}>{validationError}</p>
				)}

				<VSCodeButton appearance="secondary" onClick={handleAddHeader} style={{ alignSelf: "flex-start", marginTop: 5 }}>
					Add Header
				</VSCodeButton>
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
				<div
					style={{
						borderTop: "1px solid var(--vscode-textSeparator-foreground)",
						margin: "5px 0",
					}}
				/>
				<span style={{ fontWeight: 500 }}>Current Headers</span>
				{headers.length === 0 ? (
					<div style={{ color: "var(--vscode-descriptionForeground)", fontSize: "12px" }}>No headers added yet</div>
				) : (
					headers.map((header, index) => (
						<div
							key={index}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								padding: "4px 8px",
								border: "1px solid var(--vscode-textSeparator-foreground)",
								borderRadius: 4,
								backgroundColor: "var(--vscode-editor-background)",
							}}>
							<div style={{ flex: 1 }}>
								<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
									<span style={{ fontWeight: 500, color: "var(--vscode-editor-foreground)" }}>
										{header.key}:
									</span>
									<span style={{ color: "var(--vscode-descriptionForeground)" }}>
										{header.isSecret ? "••••••" : header.value}
									</span>
								</div>
								{header.description && (
									<div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
										{header.description}
									</div>
								)}
							</div>
							<div style={{ display: "flex", gap: 4, alignItems: "center" }}>
								<VSCodeButton
									appearance="icon"
									onClick={() => handleUpdateHeader(index, "isSecret", !header.isSecret)}>
									<i className={`codicon codicon-${header.isSecret ? "eye" : "eye-closed"}`}></i>
								</VSCodeButton>
								<VSCodeButton appearance="icon" onClick={() => handleRemoveHeader(index)}>
									<i className="codicon codicon-trash"></i>
								</VSCodeButton>
							</div>
						</div>
					))
				)}
			</div>
		</div>
	)
}

export default HeaderManager
