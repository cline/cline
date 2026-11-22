import { useCallback, useEffect, useState } from "react"
import { PLATFORM_CONFIG } from "@/config/platform.config"

/**
 * Syncs the VS Code Studio layout preference (`cline.showExplorerAndEditor`)
 * between the webview UI and the VS Code extension host.
 */
export function useStudioWorkspacePanes() {
	const [showExplorerAndEditor, setLocalShow] = useState<boolean>(true)

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const msg = event.data
			if (msg?.type === "studio_workspace_panes_state" && typeof msg.showExplorerAndEditor === "boolean") {
				setLocalShow(msg.showExplorerAndEditor)
			}
		}

		window.addEventListener("message", handleMessage)
		PLATFORM_CONFIG.postMessage({ type: "studio_get_workspace_panes" })
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const setShowExplorerAndEditor = useCallback((show: boolean) => {
		setLocalShow(show)
		PLATFORM_CONFIG.postMessage({
			type: "studio_set_workspace_panes",
			showExplorerAndEditor: show,
		})
	}, [])

	return { showExplorerAndEditor, setShowExplorerAndEditor }
}
