"use client";

import type { FactoryArtifact } from "@cline/shared";
import type { FactoryVisualProof } from "@cline/shared/browser";
import { CircleAlert, Film, ImageIcon, Play } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import { FACTORY_VISUAL_PROOF } from "@/lib/factory-copy";
import { cn } from "@/lib/utils";
import { EvidenceDialog, useEvidenceLoader } from "./factory-detail-evidence";
import { StatusPill } from "./factory-ui";

/** Thumbnails already fetched, by run and path; kept for the life of the app. */
const thumbnails = new Map<string, Promise<string>>();

function fetchThumbnail(
	taskId: string,
	runId: string,
	path: string,
): Promise<string> {
	const key = `${runId}:${path}`;
	let pending = thumbnails.get(key);
	if (!pending) {
		pending = desktopClient
			.invoke<{ dataUrl: string }>("factory_read_artifact", {
				taskId,
				runId,
				path,
				variant: "thumbnail",
			})
			.then((result) => result.dataUrl);
		// A failure is not remembered: the next view tries again.
		pending.catch(() => thumbnails.delete(key));
		thumbnails.set(key, pending);
	}
	return pending;
}

/** The artifact's thumbnail, fetched once the tile scrolls into view. */
function useThumbnail(
	taskId: string,
	runId: string,
	artifact: FactoryArtifact,
	target: RefObject<HTMLElement | null>,
) {
	const [src, setSrc] = useState<string | null>(null);
	const [visible, setVisible] = useState(
		typeof IntersectionObserver === "undefined",
	);
	useEffect(() => {
		const element = target.current;
		if (visible || !element) return;
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				setVisible(true);
				observer.disconnect();
			}
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [visible, target]);
	useEffect(() => {
		if (!visible || !artifact.thumbnailPath) return;
		let current = true;
		fetchThumbnail(taskId, runId, artifact.path).then(
			(dataUrl) => current && setSrc(dataUrl),
			() => current && setSrc(null),
		);
		return () => {
			current = false;
		};
	}, [visible, taskId, runId, artifact.path, artifact.thumbnailPath]);
	return src;
}

function Tile({
	taskId,
	runId,
	artifact,
}: {
	taskId: string;
	runId: string;
	artifact: FactoryArtifact;
}) {
	const button = useRef<HTMLButtonElement>(null);
	const thumbnail = useThumbnail(taskId, runId, artifact, button);
	const { dataUrl, error, load } = useEvidenceLoader({
		taskId,
		runId,
		path: artifact.path,
	});
	const [open, setOpen] = useState(false);
	const video = artifact.mimeType.startsWith("video/");
	const name = artifact.caption ?? artifact.label;
	const Icon = video ? Film : ImageIcon;
	return (
		<li className="w-[154px] shrink-0 space-y-1">
			<button
				ref={button}
				type="button"
				aria-haspopup="dialog"
				aria-label={FACTORY_VISUAL_PROOF.open(name)}
				onClick={() => load(() => setOpen(true))}
				className="relative flex h-24 w-[154px] items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				{thumbnail ? (
					<img
						src={thumbnail}
						alt={name}
						className="absolute inset-0 size-full object-cover"
					/>
				) : (
					<Icon aria-hidden className="size-5" />
				)}
				{video ? (
					<>
						<span
							aria-hidden
							className="absolute flex size-7 items-center justify-center rounded-full bg-background/80 text-foreground"
						>
							<Play className="size-3.5 fill-current" />
						</span>
						{artifact.durationMs !== undefined ? (
							<span className="absolute right-1 bottom-1 rounded bg-background/80 px-1 text-[10px] tabular-nums text-foreground">
								{FACTORY_VISUAL_PROOF.duration(artifact.durationMs / 1000)}
							</span>
						) : null}
					</>
				) : null}
			</button>
			{error ? (
				<p role="alert" className="truncate text-xs text-destructive">
					{FACTORY_VISUAL_PROOF.loadFailed}
				</p>
			) : (
				<p className="truncate text-xs text-muted-foreground" title={name}>
					{name}
				</p>
			)}
			<EvidenceDialog
				label={name}
				dataUrl={dataUrl}
				video={video}
				steps={artifact.steps}
				open={open}
				onOpenChange={setOpen}
			/>
		</li>
	);
}

/**
 * Screenshots and the recording, the first thing on a delivered card's
 * receipt: one fixed-height row of thumbnails that open in the lightbox. A
 * change to the UI without them says so in a static pill.
 */
export function FactoryVisualProofStrip({
	taskId,
	runId,
	proof,
	className,
}: {
	taskId: string;
	runId: string;
	proof: FactoryVisualProof;
	className?: string;
}) {
	if (proof.status === "not_required") return null;
	const artifacts = [...proof.recordings, ...proof.screenshots];
	return (
		<section
			aria-label={FACTORY_VISUAL_PROOF.heading}
			data-testid="factory-visual-proof"
			className={cn("space-y-1.5", className)}
		>
			<h4 className="text-xs font-medium text-muted-foreground">
				{FACTORY_VISUAL_PROOF.heading}
			</h4>
			{proof.status === "missing" ? (
				<p className="flex flex-wrap items-center gap-2 text-sm">
					<StatusPill tone="attention" icon={CircleAlert}>
						{FACTORY_VISUAL_PROOF.missing}
					</StatusPill>
					{proof.reason ? <span>{proof.reason}</span> : null}
				</p>
			) : null}
			{artifacts.length ? (
				<ul className="flex gap-2 overflow-x-auto pb-1">
					{artifacts.map((artifact) => (
						<Tile
							key={artifact.path}
							taskId={taskId}
							runId={runId}
							artifact={artifact}
						/>
					))}
				</ul>
			) : null}
		</section>
	);
}
