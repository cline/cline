import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App.tsx"
import "../../node_modules/@vscode/codicons/dist/codicon.css"
import { useExtensionStore } from "./store/extensionStore" // Import the store

// Initialize the store
useExtensionStore.getState().initializeStore()

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
