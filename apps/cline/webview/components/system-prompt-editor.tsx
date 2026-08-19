"use client";

import { Loader2, Upload } from "lucide-react";
import { type ChangeEvent, useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { desktopClient } from "@/lib/desktop-client";

/**
 * Shared between the bot-creation dialog and the Settings "System Prompt"
 * section - same underlying capability in both places (describe the bot,
 * optionally upload a ready-made prompt, or generate one from the
 * description), just wired to different persistence on submit/save.
 * Controlled: the parent owns both text values, so each caller can reset
 * (creation dialog) or load/save (Settings) them independently.
 */
export function SystemPromptEditor({
	description,
	onDescriptionChange,
	systemPrompt,
	onSystemPromptChange,
	disabled,
}: {
	description: string;
	onDescriptionChange: (value: string) => void;
	systemPrompt: string;
	onSystemPromptChange: (value: string) => void;
	disabled?: boolean;
}) {
	const [isGenerating, setIsGenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleUploadClick = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const handleFileSelected = useCallback(
		async (event: ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0];
			event.target.value = "";
			if (!file) {
				return;
			}
			try {
				const content = await file.text();
				onSystemPromptChange(content);
				setError(null);
			} catch {
				setError("Could not read that file.");
			}
		},
		[onSystemPromptChange],
	);

	const handleGenerate = useCallback(async () => {
		const trimmedDescription = description.trim();
		if (!trimmedDescription) {
			setError("Describe what this bot should do first.");
			return;
		}
		setIsGenerating(true);
		setError(null);
		try {
			const generated = await desktopClient.invoke<string>(
				"generate_bot_system_prompt",
				{ description: trimmedDescription },
			);
			onSystemPromptChange(generated);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Could not generate a system prompt.",
			);
		} finally {
			setIsGenerating(false);
		}
	}, [description, onSystemPromptChange]);

	return (
		<div className="grid gap-3">
			<div className="grid gap-2">
				<Label htmlFor="bot-description">What should this bot do?</Label>
				<Textarea
					disabled={disabled}
					id="bot-description"
					onChange={(event) => onDescriptionChange(event.target.value)}
					placeholder="e.g. Manages my recipes — suggests meals, tracks ingredients, adjusts serving sizes."
					rows={2}
					value={description}
				/>
			</div>
			<div className="flex items-center gap-2">
				<Button
					disabled={disabled}
					onClick={handleUploadClick}
					size="sm"
					type="button"
					variant="outline"
				>
					<Upload className="size-3.5" />
					Upload system prompt…
				</Button>
				<Button
					disabled={disabled || isGenerating}
					onClick={() => void handleGenerate()}
					size="sm"
					type="button"
					variant="outline"
				>
					{isGenerating ? <Loader2 className="size-3.5 animate-spin" /> : null}
					{isGenerating ? "Generating…" : "Generate from description"}
				</Button>
				<input
					accept=".md,.markdown,.txt"
					className="hidden"
					onChange={(event) => void handleFileSelected(event)}
					ref={fileInputRef}
					type="file"
				/>
			</div>
			<div className="grid gap-2">
				<Label htmlFor="bot-system-prompt">System prompt</Label>
				<Textarea
					disabled={disabled}
					id="bot-system-prompt"
					onChange={(event) => onSystemPromptChange(event.target.value)}
					placeholder="Generated or uploaded text appears here — you can also just type your own."
					rows={6}
					value={systemPrompt}
				/>
			</div>
			{error ? <p className="text-sm text-destructive">{error}</p> : null}
		</div>
	);
}
