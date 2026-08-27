"use client";

import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauriAvailable } from "@/lib/desktop-client";
import { TOOL_RESULT_MEDIA_VIDEO_CLASS } from "./tool-result-media";

export function resolveToolResultVideoSource(
	videoPath: string,
): string | undefined {
	if (!isTauriAvailable()) return undefined;
	try {
		return convertFileSrc(videoPath);
	} catch {
		return undefined;
	}
}

export function ToolResultVideo({
	mediaType,
	videoPath,
}: {
	mediaType: string;
	videoPath: string;
}) {
	const source = resolveToolResultVideoSource(videoPath);
	if (!source) {
		return (
			<div
				className="rounded-lg border border-border bg-muted p-3 text-sm"
				data-testid="tool-result-video-unavailable"
			>
				Video saved at <span className="font-mono break-all">{videoPath}</span>
			</div>
		);
	}

	return (
		// biome-ignore lint/a11y/useMediaCaption: Agent-recorded videos do not include a caption track.
		<video
			aria-label="Tool result video"
			className={TOOL_RESULT_MEDIA_VIDEO_CLASS}
			controls
			preload="metadata"
		>
			<source src={source} type={mediaType} />
		</video>
	);
}
