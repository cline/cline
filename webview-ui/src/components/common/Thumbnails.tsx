import { StringRequest } from "@shared/proto/cline/common"
import React, { memo, useLayoutEffect, useRef, useState } from "react"
import { useWindowSize } from "react-use"
import { FileServiceClient } from "@/services/grpc-client"

interface ThumbnailsProps {
	images: string[]
	files: string[]
	style?: React.CSSProperties
	setImages?: React.Dispatch<React.SetStateAction<string[]>>
	setFiles?: React.Dispatch<React.SetStateAction<string[]>>
	onHeightChange?: (height: number) => void
}

const Thumbnails = ({ images, files, style, setImages, setFiles, onHeightChange }: ThumbnailsProps) => {
	const [hoveredIndex, setHoveredIndex] = useState<string | null>(null)
	const containerRef = useRef<HTMLDivElement>(null)
	const { width } = useWindowSize()

	useLayoutEffect(() => {
		if (containerRef.current) {
			let height = containerRef.current.clientHeight
			// some browsers return 0 for clientHeight
			if (!height) {
				height = containerRef.current.getBoundingClientRect().height
			}
			onHeightChange?.(height)
		}
		setHoveredIndex(null)
	}, [images, files, width, onHeightChange])

	const handleDeleteImages = (index: number) => {
		setImages?.((prevImages) => prevImages.filter((_, i) => i !== index))
	}

	const handleDeleteFiles = (index: number) => {
		setFiles?.((prevFiles) => prevFiles.filter((_, i) => i !== index))
	}

	const isDeletableImages = setImages !== undefined
	const isDeletableFiles = setFiles !== undefined

	const handleImageClick = (image: string) => {
		FileServiceClient.openImage(StringRequest.create({ value: image })).catch((err) =>
			console.error("Failed to open image:", err),
		)
	}

	const handleFileClick = (filePath: string) => {
		FileServiceClient.openFile(StringRequest.create({ value: filePath })).catch((err) =>
			console.error("Failed to open file:", err),
		)
	}

	return (
		<div
			ref={containerRef}
			style={{
				display: "flex",
				flexWrap: "wrap",
				gap: 5,
				rowGap: 3,
				...style,
			}}>
			{images.map((image, index) => (
				<div
					key={`image-${index}`}
					onMouseEnter={() => setHoveredIndex(`image-${index}`)}
					onMouseLeave={() => setHoveredIndex(null)}
					style={{ position: "relative" }}>
					<img
						alt={`Thumbnail image-${index + 1}`}
						onClick={() => handleImageClick(image)}
						src={image}
						style={{
							width: 34,
							height: 34,
							objectFit: "cover",
							borderRadius: 4,
							cursor: "pointer",
						}}
					/>
					{isDeletableImages && hoveredIndex === `image-${index}` && (
						<div
							onClick={() => handleDeleteImages(index)}
							style={{
								position: "absolute",
								top: -4,
								right: -4,
								width: 13,
								height: 13,
								borderRadius: "50%",
								backgroundColor: "var(--vscode-badge-background)",
								display: "flex",
								justifyContent: "center",
								alignItems: "center",
								cursor: "pointer",
							}}>
							<span
								className="codicon codicon-close"
								style={{
									color: "var(--vscode-foreground)",
									fontSize: 10,
									fontWeight: "bold",
								}}></span>
						</div>
					)}
				</div>
			))}

			{files.map((filePath, index) => {
				const fileName = filePath.split(/[\\/]/).pop() || filePath

				return (
					<div
						key={`file-${index}`}
						onMouseEnter={() => setHoveredIndex(`file-${index}`)}
						onMouseLeave={() => setHoveredIndex(null)}
						style={{ position: "relative" }}>
						<div
							onClick={() => handleFileClick(filePath)}
							style={{
								width: 34,
								height: 34,
								borderRadius: 4,
								cursor: "pointer",
								backgroundColor: "var(--vscode-editor-background)",
								border: "1px solid var(--vscode-input-border)",
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								justifyContent: "center",
							}}>
							<span
								className="codicon codicon-file"
								style={{
									fontSize: 16,
									color: "var(--vscode-foreground)",
								}}></span>
							<span
								style={{
									fontSize: 7,
									marginTop: 1,
									overflow: "hidden",
									textOverflow: "ellipsis",
									maxWidth: "90%",
									whiteSpace: "nowrap",
									textAlign: "center",
								}}
								title={fileName}>
								{fileName}
							</span>
						</div>
						{isDeletableFiles && hoveredIndex === `file-${index}` && (
							<div
								onClick={() => handleDeleteFiles(index)}
								style={{
									position: "absolute",
									top: -4,
									right: -4,
									width: 13,
									height: 13,
									borderRadius: "50%",
									backgroundColor: "var(--vscode-badge-background)",
									display: "flex",
									justifyContent: "center",
									alignItems: "center",
									cursor: "pointer",
								}}>
								<span
									className="codicon codicon-close"
									style={{
										color: "var(--vscode-foreground)",
										fontSize: 10,
										fontWeight: "bold",
									}}></span>
							</div>
						)}
					</div>
				)
			})}
		</div>
	)
}

export default memo(Thumbnails)
