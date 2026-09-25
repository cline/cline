import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { syncDirection } from "./utils/direction"
import "./main.css"
import "./index.css"
import App from "./App.tsx"

// Resolve LTR/RTL before React mounts so the first paint is already correct.
syncDirection()

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
