"use client";

import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useArtifactResource } from "@/hooks/use-artifact-resource";
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
	return (
		<ul className="space-y-2 py-1 text-sm">
			{files.map((file, index) => {
				const filename = file.path.split(/[\\/]/).pop() || file.path;
				return (
					<li
						key={`${index}:${file.path}`}
						className="flex flex-wrap items-center gap-2"
					>
						<span className="break-all">{filename}</span>
						{file.error ? (
							<span className="text-destructive">{file.error.message}</span>
						) : (
							<DownloadArtifact
								sessionId={sessionId}
								artifactId={file.artifactId}
								filename={filename}
							/>
						)}
					</li>
				);
			})}
		</ul>
	);
}

function DownloadArtifact({
	sessionId,
	artifactId,
	filename,
}: {
	sessionId: string;
	artifactId: string;
	filename: string;
}) {
	const { state, open } = useArtifactResource({
		sessionId,
		reference: { type: "artifact", artifactId },
		downloadFilename: filename,
	});
	const busy = state.status === "loading";
	const failed = state.status === "error";
	return (
		<>
			<Button
				type="button"
				size="sm"
				variant="outline"
				disabled={busy}
				onClick={() => void open()}
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
