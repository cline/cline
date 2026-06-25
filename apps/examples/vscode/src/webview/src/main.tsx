import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App.tsx";

/**
 * Sync the `dark` class on <html> with the VS Code theme.
 * VS Code sets `data-vscode-theme-kind` on <body> to one of:
 *   "vscode-light" | "vscode-dark" | "vscode-high-contrast" | "vscode-high-contrast-light"
 */
function syncTheme() {
	const kind = document.body.dataset.vscodeThemeKind;
	const isDark = kind === "vscode-dark" || kind === "vscode-high-contrast";
	document.documentElement.classList.toggle("dark", isDark);
}

// Apply immediately
syncTheme();

// Re-apply whenever VS Code changes the theme attribute
const observer = new MutationObserver(syncTheme);
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
