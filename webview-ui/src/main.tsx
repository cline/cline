import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { PostHogProvider } from "posthog-js/react"
import "./index.css"
import App from "./App.tsx"
import "../../node_modules/@vscode/codicons/dist/codicon.css"

const apiKey = "phc_5WnLHpYyC30Bsb7VSJ6DzcPXZ34JSF08DJLyM7svZ15"
const apiHost = "https://us.i.posthog.com"

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<PostHogProvider apiKey={apiKey} options={{ api_host: apiHost }}>
			<App />
		</PostHogProvider>
	</StrictMode>,
)
