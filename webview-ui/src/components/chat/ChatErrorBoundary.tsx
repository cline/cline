import React from "react"

interface ChatErrorBoundaryProps {
	children: React.ReactNode
	errorTitle?: string
	errorBody?: string
	height?: string
}

interface ChatErrorBoundaryState {
	hasError: boolean
	error: Error | null
}

/**
 * A reusable error boundary component specifically designed for chat widgets.
 * It provides a consistent error UI with customizable title and body text.
 */
export class ChatErrorBoundary extends React.Component<ChatErrorBoundaryProps, ChatErrorBoundaryState> {
	constructor(props: ChatErrorBoundaryProps) {
		super(props)
		this.state = { hasError: false, error: null }
	}

	static getDerivedStateFromError(error: Error) {
		return { hasError: true, error }
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.error("Error in ChatErrorBoundary:", error.message)
		console.error("Component stack:", errorInfo.componentStack)
	}

	render() {
		const { errorTitle, errorBody, height } = this.props

		if (this.state.hasError) {
			return (
				<div
					style={{
						padding: "10px",
						color: "var(--vscode-errorForeground)",
						height: height || "auto",
						maxWidth: "512px",
						overflow: "auto",
						border: "1px solid var(--vscode-editorError-foreground)",
						borderRadius: "4px",
						backgroundColor: "var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.1))",
					}}>
					<h3 style={{ margin: "0 0 8px 0" }}>{errorTitle || "Something went wrong displaying this content"}</h3>
					<p style={{ margin: "0" }}>{errorBody || `Error: ${this.state.error?.message || "Unknown error"}`}</p>
				</div>
			)
		}

		return this.props.children
	}
}

/**
 * A demo component that throws an error after a delay.
 * This is useful for testing error boundaries during development
 */
interface ErrorAfterDelayProps {
	numSecondsToWait?: number
}

interface ErrorAfterDelayState {
	tickCount: number
}

export class ErrorAfterDelay extends React.Component<ErrorAfterDelayProps, ErrorAfterDelayState> {
	private intervalID: NodeJS.Timeout | null = null

	constructor(props: ErrorAfterDelayProps) {
		super(props)
		this.state = {
			tickCount: 0,
		}
	}

	componentDidMount() {
		const secondsToWait = this.props.numSecondsToWait ?? 5

		this.intervalID = setInterval(() => {
			if (this.state.tickCount >= secondsToWait) {
				if (this.intervalID) {
					clearInterval(this.intervalID)
				}
				// Error boundaries don't catch async code :(
				// So this only works by throwing inside of a setState
				this.setState(() => {
					throw new Error("This is an error for testing the error boundary")
				})
			} else {
				this.setState({
					tickCount: this.state.tickCount + 1,
				})
			}
		}, 1000)
	}

	componentWillUnmount() {
		if (this.intervalID) {
			clearInterval(this.intervalID)
		}
	}

	render() {
		// Add a small visual indicator that this component will cause an error
		return (
			<div
				style={{
					position: "absolute",
					top: 0,
					right: 0,
					background: "rgba(255, 0, 0, 0.5)",
					color: "var(--vscode-errorForeground)",
					padding: "2px 5px",
					fontSize: "12px",
					borderRadius: "0 0 0 4px",
					zIndex: 100,
				}}>
				Error in {this.state.tickCount}/{this.props.numSecondsToWait ?? 5} seconds
			</div>
		)
	}
}

export default ChatErrorBoundary
