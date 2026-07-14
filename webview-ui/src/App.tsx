import type { Boolean, EmptyRequest } from "@shared/proto/cline/common"
import { Component, lazy, type ReactNode, Suspense, useEffect } from "react"
import ChatView from "./components/chat/ChatView"
import ConnectorsView from "./components/connectors/ConnectorsView"
import HistoryView from "./components/history/HistoryView"
import HtmlPreviewPanel from "./components/html_preview/HtmlPreviewPanel"
import MapPanel from "./components/map/MapPanel"
import MapView from "./components/map/MapView"
import McpView from "./components/mcp/configuration/McpConfigurationView"
import SettingsView from "./components/settings/SettingsView"
import SkillsView from "./components/skills/SkillsView"
import WelcomeView from "./components/welcome/WelcomeView"
import { useExtensionState } from "./context/ExtensionStateContext"
import { Providers } from "./Providers"
import { UiServiceClient } from "./services/grpc-client"

// Lazy-loaded: a crash while rendering one of these reproducibility panels
// must not blank the rest of the webview (chat, map, etc. share this bundle).
const ExperimentTable = lazy(() =>
	import("./components/experiment-table/ExperimentTable").then((mod) => ({ default: mod.ExperimentTable })),
)
const ReplayPanel = lazy(() => import("./components/replay-panel/ReplayPanel").then((mod) => ({ default: mod.ReplayPanel })))
const EvidenceBoard = lazy(() =>
	import("./components/evidence-board/EvidenceBoard").then((mod) => ({ default: mod.EvidenceBoard })),
)

// ─── ErrorBoundary for standalone HTML preview panel ─────────────────────

class HtmlPreviewErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
	constructor(props: { children: ReactNode }) {
		super(props)
		this.state = { hasError: false, error: null }
	}

	static getDerivedStateFromError(error: Error) {
		return { hasError: true, error }
	}

	componentDidCatch(error: Error, info: React.ErrorInfo) {
		console.error("[HtmlPreviewErrorBoundary] React crash:", error, info)
	}

	render() {
		if (this.state.hasError) {
			return (
				<div
					style={{
						padding: 24,
						color: "var(--vscode-editor-foreground, #fff)",
						background: "var(--vscode-editor-background, #1e1e1e)",
						height: "100%",
						fontFamily: "monospace",
					}}>
					<h2 style={{ color: "#dc3545", marginBottom: 12 }}>❌ React ErrorBoundary caught a crash</h2>
					<pre style={{ fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
						{this.state.error?.message ?? "Unknown error"}
					</pre>
					<pre style={{ fontSize: 11, opacity: 0.7, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
						{this.state.error?.stack ?? "No stack trace"}
					</pre>
				</div>
			)
		}
		return this.props.children
	}
}

// Check if running in standalone map mode (separate panel)
const isStandaloneMapMode = () => {
	return typeof window !== "undefined" && (window as any).AIHYDRO_MAP_STANDALONE === true
}

// Check if running in standalone HTML preview mode (separate panel)
const isStandaloneHtmlPreviewMode = () => {
	return typeof window !== "undefined" && (window as any).AIHYDRO_HTML_PREVIEW_STANDALONE === true
}

// Check if running in standalone Experiment Table mode (separate panel)
const isStandaloneExperimentTableMode = () => {
	return typeof window !== "undefined" && (window as any).AIHYDRO_EXPERIMENT_TABLE_STANDALONE === true
}

// Check if running in standalone Session Replay mode (separate panel)
const isStandaloneReplayMode = () => {
	return typeof window !== "undefined" && (window as any).AIHYDRO_REPLAY_PANEL_STANDALONE === true
}

// Check if running in standalone Evidence Board mode (separate panel)
const isStandaloneEvidenceBoardMode = () => {
	return typeof window !== "undefined" && (window as any).AIHYDRO_EVIDENCE_BOARD_STANDALONE === true
}

const AppContent = () => {
	// Otherwise, render normal app UI
	const {
		didHydrateState,
		showWelcome,
		shouldShowAnnouncement,
		showMcp,
		mcpTab,
		showSettings,
		showHistory,
		showMap,
		showConnectors,
		showSkills,
		showAnnouncement,
		setShowAnnouncement,
		setShouldShowAnnouncement,
		closeMcpView,
		navigateToHistory,
		hideSettings,
		hideHistory,
		hideMap,
		hideConnectors,
		hideSkills,
		hideAnnouncement,
	} = useExtensionState()

	useEffect(() => {
		if (shouldShowAnnouncement) {
			setShowAnnouncement(true)

			// Use the gRPC client instead of direct WebviewMessage
			UiServiceClient.onDidShowAnnouncement({} as EmptyRequest)
				.then((response: Boolean) => {
					setShouldShowAnnouncement(response.value)
				})
				.catch((error) => {
					console.error("Failed to acknowledge announcement:", error)
				})
		}
	}, [shouldShowAnnouncement, setShouldShowAnnouncement, setShowAnnouncement])

	// Show loading screen with spinner
	if (!didHydrateState) {
		return (
			<div className="flex h-screen w-full items-center justify-center bg-[var(--vscode-editor-background)]">
				<div className="flex flex-col items-center space-y-4">
					<div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--vscode-progressBar-background)] border-t-transparent"></div>
					<div className="text-sm text-[var(--vscode-descriptionForeground)]">Loading AI-Hydro...</div>
				</div>
			</div>
		)
	}

	if (showWelcome) {
		return <WelcomeView />
	}

	return (
		<div className="flex h-screen w-full flex-col">
			{showSettings && <SettingsView onDone={hideSettings} />}
			{showHistory && <HistoryView onDone={hideHistory} />}
			{showMcp && <McpView initialTab={mcpTab} onDone={closeMcpView} />}
			{showConnectors && <ConnectorsView onDone={hideConnectors} />}
			{showSkills && <SkillsView onDone={hideSkills} />}
			{showMap && <MapPanel />}
			{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
			<ChatView
				hideAnnouncement={hideAnnouncement}
				isHidden={showSettings || showHistory || showMcp || showConnectors || showSkills || showMap}
				showAnnouncement={showAnnouncement}
				showHistoryView={navigateToHistory}
			/>
		</div>
	)
}

const App = () => {
	// Check if in standalone map mode and render directly with Providers
	if (isStandaloneMapMode()) {
		return (
			<Providers>
				<div className="flex h-screen w-full">
					{/* MapViewProps only declares mapStyle -- sizing comes from this
					flex wrapper, not props; height/width here were dead (React
					silently ignores unknown props at runtime, so this only ever
					surfaced as a type error, never a behavior difference). */}
					<MapView />
				</div>
			</Providers>
		)
	}

	// Check if in standalone HTML preview mode and render directly with Providers
	if (isStandaloneHtmlPreviewMode()) {
		return (
			<Providers>
				<HtmlPreviewErrorBoundary>
					<div
						style={{
							display: "flex",
							flexDirection: "row",
							width: "100vw",
							height: "100vh",
							minWidth: 0,
							minHeight: 0,
							overflow: "hidden",
						}}>
						<HtmlPreviewPanel />
					</div>
				</HtmlPreviewErrorBoundary>
			</Providers>
		)
	}

	// Check if in standalone Session Replay mode and render directly with Providers
	if (isStandaloneReplayMode()) {
		return (
			<Providers>
				<Suspense fallback={null}>
					<ReplayPanel />
				</Suspense>
			</Providers>
		)
	}

	// Check if in standalone Experiment Table mode and render directly with Providers
	if (isStandaloneExperimentTableMode()) {
		return (
			<Providers>
				<Suspense fallback={null}>
					<ExperimentTable />
				</Suspense>
			</Providers>
		)
	}

	// Check if in standalone Evidence Board mode and render directly with Providers
	if (isStandaloneEvidenceBoardMode()) {
		return (
			<Providers>
				<Suspense fallback={null}>
					<EvidenceBoard />
				</Suspense>
			</Providers>
		)
	}

	return (
		<Providers>
			<AppContent />
		</Providers>
	)
}

export default App
