/**
 * PhotoStrip — renders a horizontal strip of site-visit photo thumbnails from
 * local filesystem paths. Each path is resolved to a webview URI on mount;
 * clicking a thumbnail opens a full-size lightbox overlay.
 */
import React, { useEffect, useState } from "react"
import { resolveFileUri } from "./resolveFileUri"

interface ResolvedThumbProps {
	path: string
	size: number
	onOpen: (uri: string) => void
}

const ResolvedThumb: React.FC<ResolvedThumbProps> = ({ path, size, onOpen }) => {
	const [uri, setUri] = useState<string | null>(null)
	const [failed, setFailed] = useState(false)

	useEffect(() => {
		let alive = true
		resolveFileUri(path)
			.then(({ uri }) => alive && setUri(uri))
			.catch(() => alive && setFailed(true))
		return () => {
			alive = false
		}
	}, [path])

	if (failed) {
		return (
			<div
				style={{
					width: size,
					height: size,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					border: "1px solid var(--vscode-panel-border)",
					borderRadius: 4,
					fontSize: 10,
					opacity: 0.6,
				}}
				title={`Could not load ${path}`}>
				?
			</div>
		)
	}

	return (
		<img
			alt={path.split("/").pop() ?? "photo"}
			onClick={() => uri && onOpen(uri)}
			src={uri ?? undefined}
			style={{
				width: size,
				height: size,
				objectFit: "cover",
				borderRadius: 4,
				cursor: uri ? "pointer" : "default",
				background: "var(--vscode-editor-background)",
				border: "1px solid var(--vscode-panel-border)",
			}}
			title={path.split("/").pop()}
		/>
	)
}

interface PhotoStripProps {
	paths: string[]
	thumbSize?: number
}

export const PhotoStrip: React.FC<PhotoStripProps> = ({ paths, thumbSize = 56 }) => {
	const [lightbox, setLightbox] = useState<string | null>(null)
	if (!paths || paths.length === 0) {
		return null
	}
	return (
		<>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
				{paths.map((p) => (
					<ResolvedThumb key={p} onOpen={setLightbox} path={p} size={thumbSize} />
				))}
			</div>
			{lightbox && (
				<div
					onClick={() => setLightbox(null)}
					style={{
						position: "fixed",
						inset: 0,
						background: "rgba(0,0,0,0.85)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						zIndex: 9999,
						cursor: "zoom-out",
					}}>
					<img alt="site photo" src={lightbox} style={{ maxWidth: "92%", maxHeight: "92%", objectFit: "contain" }} />
				</div>
			)}
		</>
	)
}
