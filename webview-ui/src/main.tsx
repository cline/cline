import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { PostHogProvider } from "posthog-js/react"
import "./index.css"
import App from "./App.tsx"
import "../../node_modules/@vscode/codicons/dist/codicon.css"

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
