"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { desktopClient } from "@/lib/desktop-client";

type ActiveOAuthPrompt = {
	promptId: string;
	provider: string;
	message: string;
};

function parsePromptPayload(payload: unknown): ActiveOAuthPrompt | null {
	if (!payload || typeof payload !== "object") {
		return null;
	}
	const record = payload as Record<string, unknown>;
	const promptId =
		typeof record.promptId === "string" ? record.promptId.trim() : "";
	if (!promptId) {
		return null;
	}
	return {
		promptId,
		provider: typeof record.provider === "string" ? record.provider : "",
		message:
			typeof record.message === "string" && record.message.trim().length > 0
				? record.message
				: "Paste the authorization code from your browser:",
	};
}

/**
 * Global handler for OAuth manual-entry prompts. When a provider sign-in
 * cannot complete automatically (e.g. the localhost callback never arrived),
 * the sidecar emits `oauth_prompt_requested` and waits; this dialog collects
 * the pasted authorization code and answers via `respond_oauth_prompt`.
 * Mounted once at the app shell so sign-ins from onboarding, settings, and
 * the account view are all covered.
 */
export function OAuthPromptDialog() {
	const [prompt, setPrompt] = useState<ActiveOAuthPrompt | null>(null);
	const [value, setValue] = useState("");
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		const unsubscribeRequested = desktopClient.subscribe(
			"oauth_prompt_requested",
			(payload) => {
				const next = parsePromptPayload(payload);
				if (!next) {
					return;
				}
				setPrompt(next);
				setValue("");
				setSubmitting(false);
			},
		);
		const unsubscribeCancelled = desktopClient.subscribe(
			"oauth_prompt_cancelled",
			(payload) => {
				const record =
					payload && typeof payload === "object"
						? (payload as Record<string, unknown>)
						: null;
				const promptId =
					typeof record?.promptId === "string" ? record.promptId : "";
				setPrompt((current) =>
					current && current.promptId === promptId ? null : current,
				);
			},
		);
		return () => {
			unsubscribeRequested();
			unsubscribeCancelled();
		};
	}, []);

	const respond = useCallback(
		async (promptId: string, answer: string) => {
			setSubmitting(true);
			try {
				await desktopClient.invoke("respond_oauth_prompt", {
					prompt_id: promptId,
					value: answer,
				});
			} catch {
				// The sidecar's prompt timeout is the fallback; nothing further
				// the dialog can do if the response cannot be delivered.
			} finally {
				setPrompt((current) =>
					current && current.promptId === promptId ? null : current,
				);
				setSubmitting(false);
			}
		},
		[],
	);

	if (!prompt) {
		return null;
	}

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open && !submitting) {
					// Dismissing answers with an empty value so the sign-in fails
					// fast instead of waiting out the sidecar's prompt timeout.
					void respond(prompt.promptId, "");
				}
			}}
			open
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Finish signing in</DialogTitle>
					<DialogDescription>{prompt.message}</DialogDescription>
				</DialogHeader>
				<Input
					aria-label="Authorization code"
					autoComplete="off"
					autoFocus
					onChange={(event) => setValue(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && value.trim() && !submitting) {
							void respond(prompt.promptId, value.trim());
						}
					}}
					placeholder="Authorization code or redirect URL"
					value={value}
				/>
				<DialogFooter>
					<Button
						disabled={submitting}
						onClick={() => void respond(prompt.promptId, "")}
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
					<Button
						disabled={!value.trim() || submitting}
						onClick={() => void respond(prompt.promptId, value.trim())}
						type="button"
					>
						{submitting ? <Loader2 className="size-4 animate-spin" /> : null}
						Submit code
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
