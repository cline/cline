import React from "react"
import { ImageViewer } from "./ImageViewer"

/**
 * Props for the ImageBlock component
 */
interface ImageBlockProps {
	/**
	 * The webview-accessible URI for rendering the image.
	 * This is the preferred format for new image generation tools.
	 * Should be a URI that can be directly loaded in the webview context.
	 */
	imageUri?: string

	/**
	 * The actual file path for display purposes and file operations.
	 * Used to show the path to the user and for opening the file in the editor.
	 * This is typically an absolute or relative path to the image file.
	 */
	imagePath?: string

	/**
	 * Base64 data or regular URL for backward compatibility.
	 * @deprecated Use imageUri instead for new implementations.
	 * This is maintained for compatibility with Mermaid diagrams and legacy code.
	 */
	imageData?: string

	/**
	 * Optional path for Mermaid diagrams.
	 * @deprecated Use imagePath instead for new implementations.
	 * This is maintained for backward compatibility with existing Mermaid diagram rendering.
	 */
	path?: string
}

export default function ImageBlock({ imageUri, imagePath, imageData, path }: ImageBlockProps) {
	// Determine which props to use based on what's provided
	let finalImageUri: string
	let finalImagePath: string | undefined

	if (imageUri) {
		// New format: explicit imageUri and imagePath
		finalImageUri = imageUri
		finalImagePath = imagePath
	} else if (imageData) {
		// Legacy format: use imageData as direct URI (for Mermaid diagrams)
		finalImageUri = imageData
		finalImagePath = path
	} else {
		// No valid image data provided
		console.error("ImageBlock: No valid image data provided")
		return null
	}

	return (
		<div className="my-2">
			<ImageViewer
				imageUri={finalImageUri}
				imagePath={finalImagePath}
				alt="AI Generated Image"
				showControls={true}
			/>
		</div>
	)
}
