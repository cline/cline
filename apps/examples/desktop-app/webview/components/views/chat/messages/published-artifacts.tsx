"use client";

import type { CloudArtifactDownload } from "@cline/core/cloud";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/contexts/account-context";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import { normalizeDisplayValue } from "./tool-summaries";

const PublicationSchema = z.object({
	files: z
		.array(
			z.union([
				z.object({
					path: z.string(),
					error: z.object({ code: z.string(), message: z.string() }),
				}),
				z.object({
					path: z.string(),
					artifactId: z.string().min(1),
					error: z.never().optional(),
				}),
			]),
		)
		.nonempty(),
});

export function parsePublishedArtifacts(value: unknown) {
	const parsed = PublicationSchema.safeParse(normalizeDisplayValue(value));
	return parsed.success ? parsed.data.files : undefined;
}

export function PublishedArtifacts({
	files,
	sessionId,
}: {
	files: z.infer<typeof PublicationSchema>["files"];
	sessionId: string;
}) {
	const { user } = useAccount();
	return (
		<ul className="space-y-2 py-1 text-sm">
			{files.map((file, index) => (
				<li
					key={`${index}:${file.path}`}
					className="flex flex-wrap items-center gap-2"
				>
					<span className="break-all">
						{file.path.split(/[\\/]/).pop() || file.path}
					</span>
					{file.error ? (
						<span className="text-destructive">{file.error.message}</span>
					) : user && "artifactId" in file ? (
						<DownloadArtifact
							key={`${user.id}:${sessionId}:${file.artifactId}`}
							sessionId={sessionId}
							artifactId={file.artifactId}
						/>
					) : (
						<span className="text-muted-foreground">Sign in to download.</span>
					)}
				</li>
			))}
		</ul>
	);
}

function DownloadArtifact({
	sessionId,
	artifactId,
}: {
	sessionId: string;
	artifactId: string;
}) {
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const mounted = useRef(false);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	async function download() {
		setBusy(true);
		setFailed(false);
		try {
			const result = await desktopClient.invoke<CloudArtifactDownload>(
				"get_cloud_artifact_url",
				{ sessionId, artifactId },
			);
			if (mounted.current) await openExternalUrl(result.url);
		} catch {
			if (mounted.current) setFailed(true);
		} finally {
			if (mounted.current) setBusy(false);
		}
	}
	return (
		<>
			<Button
				type="button"
				size="sm"
				variant="outline"
				disabled={busy}
				onClick={() => void download()}
			>
				{busy ? "Preparing…" : failed ? "Retry download" : "Download"}
			</Button>
			{failed && (
				<output className="text-destructive">
					Could not download this file.
				</output>
			)}
		</>
	);
}
