"use client";

import type { FactoryReview } from "@cline/shared";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MemoizedMarkdown } from "@/components/ui/markdown";
import { desktopClient } from "@/lib/desktop-client";

export function EvidencePreview({
	taskId,
	runId,
	artifact,
}: {
	taskId: string;
	runId: string;
	artifact: { path: string; label: string; mimeType: string };
}) {
	const [dataUrl, setDataUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	return (
		<div className="mt-3">
			<Button
				size="sm"
				variant="outline"
				disabled={loading}
				onClick={() => {
					setLoading(true);
					void desktopClient
						.invoke<{ dataUrl: string }>("factory_read_artifact", {
							taskId,
							runId,
							path: artifact.path,
						})
						.then((result) => {
							setDataUrl(result.dataUrl);
							setError(null);
						})
						.catch((cause: unknown) =>
							setError(
								cause instanceof Error
									? cause.message
									: "Unable to load evidence.",
							),
						)
						.finally(() => setLoading(false));
				}}
			>
				{loading ? "Loading…" : artifact.label}
			</Button>
			{error ? (
				<p role="alert" className="mt-1 text-xs text-destructive">
					{error}
				</p>
			) : null}
			{dataUrl && artifact.mimeType.startsWith("image/") ? (
				<img
					src={dataUrl}
					alt={artifact.label}
					className="mt-2 max-h-96 rounded border object-contain"
				/>
			) : dataUrl && artifact.mimeType.startsWith("video/") ? (
				<video src={dataUrl} controls className="mt-2 max-h-96 rounded border">
					<track kind="captions" />
				</video>
			) : null}
		</div>
	);
}

export function ReviewResult({
	label,
	review,
	sessionId,
	onOpenSession,
}: {
	label: string;
	review: FactoryReview;
	sessionId: string;
	onOpenSession: (sessionId: string) => Promise<void>;
}) {
	return (
		<div className="rounded-lg border p-3 text-sm">
			<h4 className="font-medium">
				{label} · {review.verdict.replaceAll("_", " ")}
			</h4>
			<MemoizedMarkdown content={review.summary} classNames="mt-2 text-sm" />
			{review.findings.length ? (
				<ul className="mt-2 list-disc space-y-1 pl-5">
					{review.findings.map((finding) => (
						<li key={finding}>
							<MemoizedMarkdown content={finding} classNames="text-sm" />
						</li>
					))}
				</ul>
			) : null}
			{review.coverage ? (
				<details className="mt-2 text-xs">
					<summary className="cursor-pointer">Private local coverage</summary>
					{Object.entries(review.coverage).map(([kind, paths]) => (
						<div key={kind} className="mt-2">
							<strong>{kind}</strong>
							<ul className="list-disc pl-5">
								{paths.map((path) => (
									<li key={path}>{path}</li>
								))}
							</ul>
						</div>
					))}
				</details>
			) : null}
			<Button
				variant="link"
				size="sm"
				onClick={() => void onOpenSession(sessionId)}
			>
				Open {label.toLowerCase()} session
				<ArrowUpRight className="ml-1 size-3" />
			</Button>
		</div>
	);
}
