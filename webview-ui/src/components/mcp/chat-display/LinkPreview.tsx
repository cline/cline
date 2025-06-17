import ChatErrorBoundary from "@/components/chat/ChatErrorBoundary"
import { WebServiceClient } from "@/services/grpc-client"
import { StringRequest } from "@shared/proto/common"
import DOMPurify from "dompurify"
import React from "react"
import { getSafeHostname, normalizeRelativeUrl } from "./utils/mcpRichUtil"

interface OpenGraphData {
	title?: string
	description?: string
	image?: string
	url?: string
	siteName?: string
	type?: string
}

interface LinkPreviewProps {
	url: string
}

interface LinkPreviewState {
	loading: boolean
	error: ErrorType
	errorMessage: string | null
	ogData: OpenGraphData | null
	/**
	 * Track if fetch has completed (success or error)
	 */
	hasCompletedFetch: boolean
	/**
	 * Track when the fetch started
	 */
	fetchStartTime: number
}

// Error types for better UI feedback
type ErrorType = "timeout" | "network" | "general" | null

// Use a class component to ensure complete isolation between instances
class LinkPreview extends React.Component<LinkPreviewProps, LinkPreviewState> {
	private messageListener: ((event: MessageEvent) => void) | null = null
	private timeoutId: NodeJS.Timeout | null = null
	private heartbeatId: NodeJS.Timeout | null = null

	constructor(props: LinkPreviewProps) {
		super(props)
		this.state = {
			loading: true,
			error: null,
			errorMessage: null,
			ogData: null,
			hasCompletedFetch: false,
			fetchStartTime: 0,
		}
	}

	componentDidMount() {
		// Only fetch if we haven't completed a fetch yet
		if (!this.state.hasCompletedFetch) {
			this.fetchOpenGraphData()
		}
	}

	componentWillUnmount() {
		this.cleanup()
	}

	// Prevent updates if fetch has completed
	shouldComponentUpdate(nextProps: LinkPreviewProps, nextState: LinkPreviewState) {
		// If URL changes, allow update
		if (nextProps.url !== this.props.url) {
			return true
		}

		// If we've completed a fetch and state hasn't changed, prevent update
		if (
			this.state.hasCompletedFetch &&
			this.state.loading === nextState.loading &&
			this.state.error === nextState.error &&
			this.state.ogData === nextState.ogData
		) {
			return false
		}

		return true
	}

	private cleanup() {
		// Clean up event listeners and timeouts
		if (this.messageListener) {
			window.removeEventListener("message", this.messageListener)
			this.messageListener = null
		}

		if (this.timeoutId) {
			clearTimeout(this.timeoutId)
			this.timeoutId = null
		}

		if (this.heartbeatId) {
			clearInterval(this.heartbeatId)
			this.heartbeatId = null
		}
	}

	private async fetchOpenGraphData() {
		try {
			// Record fetch start time
			const startTime = Date.now()
			this.setState({ fetchStartTime: startTime })

			// Use the gRPC client to fetch Open Graph data
			const response = await WebServiceClient.fetchOpenGraphData(
				StringRequest.create({
					value: this.props.url,
				}),
			)

			// Process the response
			if (response) {
				const ogData: OpenGraphData = {
					title: response.title || undefined,
					description: response.description || undefined,
					image: response.image || undefined,
					url: response.url || undefined,
					siteName: response.siteName || undefined,
					type: response.type || undefined,
				}

				this.setState({
					ogData,
					loading: false,
					hasCompletedFetch: true,
				})
			} else {
				this.setState({
					error: "network",
					errorMessage: "Failed to fetch Open Graph data",
					loading: false,
					hasCompletedFetch: true,
				})
			}

			// Clean up the heartbeat interval
			// (No message listener is needed with gRPC, unlike the previous message-based approach)
			this.cleanup()

			// Set up heartbeat for loading indicator
			this.heartbeatId = setInterval(() => {
				const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000)
				if (elapsedSeconds > 0) {
					this.forceUpdate() // Just update the component to show new elapsed time
				}
			}, 1000)
		} catch (err) {
			this.setState({
				error: "general",
				errorMessage: err instanceof Error ? err.message : "Unknown error occurred",
				loading: false,
				hasCompletedFetch: true, // Mark as completed on error
			})
			this.cleanup()
		}
	}

	render() {
		const { url } = this.props
		const { loading, error, errorMessage, ogData, fetchStartTime } = this.state

		// Calculate elapsed time for loading state
		const elapsedSeconds = loading ? Math.floor((Date.now() - fetchStartTime) / 1000) : 0

		// Fallback display while loading
		if (loading) {
			return (
				<div
					className="link-preview-loading"
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						border: "1px solid var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.3))",
						borderRadius: "4px",
						height: "128px",
						maxWidth: "512px",
					}}>
					<div style={{ display: "flex", alignItems: "center", marginBottom: "8px" }}>
						<div
							className="loading-spinner"
							style={{
								marginRight: "8px",
								width: "16px",
								height: "16px",
								border: "2px solid rgba(127, 127, 127, 0.3)",
								borderTopColor: "var(--vscode-textLink-foreground, #3794ff)",
								borderRadius: "50%",
								animation: "spin 1s linear infinite",
							}}
						/>
						<style>
							{`
								@keyframes spin {
									to { transform: rotate(360deg); }
								}
							`}
						</style>
						Loading preview for {getSafeHostname(url)}...
					</div>
					{elapsedSeconds > 5 && (
						<div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
							{elapsedSeconds > 60
								? `Waiting for ${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s...`
								: `Waiting for ${elapsedSeconds}s...`}
						</div>
					)}
				</div>
			)
		}

		// Handle different error states with specific messages
		if (error) {
			let errorDisplay = "Unable to load preview"

			if (error === "timeout") {
				errorDisplay = "Preview request timed out"
			} else if (error === "network") {
				errorDisplay = "Network error loading preview"
			}

			return (
				<div
					className="link-preview-error"
					style={{
						padding: "12px",
						border: "1px solid var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.3))",
						borderRadius: "4px",
						color: "var(--vscode-errorForeground)",
						height: "128px",
						maxWidth: "512px",
						overflow: "auto",
					}}
					onClick={async () => {
						try {
							await WebServiceClient.openInBrowser(
								StringRequest.create({
									value: DOMPurify.sanitize(url),
								}),
							)
						} catch (err) {
							console.error("Error opening URL in browser:", err)
						}
					}}>
					<div style={{ fontWeight: "bold" }}>{errorDisplay}</div>
					<div style={{ fontSize: "12px", marginTop: "4px" }}>{getSafeHostname(url)}</div>
					{errorMessage && <div style={{ fontSize: "11px", marginTop: "4px", opacity: 0.8 }}>{errorMessage}</div>}
					<div style={{ fontSize: "11px", marginTop: "8px", color: "var(--vscode-textLink-foreground)" }}>
						Click to open in browser
					</div>
				</div>
			)
		}

		// Create a fallback object if ogData is null
		const data = ogData || {
			title: getSafeHostname(url),
			description: "No description available",
			siteName: getSafeHostname(url),
			url: url,
		}

		// Render the Open Graph preview
		return (
			<div
				className="link-preview"
				style={{
					display: "flex",
					border: "1px solid var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.3))",
					borderRadius: "4px",
					overflow: "hidden",
					cursor: "pointer",
					height: "128px",
					maxWidth: "512px",
				}}
				onClick={async () => {
					try {
						await WebServiceClient.openInBrowser(
							StringRequest.create({
								value: DOMPurify.sanitize(url),
							}),
						)
					} catch (err) {
						console.error("Error opening URL in browser:", err)
					}
				}}>
				{data.image && (
					<div className="link-preview-image" style={{ width: "128px", height: "128px", flexShrink: 0 }}>
						<img
							src={DOMPurify.sanitize(normalizeRelativeUrl(data.image, url))}
							alt=""
							style={{
								width: "100%",
								height: "100%",
								objectFit: "contain", // Use contain for link preview thumbnails to handle logos
								objectPosition: "center", // Center the image
							}}
							onLoad={(e) => {
								// Check aspect ratio to determine if we should use contain or cover
								const img = e.currentTarget
								if (img.naturalWidth > 0 && img.naturalHeight > 0) {
									const aspectRatio = img.naturalWidth / img.naturalHeight

									// Use contain for extreme aspect ratios (logos), cover for photos
									if (aspectRatio > 2.5 || aspectRatio < 0.4) {
										img.style.objectFit = "contain"
									} else {
										img.style.objectFit = "cover"
									}
								}
							}}
							onError={(e) => {
								console.log(`Image could not be loaded: ${data.image}`)
								// Hide the broken image
								;(e.target as HTMLImageElement).style.display = "none"
							}}
						/>
					</div>
				)}

				<div
					className="link-preview-content"
					style={{
						flex: 1,
						padding: "12px",
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
						height: "100%", // Ensure full height
					}}>
					{/* Top section with title and URL - top aligned */}
					<div className="link-preview-top">
						<div
							className="link-preview-title"
							style={{
								fontWeight: "bold",
								marginBottom: "4px",
								whiteSpace: "nowrap",
								overflow: "hidden",
								textOverflow: "ellipsis",
							}}>
							{data.title || "No title"}
						</div>

						<div
							className="link-preview-url"
							style={{
								fontSize: "12px",
								color: "var(--vscode-textLink-foreground, #3794ff)",
								marginBottom: "8px", // Increased for better separation
								whiteSpace: "nowrap",
								overflow: "hidden",
								textOverflow: "ellipsis",
							}}>
							{data.siteName || getSafeHostname(url)}
						</div>
					</div>

					{/* Description with space-around in the remaining space */}
					<div
						className="link-preview-description-container"
						style={{
							flex: 1, // Take up remaining space
							display: "flex",
							flexDirection: "column",
							justifyContent: "space-around", // Space around in the remaining area
						}}>
						<div
							className="link-preview-description"
							style={{
								fontSize: "12px",
								color: "var(--vscode-descriptionForeground, rgba(204, 204, 204, 0.7))",
								overflow: "hidden",
								display: "-webkit-box",
								WebkitLineClamp: 3,
								WebkitBoxOrient: "vertical",
								textOverflow: "ellipsis",
							}}>
							{data.description || "No description available"}
						</div>
					</div>
				</div>
			</div>
		)
	}
}

// Create a wrapper component that memoizes the LinkPreview to prevent unnecessary re-renders
const MemoizedLinkPreview = React.memo(
	(props: LinkPreviewProps) => <LinkPreview {...props} />,
	(prevProps, nextProps) => prevProps.url === nextProps.url, // Only re-render if URL changes
)

// Wrap the LinkPreview component with an error boundary
const LinkPreviewWithErrorBoundary: React.FC<LinkPreviewProps> = (props) => {
	return (
		<ChatErrorBoundary errorTitle="Something went wrong displaying this link preview">
			<MemoizedLinkPreview {...props} />
		</ChatErrorBoundary>
	)
}

export default LinkPreviewWithErrorBoundary
