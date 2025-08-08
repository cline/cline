import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "../../node_modules/@vscode/codicons/dist/codicon.css"
import App from "./App.tsx"
import "./index.css"

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
