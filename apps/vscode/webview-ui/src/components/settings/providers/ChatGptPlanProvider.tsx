import type { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useStaticProviderSelection } from "@/hooks/useStaticProviderSelection"
import { AccountServiceClient } from "@/services/grpc-client"
import { ModelSelector } from "../common/ModelSelector"

export function ChatGptPlanProvider({ currentMode, showModelOptions }: { currentMode: Mode; showModelOptions: boolean }) {
	const { apiConfiguration } = useExtensionState()
	const { config, read, commitSelection } = useProviderConfig("openai-chatgpt")
	const { models, selectedModelId } = useStaticProviderSelection("openai-chatgpt", apiConfiguration, currentMode)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState("")
	const connected = config?.hasAccessToken
	const signInOrOut = async () => {
		setPending(true)
		setError("")
		try {
			if (connected) await AccountServiceClient.chatGptPlanSignOut({})
			else await AccountServiceClient.chatGptPlanSignIn({})
			await read()
		} catch (e) {
			setError(e instanceof Error ? e.message : "ChatGPT sign-in failed")
		} finally {
			setPending(false)
		}
	}
	return (
		<div>
			<p>
				{connected
					? "Using ChatGPT plan for eligible requests."
					: "Authorize Cline to use your eligible ChatGPT plan allowance. No API key needed."}
			</p>
			<VSCodeButton disabled={pending} onClick={() => void signInOrOut()}>
				{pending ? "Waiting for browser…" : connected ? "Sign out locally" : "Continue with ChatGPT"}
			</VSCodeButton>
			<p>
				<a href="https://chatgpt.com/#settings">Manage usage and app access in ChatGPT settings</a>
			</p>
			{error && <p role="alert">{error}</p>}
			{connected && showModelOptions && (
				<ModelSelector
					label="Model"
					models={models}
					onChange={(event: Event) => {
						const modelId = (event.target as HTMLSelectElement).value
						if (modelId) void commitSelection(currentMode, { providerId: "openai-chatgpt", modelId })
					}}
					selectedModelId={selectedModelId}
					showDisplayNames
				/>
			)}
		</div>
	)
}
