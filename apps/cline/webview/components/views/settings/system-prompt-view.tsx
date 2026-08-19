"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SystemPromptEditor } from "@/components/system-prompt-editor";
import { Button } from "@/components/ui/button";
import { desktopClient } from "@/lib/desktop-client";
import { PageFrame, PageHeader } from "../page-layout";

/**
 * Per-bot system prompt editor, reusing the same SystemPromptEditor as the
 * bot-creation dialog - here it's pre-loaded from and saved back to the
 * active bot's own rules/system-prompt.md (see main.rs's
 * read_bot_system_prompt/write_bot_system_prompt) instead of being handed
 * off to create_bot at creation time.
 */
export function SystemPromptSettingsContent({
	activeBotId,
}: {
	activeBotId: string;
}) {
	const [description, setDescription] = useState("");
	const [systemPrompt, setSystemPrompt] = useState("");
	const [isLoading, setIsLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [justSaved, setJustSaved] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setIsLoading(true);
		setLoadError(null);
		setDescription("");
		setJustSaved(false);
		desktopClient
			.invoke<string | null>("read_bot_system_prompt", {
				botId: activeBotId,
			})
			.then((content) => {
				if (cancelled) return;
				setSystemPrompt(content ?? "");
			})
			.catch((error) => {
				if (cancelled) return;
				setLoadError(
					error instanceof Error
						? error.message
						: "Could not load the system prompt.",
				);
			})
			.finally(() => {
				if (!cancelled) setIsLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [activeBotId]);

	const handleSave = useCallback(async () => {
		setIsSaving(true);
		setSaveError(null);
		setJustSaved(false);
		try {
			await desktopClient.invoke("write_bot_system_prompt", {
				botId: activeBotId,
				content: systemPrompt,
			});
			setJustSaved(true);
		} catch (error) {
			setSaveError(
				error instanceof Error
					? error.message
					: "Could not save the system prompt.",
			);
		} finally {
			setIsSaving(false);
		}
	}, [activeBotId, systemPrompt]);

	return (
		<PageFrame>
			<PageHeader
				description="Describe what this bot should do, upload a ready-made prompt, or generate one - saved directly to this bot's own rules."
				title="System Prompt"
			/>
			<section className="max-w-2xl">
				{isLoading ? (
					<div className="flex items-center justify-center py-12">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				) : loadError ? (
					<p className="text-sm text-destructive">{loadError}</p>
				) : (
					<div className="grid gap-4">
						<SystemPromptEditor
							description={description}
							disabled={isSaving}
							onDescriptionChange={setDescription}
							onSystemPromptChange={(value) => {
								setSystemPrompt(value);
								setJustSaved(false);
							}}
							systemPrompt={systemPrompt}
						/>
						{saveError ? (
							<p className="text-sm text-destructive">{saveError}</p>
						) : null}
						<div className="flex items-center gap-3">
							<Button
								disabled={isSaving}
								onClick={() => void handleSave()}
								size="sm"
								type="button"
							>
								{isSaving ? "Saving…" : "Save"}
							</Button>
							{justSaved ? (
								<span className="text-sm text-muted-foreground">Saved.</span>
							) : null}
						</div>
					</div>
				)}
			</section>
		</PageFrame>
	);
}
