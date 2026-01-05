// Enable webview debug logging FIRST - before any other imports that might log
import { enableWebviewDebugLogging } from "./utils/webviewDebugLogger"

enableWebviewDebugLogging()

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./main.css"
import "./index.css"
import App from "./App.tsx"

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
