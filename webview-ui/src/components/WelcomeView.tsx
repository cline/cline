import React, { useState, useEffect, useCallback } from "react"
import { VSCodeButton, VSCodeTextField, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "../utilities/vscode"

interface WelcomeViewProps {
	apiKey: string
	setApiKey: (key: string) => void
}

const WelcomeView: React.FC<WelcomeViewProps> = ({ apiKey, setApiKey }) => {
	const [isValidating, setIsValidating] = useState(false)
	const [validationError, setValidationError] = useState<string | null>(null)

	const handleApiKeyChange = useCallback(
		(event: Event) => {
			const target = event.target as HTMLInputElement
			setApiKey(target.value)
		},
		[setApiKey]
	)

	const handleSubmit = useCallback(async () => {
		setIsValidating(true)
		setValidationError(null)

		try {
			// Simulate API key validation (replace with actual validation logic)
			await new Promise((resolve) => setTimeout(resolve, 1000))

			if (apiKey.length < 10) {
				throw new Error("Invalid API key")
			}

			vscode.postMessage({ type: "apiKey", text: apiKey })
		} catch (error) {
			setValidationError((error as Error).message)
		} finally {
			setIsValidating(false)
		}
	}, [apiKey])

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Enter" && apiKey) {
				handleSubmit()
			}
		}

		document.addEventListener("keydown", handleKeyDown)

		return () => {
			document.removeEventListener("keydown", handleKeyDown)
		}
	}, [apiKey, handleSubmit])

	return (
		<div className="welcome-view">
			<h1>Welcome to Claude Dev</h1>
			<p>To get started, please enter your Anthropic API key:</p>
			<VSCodeTextField value={apiKey} onChange={handleApiKeyChange as any} placeholder="Enter your API key" />
			{validationError && <p className="error-message">{validationError}</p>}
			<VSCodeButton onClick={handleSubmit} disabled={!apiKey || isValidating}>
				{isValidating ? <VSCodeProgressRing /> : "Submit"}
			</VSCodeButton>
		</div>
	)
}

export default WelcomeView
