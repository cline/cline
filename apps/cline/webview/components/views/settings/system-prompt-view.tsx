"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SystemPromptEditor } from "@/components/system-prompt-editor";
import { Button } from "@/components/ui/button";
import { desktopClient } from "@/lib/desktop-client";
import { PageFrame, PageHeader } from "../page-layout";

type BotSystemPromptDetails = {
	content: string | null;
	bundledContent: string | null;
	profileRulesContent: string | null;
	profileId: string | null;
};

/**
 * The selected host profile supplies a read-only base prompt. This editor
 * persists only the bot-owned instructions appended after those rules.
 */
export function SystemPromptSettingsContent({
	activeBotId,
}: {
	activeBotId: string;
}) {
	const [systemPrompt, setSystemPrompt] = useState("");
	const [bundledContent, setBundledContent] = useState<string | null>(null);
	const [profileRulesContent, setProfileRulesContent] = useState<string | null>(
		null,
	);
	const [profileId, setProfileId] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [justSaved, setJustSaved] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setIsLoading(true);
		setLoadError(null);
		setBundledContent(null);
		setProfileRulesContent(null);
		setProfileId(null);
		setJustSaved(false);
		desktopClient
			.invoke<BotSystemPromptDetails>("read_bot_system_prompt", {
				botId: activeBotId,
			})
			.then((details) => {
				if (cancelled) return;
				setSystemPrompt(details.content ?? "");
				setBundledContent(details.bundledContent);
				setProfileRulesContent(details.profileRulesContent);
				setProfileId(details.profileId);
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
				description="Applied in order: bundled system prompt, profile rules, then your custom instructions."
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
						{bundledContent || profileRulesContent ? (
							<div className="rounded-lg border border-border bg-card p-4">
								<p className="text-sm font-medium">
									Bundled profile: {profileId ?? "default"}
								</p>
								<p className="mt-1 text-xs text-muted-foreground">
									Loaded from default-agent/{profileId ?? "default"}
									/system-prompt.md and rules/*.md. These files are managed by
									the app.
								</p>
								{bundledContent ? (
									<details className="mt-3 text-sm">
										<summary className="cursor-pointer text-muted-foreground">
											View bundled system prompt
										</summary>
										<pre className="cline-page-selectable mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">
											{bundledContent}
										</pre>
									</details>
								) : null}
								{profileRulesContent ? (
									<details className="mt-3 text-sm">
										<summary className="cursor-pointer text-muted-foreground">
											View profile rules and bundled skill guidance
										</summary>
										<pre className="cline-page-selectable mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">
											{profileRulesContent}
										</pre>
									</details>
								) : null}
							</div>
						) : null}
						<p className="text-sm font-medium">Custom instructions</p>
						<SystemPromptEditor
							disabled={isSaving}
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
