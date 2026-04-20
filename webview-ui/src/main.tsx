import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./main.css"
import "./index.css"
import App from "./App.tsx"
import WebviewErrorBoundary from "./components/common/WebviewErrorBoundary"

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<WebviewErrorBoundary>
			<App />
		</WebviewErrorBoundary>
	</StrictMode>,
)
