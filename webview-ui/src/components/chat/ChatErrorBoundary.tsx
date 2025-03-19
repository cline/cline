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
          <h3 style={{ margin: "0 0 8px 0" }}>
            {errorTitle || "Something went wrong displaying this content"}
          </h3>
          <p style={{ margin: "0" }}>
            {errorBody || `Error: ${this.state.error?.message || "Unknown error"}`}
          </p>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * A demo component that throws an error after a delay.
 * This is useful for testing error boundaries during development.
 * It will be removed in production.
 */
export class ErrorAfterDelay extends React.Component {
  private timeoutId: NodeJS.Timeout | null = null

  componentDidMount() {
    // Throw an error after 1 second (reduced from 5 seconds for faster testing)
    this.timeoutId = setTimeout(() => {
      // Using a more direct approach to trigger an error that will be caught by the boundary
      this.setState(() => {
        throw new Error("This is a demo error for testing the error boundary")
      })
    }, 1000)
  }

  componentWillUnmount() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
    }
  }

  render() {
    // Add a small visual indicator that this component will cause an error
    return (
      <div style={{ 
        position: "absolute", 
        top: 0, 
        right: 0,
        background: "rgba(255, 0, 0, 0.2)",
        color: "var(--vscode-errorForeground)",
        padding: "2px 5px",
        fontSize: "10px",
        borderRadius: "0 0 0 4px",
        zIndex: 100
      }}>
        Error in 1s
      </div>
    )
  }
}

export default ChatErrorBoundary
