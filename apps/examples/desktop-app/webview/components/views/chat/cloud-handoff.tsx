"use client";

import { Cloud, Copy, ExternalLink, GitFork, Loader2, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type {
	HandoffProgressPhase,
	HandoffReceipt as HandoffReceiptValue,
} from "@/lib/cloud-handoff";
import { HANDOFF_PROGRESS_LABELS } from "@/lib/cloud-handoff";

export function CloudHandoffProgress({
	phase,
	message,
	dashboardUrl,
	onOpenCloud,
}: {
	phase: HandoffProgressPhase;
	message?: string;
	dashboardUrl?: string;
	onOpenCloud: () => void;
}) {
	return (
		<output
			aria-live="polite"
			className="mx-auto flex w-full max-w-xl flex-col gap-3 rounded-lg border bg-card p-5 shadow-sm"
		>
			<div className="flex items-center gap-3">
				<Loader2 className="size-4 animate-spin text-primary" />
				<div>
					<p className="text-sm font-medium">
						{message?.trim() || HANDOFF_PROGRESS_LABELS[phase]}
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						You can use the rest of Cline while this finishes.
					</p>
				</div>
			</div>
			{dashboardUrl ? (
				<div className="rounded-md border bg-muted/30 p-3 text-xs">
					<p className="font-medium">
						Your cloud session is available to watch while verification
						finishes.
					</p>
					<p className="mt-1 break-all text-muted-foreground">{dashboardUrl}</p>
					<Button
						className="mt-2 h-7 gap-1.5 px-2 text-xs"
						onClick={onOpenCloud}
						size="sm"
						variant="outline"
					>
						<ExternalLink className="size-3.5" />
						Open Cloud
					</Button>
				</div>
			) : null}
		</output>
	);
}

export function CloudHandoffRecoveryNotice({
	dashboardUrl,
	onOpenCloud,
	onDismiss,
}: {
	dashboardUrl: string;
	onOpenCloud: () => void;
	onDismiss: () => void;
}) {
	return (
		<Alert className="mx-auto mb-2 w-full max-w-xl pr-10">
			<Cloud />
			<AlertTitle>Handoff interrupted</AlertTitle>
			<AlertDescription>
				<p>A cloud session was created and may still be available.</p>
				<div className="mt-2 flex w-full items-start justify-between gap-3">
					<p className="min-w-0 break-all text-xs">{dashboardUrl}</p>
					<Button
						className="h-7 shrink-0 gap-1.5 px-2 text-xs"
						onClick={onOpenCloud}
						size="sm"
						variant="outline"
					>
						<ExternalLink className="size-3.5" />
						Open Cloud
					</Button>
				</div>
			</AlertDescription>
			<Button
				aria-label="Dismiss handoff recovery"
				className="absolute right-2 top-2 size-7 text-muted-foreground"
				onClick={onDismiss}
				size="icon"
				variant="ghost"
			>
				<X className="size-4" />
			</Button>
		</Alert>
	);
}

export function CloudHandoffReceipt({
	receipt,
	onOpenCloud,
	onForkLocally,
	showRecoveryUrl = false,
}: {
	receipt: HandoffReceiptValue;
	onOpenCloud: () => void;
	onForkLocally: () => void;
	showRecoveryUrl?: boolean;
}) {
	const copyRecoveryLink = async () => {
		try {
			if (!navigator.clipboard?.writeText)
				throw new Error("Clipboard unavailable");
			await navigator.clipboard.writeText(receipt.dashboardUrl);
		} catch {
			toast({
				title: "Copy failed",
				description: "Use Open Cloud or select the recovery link above.",
				variant: "destructive",
			});
		}
	};

	return (
		<div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-6 py-10 text-center">
			<div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
				<Cloud className="size-5" />
			</div>
			<div>
				<h2 className="text-base font-semibold">Continued in Cline Cloud</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					This local session is preserved as read-only history.
				</p>
			</div>
			<div className="flex flex-wrap justify-center gap-2">
				<Button className="gap-1.5" onClick={onOpenCloud} size="sm">
					<ExternalLink className="size-3.5" />
					Open Cloud
				</Button>
				<Button
					className="gap-1.5"
					onClick={onForkLocally}
					size="sm"
					variant="outline"
				>
					<GitFork className="size-3.5" />
					Fork Locally
				</Button>
			</div>
			{showRecoveryUrl ? (
				<button
					className="max-w-full break-all text-xs text-primary underline-offset-4 hover:underline"
					onClick={onOpenCloud}
					type="button"
				>
					{receipt.dashboardUrl}
				</button>
			) : null}
			{showRecoveryUrl ? (
				<button
					className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
					onClick={() => void copyRecoveryLink()}
					type="button"
				>
					<Copy className="size-3" />
					Copy recovery link
				</button>
			) : null}
		</div>
	);
}
