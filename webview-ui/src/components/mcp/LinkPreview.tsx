import React, { useEffect, useState } from "react"
import { vscode } from "../../utils/vscode"

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

				// Clean up the listener if the component unmounts
				return () => {
					window.removeEventListener("message", messageListener)
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
				Loading preview for {new URL(url).hostname}...
			</div>
		)
	}

	// Create a fallback object if ogData is null
	const data = ogData || {
		title: new URL(url).hostname,
		description: "No description available",
		siteName: new URL(url).hostname,
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
					url: url,
				})
			}}>
			{data.image && (
				<div className="link-preview-image" style={{ width: "128px", height: "128px", flexShrink: 0 }}>
					<img
						src={data.image}
						alt=""
						style={{
							width: "100%",
							height: "100%",
							objectFit: "cover",
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
					{data.siteName || new URL(url).hostname}
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

export default LinkPreview
