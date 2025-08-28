import React from "react"
import { ImageViewer } from "./ImageViewer"

interface ImageBlockProps {
	imageData: string
	path?: string
}

export default function ImageBlock({ imageData, path }: ImageBlockProps) {
	return (
		<div className="my-2">
			<ImageViewer imageData={imageData} path={path} alt="AI Generated Image" showControls={true} />
		</div>
	)
}
