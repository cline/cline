import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App.tsx";
import { syncHubTheme } from "./lib/theme";

window.addEventListener("cline-hub-theme-change", syncHubTheme);

// Apply immediately
syncHubTheme();

// Re-apply whenever VS Code changes the theme attribute
const observer = new MutationObserver(syncHubTheme);
observer.observe(document.body, {
	attributes: true,
	attributeFilter: ["data-vscode-theme-kind"],
});

const root = document.getElementById("root");
if (!root) {
	throw new Error("Root element not found");
}

createRoot(root).render(
	<StrictMode>
		<TooltipProvider>
			<App />
		</TooltipProvider>
	</StrictMode>,
);
