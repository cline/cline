import React, { useState, useRef, useLayoutEffect, memo } from "react"
import { useWindowSize } from "react-use"
import { vscode } from "@src/utils/vscode"

interface ThumbnailsProps {
	images: string[]
	style?: React.CSSProperties
	setImages?: React.Dispatch<React.SetStateAction<string[]>>
	onHeightChange?: (height: number) => void
}

const Thumbnails = ({ images, style, setImages, onHeightChange }: ThumbnailsProps) => {
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
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
	}, [images, width, onHeightChange])

	const handleDelete = (index: number) => {
		setImages?.((prevImages) => prevImages.filter((_, i) => i !== index))
	}

	const isDeletable = setImages !== undefined

	const handleImageClick = (image: string) => {
		vscode.postMessage({ type: "openImage", text: image })
	}

	return (
		<div ref={containerRef} className="flex flex-wrap gap-[5px] gap-y-[3px]" style={style}>
			{images.map((image, index) => (
				<div
					key={index}
					className="relative"
					onMouseEnter={() => setHoveredIndex(index)}
					onMouseLeave={() => setHoveredIndex(null)}>
					<img
						src={image}
						alt={`Thumbnail ${index + 1}`}
						className="w-[34px] h-[34px] object-cover rounded cursor-pointer"
						onClick={() => handleImageClick(image)}
					/>
					{isDeletable && hoveredIndex === index && (
						<div
							onClick={() => handleDelete(index)}
							className="absolute -top-1 -right-1 w-[13px] h-[13px] rounded-full bg-vscode-badge-background flex justify-center items-center cursor-pointer">
							<span className="codicon codicon-close text-vscode-foreground text-[10px] font-bold"></span>
						</div>
					)}
				</div>
			))}
		</div>
	)
}

export default memo(Thumbnails)
