import { CreateOpenAiCompatibleProviderRequest } from "@shared/proto/cline/models"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { ModelsServiceClient } from "@/services/grpc-client"

export function AddOpenAICompatibleProvider({ onCreated }: { onCreated: (providerId: string) => Promise<void> }) {
	const [isOpen, setIsOpen] = useState(false)
	const [name, setName] = useState("")
	const [baseUrl, setBaseUrl] = useState("")
	const [isSaving, setIsSaving] = useState(false)
	const [error, setError] = useState("")

	const create = async () => {
		setIsSaving(true)
		setError("")
		try {
			const provider = await ModelsServiceClient.createOpenAiCompatibleProvider(
				CreateOpenAiCompatibleProviderRequest.create({ name, baseUrl }),
			)
			await onCreated(provider.id)
			setIsOpen(false)
			setName("")
			setBaseUrl("")
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setIsSaving(false)
		}
	}

	return (
		<div className="flex flex-col gap-2 my-2">
			{!isOpen ? (
				<VSCodeButton appearance="secondary" onClick={() => setIsOpen(true)}>
					Add OpenAI Compatible provider
				</VSCodeButton>
			) : (
				<>
					<VSCodeTextField
						disabled={isSaving}
						maxlength={100}
						onInput={(event) => setName((event.target as HTMLInputElement).value)}
						placeholder="e.g. Work server"
						value={name}>
						Provider name
					</VSCodeTextField>
					<VSCodeTextField
						disabled={isSaving}
						onInput={(event) => setBaseUrl((event.target as HTMLInputElement).value)}
						placeholder="https://example.com/v1"
						value={baseUrl}>
						Base URL
					</VSCodeTextField>
					{error && <div role="alert">{error}</div>}
					<div className="flex gap-2">
						<VSCodeButton disabled={isSaving || !name.trim() || !baseUrl.trim()} onClick={() => void create()}>
							{isSaving ? "Adding…" : "Add provider"}
						</VSCodeButton>
						<VSCodeButton
							appearance="secondary"
							disabled={isSaving}
							onClick={() => {
								setIsOpen(false)
								setError("")
							}}>
							Cancel
						</VSCodeButton>
					</div>
				</>
			)}
		</div>
	)
}
