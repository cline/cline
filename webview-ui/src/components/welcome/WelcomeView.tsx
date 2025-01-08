import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { validateApiConfiguration } from "../../utils/validate"
import { vscode } from "../../utils/vscode"
import ApiOptions from "../settings/ApiOptions"

const WelcomeView = () => {
	const { apiConfiguration } = useExtensionState()

	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)

	const disableLetsGoButton = apiErrorMessage != null

	const handleSubmit = () => {
		vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(apiConfiguration))
	}, [apiConfiguration])

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				padding: "0 20px",
			}}>
			<h2>Hi, I'm Cline-APIpie</h2>
			<p>
				This is a fork of Cline, made for APIpie.ai API. This may be merged into the main project at some point.
				We have more updates coming to truly take advantage of APIpie's features and services with Cline to
				really empower the developer.
			</p>

			<b>
				You need to configure an APIpie API key if you have not already. You could also configure some other API
				key but why not use Cline proper then.{" "}
			</b>

			<div style={{ marginTop: "10px" }}>
				<ApiOptions showModelOptions={false} />
				<VSCodeButton onClick={handleSubmit} disabled={disableLetsGoButton} style={{ marginTop: "3px" }}>
					Let's go!
				</VSCodeButton>
			</div>
		</div>
	)
}

export default WelcomeView
