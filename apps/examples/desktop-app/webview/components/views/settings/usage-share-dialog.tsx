"use client";

import { Switch } from "@cline/ui";
import { Check, Copy, Download, FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { desktopClient } from "@/lib/desktop-client";
import {
	buildShareCardModel,
	defaultShareCardToggles,
	renderShareCard,
	type ShareCardToggles,
	shareCardFileName,
	shareCardInputFromReport,
} from "@/lib/share-card";
import type { UsagePatternsReport } from "@/lib/usage-types";

function Toggle({
	checked,
	description,
	onChange,
	label,
}: {
	checked: boolean;
	description: string;
	onChange: (value: boolean) => void;
	label: string;
}) {
	return (
		<div className="flex items-start justify-between gap-4 rounded-md border p-3">
			<span className="flex flex-col gap-0.5">
				<span className="text-sm font-medium text-foreground">{label}</span>
				<span className="text-xs text-muted-foreground">{description}</span>
			</span>
			<Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
		</div>
	);
}

function errorMessage(caught: unknown): string {
	return caught instanceof Error ? caught.message : String(caught);
}

function revealLabel(platform: string): string {
	if (platform === "darwin") return "Show in Finder";
	if (platform === "win32") return "Show in Explorer";
	return "Show in folder";
}

/**
 * Share card export for the Usage tab. Mounted only while open.
 *
 * The card is rendered and saved on this machine from
 * `shareCardInputFromReport`, which copies aggregate numbers only. Nothing is
 * uploaded, so there is no consent step to negotiate.
 */
export function UsageShareDialog({
	onOpenChange,
	report,
}: {
	onOpenChange: (open: boolean) => void;
	report: UsagePatternsReport;
}) {
	const [toggles, setToggles] = useState<ShareCardToggles>(() =>
		defaultShareCardToggles(report.rangeDays),
	);
	const [saved, setSaved] = useState<{
		path: string;
		platform: string;
	} | null>(null);
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const model = useMemo(
		() => buildShareCardModel(shareCardInputFromReport(report), toggles),
		[report, toggles],
	);
	const canvas = useMemo(() => renderShareCard(model), [model]);
	// The preview is the exported PNG itself, so what you see is what you share.
	const previewUrl = useMemo(
		() => canvas?.toDataURL("image/png") ?? null,
		[canvas],
	);

	const setToggle = (key: keyof ShareCardToggles) => (value: boolean) => {
		setToggles((current) => ({ ...current, [key]: value }));
		setCopied(false);
	};

	const save = async () => {
		if (!previewUrl) return;
		setBusy(true);
		setError(null);
		try {
			const response = await desktopClient.invoke<{
				path: string;
				platform: string;
			}>(
				"export_usage_share_card",
				{
					png: previewUrl,
					fileName: shareCardFileName(report.rangeDays, Date.now()),
				},
				{ timeoutMs: 30_000 },
			);
			setSaved(response);
		} catch (caught) {
			setError(errorMessage(caught));
		} finally {
			setBusy(false);
		}
	};

	const copy = () => {
		if (!canvas) return;
		setError(null);
		if (
			typeof ClipboardItem === "undefined" ||
			typeof navigator.clipboard?.write !== "function"
		) {
			setError("Copying an image is not available here — save it instead.");
			return;
		}
		// WebKit only honours a clipboard write started inside the click, so the
		// image goes over as a pending Blob instead of being awaited first.
		const png = new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(blob) =>
					blob
						? resolve(blob)
						: reject(new Error("the card could not be encoded")),
				"image/png",
			);
		});
		navigator.clipboard.write([new ClipboardItem({ "image/png": png })]).then(
			() => setCopied(true),
			(caught: unknown) => setError(errorMessage(caught)),
		);
	};

	const reveal = async () => {
		if (!saved) return;
		try {
			await desktopClient.invoke("reveal_usage_share_card", {
				path: saved.path,
			});
		} catch (caught) {
			setError(errorMessage(caught));
		}
	};

	return (
		<Dialog onOpenChange={onOpenChange} open>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Share your usage profile</DialogTitle>
					<DialogDescription>
						Rendered on this machine and saved as a PNG; nothing is uploaded.
						The card holds aggregate numbers only — never project names, paths,
						prompts or session identifiers — and shows the weekly rhythm as
						levels rather than counts.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					<div className="overflow-hidden rounded-lg border bg-muted/30">
						{previewUrl ? (
							// biome-ignore lint/performance/noImgElement: The preview is an in-memory PNG data URL that Next's optimizer cannot serve.
							<img
								alt="Usage profile share card preview"
								className="block h-auto w-full"
								src={previewUrl}
							/>
						) : (
							<p className="p-6 text-sm text-muted-foreground">
								The card cannot be drawn in this environment.
							</p>
						)}
					</div>

					<div className="flex flex-col gap-2">
						<Toggle
							checked={toggles.includeRhythm}
							description="When you start sessions, by weekday and hour, in four levels. Off by default for windows shorter than two weeks, where it reads like an activity log."
							label="Weekly rhythm"
							onChange={setToggle("includeRhythm")}
						/>
						<Toggle
							checked={toggles.includeAgents}
							description="Sessions started per agent and how much of each was orchestrated."
							label="Per-agent breakdown"
							onChange={setToggle("includeAgents")}
						/>
						<Toggle
							checked={toggles.includeStreaks}
							description="Your longest run of consecutive active days."
							label="Streaks"
							onChange={setToggle("includeStreaks")}
						/>
					</div>

					{error ? (
						<p className="text-sm text-destructive" role="alert">
							{error}
						</p>
					) : null}

					{saved ? (
						<div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
							<span className="text-muted-foreground">Saved to</span>
							<code className="truncate text-xs">{saved.path}</code>
							<Button
								className="ml-auto"
								onClick={reveal}
								size="sm"
								type="button"
								variant="outline"
							>
								<FolderOpen className="size-4" />
								{revealLabel(saved.platform)}
							</Button>
						</div>
					) : null}

					<div className="flex items-center gap-2">
						<Button disabled={!previewUrl || busy} onClick={save} type="button">
							<Download className="size-4" />
							Save PNG
						</Button>
						<Button
							disabled={!canvas}
							onClick={copy}
							type="button"
							variant="outline"
						>
							{copied ? (
								<Check className="size-4" />
							) : (
								<Copy className="size-4" />
							)}
							{copied ? "Copied" : "Copy image"}
						</Button>
						<span className="ml-auto text-xs text-muted-foreground">
							Saved into your Downloads folder
						</span>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
