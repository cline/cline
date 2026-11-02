"use client";

import { SUPPORTED_IMAGE_MEDIA_TYPES } from "@cline/shared/browser";
import {
	GeneratedMediaContent,
	type GeneratedMediaContentProps,
} from "@cline/ui";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	type ArtifactReference,
	useArtifactResource,
} from "@/hooks/use-artifact-resource";

type Props = GeneratedMediaContentProps & {
	sessionId: string | null;
	/** Disable controls when rendered inside a selection button. */
	interactive?: boolean;
};

export function ArtifactImage(props: Props) {
	const { media, sessionId } = props;
	if (
		media.source.type !== "artifact" ||
		media.modality !== "image" ||
		!SUPPORTED_IMAGE_MEDIA_TYPES.some((type) => type === media.mediaType) ||
		!sessionId
	) {
		return <GeneratedMediaContent {...props} />;
	}
	return (
		<ResolvedArtifactImage
			{...props}
			sessionId={sessionId}
			reference={media.source}
		/>
	);
}

function ResolvedArtifactImage({
	media,
	sessionId,
	reference,
	className,
	classNames,
	interactive = true,
}: Props & {
	sessionId: string;
	reference: ArtifactReference;
}) {
	const container = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);
	const { state, load, retry, reportLoadError } = useArtifactResource({
		sessionId,
		reference,
	});

	useEffect(() => {
		const element = container.current;
		if (!element) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setVisible(true);
					observer.disconnect();
				}
			},
			{ rootMargin: "200px" },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (visible) void load();
	}, [visible, load]);

	return (
		<div ref={container} data-media-id={media.id} className={className}>
			{state.status === "error" ? (
				<output className={classNames?.unavailable ?? className}>
					Image unavailable.{" "}
					{interactive && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void retry()}
						>
							Retry
						</Button>
					)}
				</output>
			) : state.status === "ready" ? (
				// biome-ignore lint/performance/noImgElement: Load the access resource directly without the Next image proxy.
				<img
					key={state.attempt}
					alt={media.name ?? "Published image"}
					src={state.resource.url}
					className={classNames?.image ?? className}
					referrerPolicy="no-referrer"
					onError={() => reportLoadError(state.attempt)}
				/>
			) : (
				<output className="text-sm text-muted-foreground">
					Loading image…
				</output>
			)}
		</div>
	);
}
