import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { ModelsServiceClient } from "@/services/grpc-client"

export function DeleteOpenAICompatibleProvider({
	providerId,
	name,
	onDeleted,
}: {
	providerId: string
	name: string
	onDeleted: () => Promise<void>
}) {
	const [confirming, setConfirming] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState("")
	const remove = async () => {
		setBusy(true)
		setError("")
		try {
			await ModelsServiceClient.deleteOpenAiCompatibleProvider(StringRequest.create({ value: providerId }))
			await onDeleted()
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setBusy(false)
		}
	}
	return (
		<div className="flex flex-col gap-2 my-2">
			{confirming ? (
				<>
					<p>Delete “{name}” and its saved API key and model settings?</p>
					<div className="flex gap-2">
						<VSCodeButton disabled={busy} onClick={() => void remove()}>
							{busy ? "Deleting…" : "Delete provider"}
						</VSCodeButton>
						<VSCodeButton appearance="secondary" disabled={busy} onClick={() => setConfirming(false)}>
							Cancel
						</VSCodeButton>
					</div>
				</>
			) : (
				<VSCodeButton appearance="secondary" onClick={() => setConfirming(true)}>
					Delete custom provider
				</VSCodeButton>
			)}
			{error && <div role="alert">{error}</div>}
		</div>
	)
}
