"use client";

import type { CloudArtifactDownload } from "@cline/core/cloud";
import { SUPPORTED_IMAGE_MEDIA_TYPES } from "@cline/shared/browser";
import {
	GeneratedMediaContent,
	type GeneratedMediaContentProps,
} from "@cline/ui";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "@/contexts/account-context";
import { desktopClient } from "@/lib/desktop-client";

type Props = GeneratedMediaContentProps & { sessionId: string | null };

export function CloudArtifactImage(props: Props) {
	const { user } = useAccount();
	const { media, sessionId } = props;
	if (
		media.source.type !== "artifact" ||
		media.modality !== "image" ||
		!SUPPORTED_IMAGE_MEDIA_TYPES.some((type) => type === media.mediaType) ||
		!sessionId
	) {
		return <GeneratedMediaContent {...props} />;
	}
	if (!user) return <div>Sign in to load this image.</div>;
	return (
		<ArtifactImage
			key={JSON.stringify([user.id, sessionId, media.source.artifactId])}
			{...props}
			sessionId={sessionId}
			artifactId={media.source.artifactId}
		/>
	);
}

function ArtifactImage({
	media,
	sessionId,
	artifactId,
	className,
	classNames,
}: Props & {
	sessionId: string;
	artifactId: string;
}) {
	const container = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const [url, setUrl] = useState<string>();
	const [failed, setFailed] = useState(false);

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

	// biome-ignore lint/correctness/useExhaustiveDependencies: attempt triggers a fresh URL request on retry.
	useEffect(() => {
		if (!visible) return;
		let cancelled = false;
		setUrl(undefined);
		setFailed(false);
		void desktopClient
			.invoke<CloudArtifactDownload>("get_cloud_artifact_url", {
				sessionId,
				artifactId,
			})
			.then((result) => {
				if (cancelled) return;
				setUrl(result.url);
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [visible, sessionId, artifactId, attempt]);

	return (
		<div ref={container} data-media-id={media.id}>
			{failed ? (
				<output className={classNames?.unavailable ?? className}>
					Image unavailable.{" "}
					<button
						type="button"
						onClick={() => setAttempt((value) => value + 1)}
					>
						Retry
					</button>
				</output>
			) : url ? (
				// biome-ignore lint/performance/noImgElement: The signed URL must load directly, without the Next image proxy.
				<img
					alt={media.name ?? "Published image"}
					src={url}
					className={classNames?.image ?? className}
					referrerPolicy="no-referrer"
					onError={() => {
						if (attempt === 0) setAttempt(1);
						else setFailed(true);
					}}
				/>
			) : (
				<output className="text-sm text-muted-foreground">
					Loading image…
				</output>
			)}
		</div>
	);
}
