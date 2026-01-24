import { StringRequest } from "@shared/proto/cline/common"
import DOMPurify from "dompurify"
import React from "react"
import { useTranslation } from "react-i18next"
import ChatErrorBoundary from "@/components/chat/ChatErrorBoundary"
import { FileServiceClient, WebServiceClient } from "@/services/grpc-client"
import { checkIfImageUrl, formatUrlForOpening, getSafeHostname } from "./utils/mcpRichUtil"

interface ImagePreviewProps {
	url: string
}

// Functional wrapper to use hooks
const ImagePreviewContent: React.FC<ImagePreviewProps> = ({ url }) => {
	const { t } = useTranslation()
	const [loading, setLoading] = React.useState(true)
	const [error, setError] = React.useState<string | null>(null)
	const [fetchStartTime] = React.useState(Date.now())
	const imgRef = React.useRef<HTMLImageElement>(null)
	const timeoutIdRef = React.useRef<NodeJS.Timeout | null>(null)
	const heartbeatIdRef = React.useRef<NodeJS.Timeout | null>(null)

	const cleanup = React.useCallback(() => {
		if (timeoutIdRef.current) {
			clearTimeout(timeoutIdRef.current)
			timeoutIdRef.current = null
		}
		if (heartbeatIdRef.current) {
			clearInterval(heartbeatIdRef.current)
			heartbeatIdRef.current = null
		}
	}, [])

	const handleImageLoad = React.useCallback(() => {
		console.log(`Image loaded successfully: ${url}`)
		setLoading(false)
		cleanup()
	}, [url, cleanup])

	const handleImageError = React.useCallback(() => {
		console.log(`Image failed to load: ${url}`)
		setLoading(false)
		setError(`Failed to load image: ${url}`)
		cleanup()
	}, [url, cleanup])

	React.useEffect(() => {
		timeoutIdRef.current = setTimeout(() => {
			console.log(`Image load timeout for ${url}`)
			if (loading) {
				setLoading(false)
				setError(`Timeout loading image: ${url}`)
			}
		}, 15000)

		heartbeatIdRef.current = setInterval(() => {
			if (loading) {
				// Force re-render for elapsed time
			}
		}, 1000)

		checkIfImageUrl(url)
			.then((isImage) => {
				if (isImage) {
					console.log(`URL is confirmed as image: ${url}`)
				} else {
					console.log(`URL is not an image: ${url}`)
					handleImageError()
				}
			})
			.catch((error) => {
				console.log(`Error checking if URL is an image: ${error}`)
				handleImageError()
			})

		return cleanup
	}, [url, loading, handleImageError, cleanup])

	const elapsedSeconds = loading ? Math.floor((Date.now() - fetchStartTime) / 1000) : 0

	if (loading) {
		return (
			<div
				className="image-preview-loading"
				style={{
					padding: "12px",
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
					{t("mcp.imagePreview.loadingFrom", { hostname: getSafeHostname(url) })}
				</div>
				{elapsedSeconds > 3 && (
					<div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
						{elapsedSeconds > 60
							? `${t("mcp.imagePreview.waitingTime")} ${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s...`
							: `${t("mcp.imagePreview.waitingTime")} ${elapsedSeconds}s...`}
					</div>
				)}
				{/\.svg(\?.*)?$/i.test(url) ? (
					<object
						data={DOMPurify.sanitize(url)}
						onError={handleImageError}
						onLoad={handleImageLoad}
						style={{ display: "none" }}
						type="image/svg+xml"
					/>
				) : (
					<img
						alt=""
						onError={handleImageError}
						onLoad={handleImageLoad}
						ref={imgRef}
						src={DOMPurify.sanitize(url)}
						style={{ display: "none" }}
					/>
				)}
			</div>
		)
	}

	if (error) {
		return (
			<div
				className="image-preview-error"
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
				}}
				style={{
					padding: "12px",
					border: "1px solid var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.3))",
					borderRadius: "4px",
					color: "var(--vscode-errorForeground)",
				}}>
				<div style={{ fontWeight: "bold" }}>{t("mcp.imagePreview.failedToLoadImage")}</div>
				<div style={{ fontSize: "12px", marginTop: "4px" }}>{getSafeHostname(url)}</div>
				<div style={{ fontSize: "11px", marginTop: "8px", color: "var(--vscode-textLink-foreground)" }}>
					{t("mcp.imagePreview.clickToOpenBrowser")}
				</div>
			</div>
		)
	}

	return (
		<div
			className="image-preview"
			onClick={async () => {
				try {
					if (url.startsWith("data:")) {
						await FileServiceClient.openImage(StringRequest.create({ value: url }))
					} else {
						await WebServiceClient.openInBrowser(
							StringRequest.create({
								value: DOMPurify.sanitize(formatUrlForOpening(url)),
							}),
						)
					}
				} catch (err) {
					console.error("Error opening image:", err)
				}
			}}
			style={{
				margin: "10px 0",
				maxWidth: "100%",
				cursor: "pointer",
			}}>
			{/\.svg(\?.*)?$/i.test(url) ? (
				<object
					aria-label={`${t("mcp.imagePreview.svgFrom")} ${getSafeHostname(url)}`}
					data={DOMPurify.sanitize(url)}
					style={{
						width: "100%",
						height: "auto",
						borderRadius: "4px",
					}}
					type="image/svg+xml">
					<img
						alt={`${t("mcp.imagePreview.svgFrom")} ${getSafeHostname(url)}`}
						src={DOMPurify.sanitize(url)}
						style={{
							width: "100%",
							height: "auto",
							borderRadius: "4px",
						}}
					/>
				</object>
			) : (
				<img
					alt={`${t("mcp.imageFrom")} ${getSafeHostname(url)}`}
					loading="eager"
					src={DOMPurify.sanitize(url)}
					style={{
						width: "100%",
						height: "auto",
						borderRadius: "4px",
					}}
				/>
			)}
		</div>
	)
}

const MemoizedImagePreview = React.memo(ImagePreviewContent, (prevProps, nextProps) => prevProps.url === nextProps.url)

const ImagePreviewWithErrorBoundary: React.FC<ImagePreviewProps> = (props) => {
	const { t } = useTranslation()
	return (
		<ChatErrorBoundary errorTitle={t("errors.imagePreviewErrorTitle")}>
			<MemoizedImagePreview {...props} />
		</ChatErrorBoundary>
	)
}

export default ImagePreviewWithErrorBoundary
