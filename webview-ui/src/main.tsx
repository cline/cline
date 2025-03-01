import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { PostHogProvider } from "posthog-js/react"
import "./index.css"
import App from "./App.tsx"
import "../../node_modules/@vscode/codicons/dist/codicon.css"

const apiKey = "phc_uY24EJXNBcc9kwO1K8TJUl5hPQntGM6LL1Mtrz0CBD4"
const apiHost = "https://us.i.posthog.com"

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<PostHogProvider apiKey={apiKey} options={{ api_host: apiHost }}>
			<App />
		</PostHogProvider>
	</StrictMode>,
)
