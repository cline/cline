import React, { useEffect, useState } from "react"
import { vscode } from "../../utils/vscode"
import DOMPurify from "dompurify"
import { getSafeHostname } from "./UrlProcessingService"

// Error boundary component to prevent crashes
class ErrorBoundary extends React.Component<
	{ children: React.ReactNode },
	{ hasError: boolean; error: Error | null }
> {
	constructor(props: { children: React.ReactNode }) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error) {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.log("Error in LinkPreview component:", error.message);
	}

	render() {
		if (this.state.hasError) {
			return (
				<div style={{ padding: "10px", color: "var(--vscode-errorForeground)" }}>
					<h3>Something went wrong displaying this link preview</h3>
					<p>Error: {this.state.error?.message || "Unknown error"}</p>
				</div>
			);
		}

		return this.props.children;
	}
}

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

const LinkPreview: React.FC<LinkPreviewProps> = ({ url }) => {
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [ogData, setOgData] = useState<OpenGraphData | null>(null)

	useEffect(() => {
		const fetchOpenGraphData = async () => {
			try {
				setLoading(true)

				// Send a message to the extension to fetch Open Graph data
				vscode.postMessage({
					type: "fetchOpenGraphData",
					text: url,
				})

				// Set up a listener for the response
				const messageListener = (event: MessageEvent) => {
					const message = event.data
					if (message.type === "openGraphData" && message.url === url) {
						setOgData(message.openGraphData)
						setLoading(false)
						window.removeEventListener("message", messageListener)
					}
				}

				window.addEventListener("message", messageListener)

				// Set a timeout to avoid hanging indefinitely
				const timeoutId = setTimeout(() => {
					window.removeEventListener("message", messageListener)
					// Fallback to basic data if timeout occurs
					setOgData({
						title: getSafeHostname(url),
						description: "Preview timed out. Click to open in browser.",
						siteName: getSafeHostname(url),
						url: url,
					})
					setLoading(false)
				}, 5000)

				// Clean up the listener and timeout if the component unmounts
				return () => {
					window.removeEventListener("message", messageListener)
					clearTimeout(timeoutId)
				}
			} catch (err) {
				setError("Failed to fetch preview data")
				setLoading(false)
			}
		}

		// Fetch Open Graph data immediately when component mounts
		fetchOpenGraphData()
	}, [url])


	// Fallback display while loading
	if (loading) {
		return (
			<div
				className="link-preview-loading"
				style={{
					padding: "12px",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					border: "1px solid var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.3))",
					borderRadius: "4px",
				}}>
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
		)
	}

	// Handle error state
	if (error) {
		return (
			<div
				className="link-preview-error"
				style={{
					padding: "12px",
					border: "1px solid var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.3))",
					borderRadius: "4px",
					color: "var(--vscode-errorForeground)",
				}}>
				Unable to load preview for {getSafeHostname(url)}
			</div>
		);
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
			}}
			onClick={() => {
				vscode.postMessage({
					type: "openInBrowser",
					url: DOMPurify.sanitize(url),
				})
			}}>
			{data.image && (
				<div className="link-preview-image" style={{ width: "128px", height: "128px", flexShrink: 0 }}>
					<ErrorBoundary>
						<img
							src={DOMPurify.sanitize(data.image)}
							alt=""
							style={{
								width: "100%",
								height: "100%",
								objectFit: "cover",
							}}
							onError={(e) => {
								console.log(`Image could not be loaded: ${data.image}`);
								// Hide the broken image
								(e.target as HTMLImageElement).style.display = 'none';
							}}
						/>
					</ErrorBoundary>
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
				}}>
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
						marginBottom: "8px",
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
					}}>
					{data.siteName || getSafeHostname(url)}
				</div>

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
	)
}

// Wrap the LinkPreview component with an error boundary
const LinkPreviewWithErrorBoundary: React.FC<LinkPreviewProps> = (props) => {
	return (
		<ErrorBoundary>
			<LinkPreview {...props} />
		</ErrorBoundary>
	);
};

export default LinkPreviewWithErrorBoundary;
