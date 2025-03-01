import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { PostHogProvider } from "posthog-js/react"
import "./index.css"
import App from "./App.tsx"
import "../../node_modules/@vscode/codicons/dist/codicon.css"

const apiKey = "phc_qfOAGxZw2TL5O8p9KYd9ak3bPBFzfjC8fy5L6jNWY7K"
const apiHost = "https://us.i.posthog.com"

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<PostHogProvider apiKey={apiKey} options={{ api_host: apiHost }}>
			<App />
		</PostHogProvider>
	</StrictMode>,
)
