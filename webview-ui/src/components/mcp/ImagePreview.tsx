import React, { useEffect, useRef } from "react"
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
	fetchStartTime: number;
}> {
	private imgRef = React.createRef<HTMLImageElement>();
	private timeoutId: NodeJS.Timeout | null = null;
	private heartbeatId: NodeJS.Timeout | null = null;
	
	constructor(props: ImagePreviewProps) {
		super(props);
		this.state = {
			loading: true,
			error: null,
			fetchStartTime: Date.now()
		};
		
		console.log(`ImagePreview constructor for ${props.url}`);
	}
	
	componentDidMount() {
		console.log(`ImagePreview mounted for ${this.props.url}`);
		
		// Set up a timeout to handle cases where the image never loads or errors
		this.timeoutId = setTimeout(() => {
			console.log(`Image load timeout for ${this.props.url}`);
			if (this.state.loading) {
				this.setState({
					loading: false,
					error: `Timeout loading image: ${this.props.url}`
				});
			}
		}, 15000); // Reduced from 30s to 15s timeout
		
		// Set up a heartbeat to update the UI with elapsed time
		this.heartbeatId = setInterval(() => {
			if (this.state.loading) {
				this.forceUpdate(); // Just update the component to show new elapsed time
			}
		}, 1000);
		
		// Create a test image to check if the URL loads
		const testImg = new Image();
		testImg.onload = () => {
			console.log(`Test image loaded successfully: ${this.props.url}`);
			this.handleImageLoad();
		};
		testImg.onerror = () => {
			console.log(`Test image failed to load: ${this.props.url}`);
			this.handleImageError();
		};
		
		// Force CORS mode to be anonymous to avoid CORS issues
		testImg.crossOrigin = "anonymous";
		
		// Add a cache-busting parameter to avoid browser caching
		const cacheBuster = `?_cb=${Date.now()}`;
		testImg.src = this.props.url.includes('?') 
			? `${this.props.url}&_cb=${Date.now()}` 
			: `${this.props.url}${cacheBuster}`;
		
		// Also try direct fetch to check if the URL is accessible
		fetch(this.props.url, { 
			method: 'HEAD',
			mode: 'no-cors' // This allows checking if the resource exists without CORS issues
		})
		.then(response => {
			console.log(`Fetch HEAD check successful for ${this.props.url}`);
		})
		.catch(error => {
			console.log(`Fetch HEAD check failed for ${this.props.url}: ${error.message}`);
		});
	}
	
	componentWillUnmount() {
		console.log(`ImagePreview unmounting for ${this.props.url}`);
		this.cleanup();
	}
	
	private cleanup() {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
		
		if (this.heartbeatId) {
			clearInterval(this.heartbeatId);
			this.heartbeatId = null;
		}
	}
	
	// Handle image load event
	handleImageLoad = () => {
		console.log(`Image loaded successfully: ${this.props.url}`);
		this.setState({ loading: false });
		this.cleanup();
	}
	
	// Handle image error event
	handleImageError = () => {
		console.log(`Image failed to load: ${this.props.url}`);
		this.setState({
			loading: false,
			error: `Failed to load image: ${this.props.url}`
		});
		this.cleanup();
	}
	
	render() {
		const { url } = this.props;
		const { loading, error, fetchStartTime } = this.state;
		
		// Calculate elapsed time for loading state
		const elapsedSeconds = loading ? Math.floor((Date.now() - fetchStartTime) / 1000) : 0;
		
		// Fallback display while loading
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
						height: "200px", // Fixed height for loading state
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
						Loading image from {getSafeHostname(url)}...
					</div>
					{elapsedSeconds > 3 && (
						<div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
							{elapsedSeconds > 60 
								? `Waiting for ${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s...` 
								: `Waiting for ${elapsedSeconds}s...`}
						</div>
					)}
					{/* Hidden image that we'll use to detect load/error events */}
					<img 
						src={DOMPurify.sanitize(url)}
						alt=""
						ref={this.imgRef}
						onLoad={this.handleImageLoad}
						onError={this.handleImageError}
						style={{ display: 'none' }}
					/>
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
					loading="eager" // Changed from lazy to eager
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
