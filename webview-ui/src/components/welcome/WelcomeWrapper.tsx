import { useState, memo } from "react"
import { WebviewType } from "@shared/WebviewMessage"
import WelcomeView from "./WelcomeView"
import WelcomeTabView from "./WelcomeTabView"

const WelcomeWrapper = memo(() => {
	const [showApiOptions, setShowApiOptions] = useState(false)

	// Determine which welcome view to show based on webview type
	const webviewType = (document.querySelector('meta[name="webview-type"]')?.getAttribute("content") || "sidebar") as WebviewType

	return (
		<>
			{webviewType === "sidebar" ? (
				<WelcomeView showApiOptions={showApiOptions} setShowApiOptions={setShowApiOptions} />
			) : (
				<WelcomeTabView showApiOptions={showApiOptions} setShowApiOptions={setShowApiOptions} />
			)}
		</>
	)
})

export default WelcomeWrapper
