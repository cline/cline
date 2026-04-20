import React from "react"
import WebviewStatus from "./WebviewStatus"

interface WebviewErrorBoundaryProps {
	children: React.ReactNode
}

interface WebviewErrorBoundaryState {
	hasError: boolean
	error: Error | null
}

export class WebviewErrorBoundary extends React.Component<WebviewErrorBoundaryProps, WebviewErrorBoundaryState> {
	constructor(props: WebviewErrorBoundaryProps) {
		super(props)
		this.state = { hasError: false, error: null }
	}

	static getDerivedStateFromError(error: Error): WebviewErrorBoundaryState {
		return { hasError: true, error }
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.error("[WebviewErrorBoundary] Uncaught root error:", error)
		console.error("[WebviewErrorBoundary] Component stack:", errorInfo.componentStack)
	}

	private reloadWebview = () => {
		window.location.reload()
	}

	render() {
		if (this.state.hasError) {
			return (
				<WebviewStatus
					description="The UI hit an unexpected error while rendering. Reload the webview to recover without reloading the full VS Code window."
					details={this.state.error?.stack || this.state.error?.message}
					onReload={this.reloadWebview}
					title="Cline webview crashed"
				/>
			)
		}

		return this.props.children
	}
}

export default WebviewErrorBoundary
