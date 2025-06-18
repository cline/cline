import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App.tsx"
import "../../node_modules/@vscode/codicons/dist/codicon.css"

if (navigator.platform.toUpperCase().indexOf("WIN") >= 0) {
	document.body.classList.add("windows")
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
