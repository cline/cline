import React, { useState } from "react"
import { vscode } from "../../utils/vscode"
import DOMPurify from "dompurify"
import { getSafeHostname, formatUrlForOpening } from "./UrlProcessingService"

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
		console.log("Error in ImagePreview component:", error.message);
	}

	render() {
		if (this.state.hasError) {
			return (
				<div style={{ padding: "10px", color: "var(--vscode-errorForeground)" }}>
					<h3>Something went wrong displaying this image</h3>
					<p>Error: {this.state.error?.message || "Unknown error"}</p>
				</div>
			);
		}

		return this.props.children;
	}
}

interface ImagePreviewProps {
	url: string
}

// Use a class component to ensure complete isolation between instances
class ImagePreview extends React.Component<ImagePreviewProps, {
	loading: boolean;
	error: string | null;
}> {
	constructor(props: ImagePreviewProps) {
		super(props);
		this.state = {
			loading: true,
			error: null
		};
	}
	
	// Handle image load event
	handleImageLoad = () => {
		this.setState({ loading: false });
	}
	
	// Handle image error event
	handleImageError = () => {
		this.setState({
			loading: false,
			error: `Failed to load image: ${this.props.url}`
		});
	}
	
	render() {
		const { url } = this.props;
		const { loading, error } = this.state;
		
		// Fallback display while loading
		if (loading && !error) {
			return (
				<div
					className="image-preview-loading"
					style={{
						padding: "12px",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						border: "1px solid var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.3))",
						borderRadius: "4px",
						height: "200px", // Fixed height for loading state
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
					Loading image from {getSafeHostname(url)}...
				</div>
			);
		}
		
		// Handle error state
		if (error) {
			return (
				<div
					className="image-preview-error"
					style={{
						padding: "12px",
						border: "1px solid var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.3))",
						borderRadius: "4px",
						color: "var(--vscode-errorForeground)",
					}}
					onClick={() => {
						vscode.postMessage({
							type: "openInBrowser",
							url: DOMPurify.sanitize(url),
						});
					}}>
					<div style={{ fontWeight: "bold" }}>Failed to load image</div>
					<div style={{ fontSize: "12px", marginTop: "4px" }}>{getSafeHostname(url)}</div>
					<div style={{ fontSize: "11px", marginTop: "8px", color: "var(--vscode-textLink-foreground)" }}>
						Click to open in browser
					</div>
				</div>
			);
		}
		
		// Render the image
		return (
			<div
				className="image-preview"
				style={{
					margin: "10px 0",
					maxWidth: "100%",
					cursor: "pointer",
				}}
				onClick={() => {
					vscode.postMessage({
						type: "openInBrowser",
						url: DOMPurify.sanitize(formatUrlForOpening(url)),
					});
				}}>
				<img
					src={DOMPurify.sanitize(url)}
					alt={`Image from ${getSafeHostname(url)}`}
					style={{
						width: "85%",
						height: "auto",
						borderRadius: "4px",
					}}
					onLoad={this.handleImageLoad}
					onError={this.handleImageError}
				/>
			</div>
		);
	}
}

// Create a wrapper component that memoizes the ImagePreview to prevent unnecessary re-renders
const MemoizedImagePreview = React.memo(
	(props: ImagePreviewProps) => <ImagePreview {...props} />,
	(prevProps, nextProps) => prevProps.url === nextProps.url // Only re-render if URL changes
);

// Wrap the ImagePreview component with an error boundary
const ImagePreviewWithErrorBoundary: React.FC<ImagePreviewProps> = (props) => {
	return (
		<ErrorBoundary>
			<MemoizedImagePreview {...props} />
		</ErrorBoundary>
	);
};

export default ImagePreviewWithErrorBoundary;
