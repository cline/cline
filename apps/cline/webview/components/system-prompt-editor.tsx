"use client";

import { Upload } from "lucide-react";
import { type ChangeEvent, useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Shared between the bot-creation dialog and the Settings "System Prompt"
 * section. Users can edit instructions directly or upload a ready-made text
 * file; persistence remains owned by the parent dialog/view.
 */
export function SystemPromptEditor({
	systemPrompt,
	onSystemPromptChange,
	disabled,
}: {
	systemPrompt: string;
	onSystemPromptChange: (value: string) => void;
	disabled?: boolean;
}) {
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

	return (
		<div className="grid gap-3">
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
					placeholder="Write custom instructions here, or upload a Markdown or text file."
					rows={6}
					value={systemPrompt}
				/>
			</div>
			{error ? <p className="text-sm text-destructive">{error}</p> : null}
		</div>
	);
}
