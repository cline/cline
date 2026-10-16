"use client";

import { Loader2, PlugZap } from "lucide-react";
import {
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { desktopClient } from "@/lib/desktop-client";
import { requestPromptInputFocus } from "@/lib/prompt-input-focus";
import { cn } from "@/lib/utils";
import {
	describeHubRestartInterruption,
	HUB_RESTART_COST,
	HUB_UPGRADE_TIMEOUT_MS,
	type HubBuildMismatchPayload,
	type HubSessionActivity,
	hubMismatchKeyOf,
	persistHubCapabilityNoticeDismissal,
	readHubCapabilityNoticeDismissal,
} from "./hub-update-required-helpers";

type RestartStep =
	| { kind: "offer"; error?: string }
	| { kind: "checking" }
	| { kind: "confirm"; activity: HubSessionActivity | null }
	| { kind: "restarting" }
	| { kind: "restarted" };

function readActivity(value: unknown): HubSessionActivity | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const { activeSessionCount, participantClientCount } =
		value as HubSessionActivity;
	return typeof activeSessionCount === "number"
		? { activeSessionCount, participantClientCount }
		: null;
}

/** Focus is lost to the page or still inside the notice, not somewhere the person put it. */
function focusIsUnclaimed(container: HTMLElement | null): boolean {
	const active = document.activeElement;
	return (
		!active || active === document.body || Boolean(container?.contains(active))
	);
}

/**
 * Shown when the shared Cline Hub cannot serve plugin suggestions: another
 * Cline app of the same release started it before it had that capability.
 * The app never replaces such a Hub on its own, because other apps may be
 * running sessions on it, so the person decides here instead.
 */
export function HubCapabilityNotice({ className }: { className?: string }) {
	const [mismatch, setMismatch] = useState<HubBuildMismatchPayload | null>(
		null,
	);
	const [dismissedKey, setDismissedKey] = useState<string | null>(
		readHubCapabilityNoticeDismissal,
	);
	const [step, setStep] = useState<RestartStep>({ kind: "offer" });
	const containerRef = useRef<HTMLOutputElement>(null);
	const primaryButtonRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		return desktopClient.subscribe("hub_build_mismatch", (payload) => {
			if (payload !== null && (!payload || typeof payload !== "object")) {
				return;
			}
			setMismatch(payload as HubBuildMismatchPayload | null);
			// This app's own restart resolves the mismatch before its reply
			// arrives; that step owns the notice until it finishes.
			setStep((current) =>
				current.kind === "restarting" || current.kind === "restarted"
					? current
					: { kind: "offer" },
			);
		});
	}, []);

	// Disabling the pressed button while the Hub is read or restarted drops
	// its focus, so the next step's action takes it back.
	useEffect(() => {
		if (
			(step.kind === "confirm" ||
				step.kind === "restarted" ||
				(step.kind === "offer" && step.error)) &&
			focusIsUnclaimed(containerRef.current)
		) {
			primaryButtonRef.current?.focus();
		}
	}, [step]);

	const close = useCallback(() => {
		if (focusIsUnclaimed(containerRef.current)) {
			requestPromptInputFocus();
		}
	}, []);

	const restart = useCallback(async () => {
		setStep({ kind: "restarting" });
		try {
			await desktopClient.invoke(
				"hub_upgrade",
				{},
				{ timeoutMs: HUB_UPGRADE_TIMEOUT_MS },
			);
			setMismatch(null);
			setStep({ kind: "restarted" });
		} catch (error) {
			setStep({
				kind: "offer",
				error:
					error instanceof Error && error.message
						? error.message
						: "Restarting the Cline Hub failed. Try again, or run 'cline doctor fix' in a terminal.",
			});
		}
	}, []);

	// The count the person confirms is read now, not when the notice
	// appeared: sessions start and end in every connected app meanwhile.
	const handleRestartHub = useCallback(async () => {
		setStep({ kind: "checking" });
		const activity = await desktopClient
			.invoke("hub_session_activity", {})
			.then(readActivity, () => null);
		if (activity?.activeSessionCount === 0) {
			await restart();
			return;
		}
		setStep({ kind: "confirm", activity });
	}, [restart]);

	if (step.kind === "restarted") {
		return (
			<NoticeFrame
				className={className}
				containerRef={containerRef}
				title="Cline Hub restarted"
				body="Suggestions appear in each open chat after its next message."
			>
				<Button
					className="rounded-full"
					onClick={() => {
						close();
						setStep({ kind: "offer" });
					}}
					ref={primaryButtonRef}
					size="sm"
					type="button"
				>
					Done
				</Button>
			</NoticeFrame>
		);
	}

	const offered =
		mismatch?.reason === "missing_capability" &&
		hubMismatchKeyOf(mismatch) !== dismissedKey;
	if (!offered && step.kind !== "restarting") {
		return null;
	}
	const busy = step.kind === "checking" || step.kind === "restarting";

	return (
		<NoticeFrame
			className={className}
			containerRef={containerRef}
			title="Plugin suggestions are off for this Cline Hub"
			body="Another Cline app started the running Cline Hub without suggestion support. Restart it to turn suggestions on; open chats get them after their next message."
			detail={
				step.kind === "confirm"
					? describeHubRestartInterruption(step.activity)
					: HUB_RESTART_COST
			}
			error={step.kind === "offer" ? step.error : undefined}
		>
			<Button
				className="rounded-full"
				disabled={busy}
				onClick={() =>
					void (step.kind === "confirm" ? restart() : handleRestartHub())
				}
				ref={primaryButtonRef}
				size="sm"
				type="button"
			>
				{busy ? (
					<>
						<Loader2 className="size-4 animate-spin" />
						{step.kind === "checking" ? "Checking…" : "Restarting…"}
					</>
				) : step.kind === "confirm" ? (
					"Restart anyway"
				) : (
					"Restart Hub"
				)}
			</Button>
			<Button
				className="rounded-full"
				disabled={busy}
				onClick={() => {
					if (step.kind === "confirm") {
						setStep({ kind: "offer" });
						return;
					}
					if (!mismatch) {
						return;
					}
					const mismatchKey = hubMismatchKeyOf(mismatch);
					close();
					setDismissedKey(mismatchKey);
					persistHubCapabilityNoticeDismissal(mismatchKey);
				}}
				size="sm"
				type="button"
				variant="ghost"
			>
				{step.kind === "confirm" ? "Cancel" : "Not now"}
			</Button>
		</NoticeFrame>
	);
}

function NoticeFrame({
	className,
	containerRef,
	title,
	body,
	detail,
	error,
	children,
}: {
	className?: string;
	containerRef: RefObject<HTMLOutputElement | null>;
	title: string;
	body: string;
	detail?: string;
	error?: string;
	children: ReactNode;
}) {
	return (
		// <output> carries an implicit "status" role: announced when it appears
		// or changes, without taking focus from the composer.
		<output
			className={cn(
				"flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/40 bg-amber-500/5 px-4 py-3",
				className,
			)}
			ref={containerRef}
		>
			<div className="flex min-w-0 items-start gap-3">
				<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
					<PlugZap className="size-4" />
				</span>
				<div className="min-w-0">
					<p className="text-sm font-semibold text-foreground">{title}</p>
					<p className="mt-0.5 text-[13px] text-muted-foreground">
						{body}
						{detail ? ` ${detail}` : null}
					</p>
					{error ? (
						<p className="mt-1 text-xs text-destructive">{error}</p>
					) : null}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2">{children}</div>
		</output>
	);
}
