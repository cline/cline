"use client";

import { Kbd, KbdGroup } from "@cline/ui";
import { Keyboard } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { desktopClient } from "@/lib/desktop-client";
import {
	acceleratorFromEvent,
	acceleratorKeys,
	DEFAULT_QUIT_HOLD_MS,
	defaultKeybindings,
	KEYBINDING_DEFINITIONS,
	type KeybindingActionId,
	type KeybindingEntry,
	type ResolvedKeybindings,
	saveKeybindings,
	useKeybindings,
} from "@/lib/keybindings";
import { cn } from "@/lib/utils";
import { PageFrame, PageHeader } from "../page-layout";

function ShortcutRecorder({
	value,
	onChange,
}: {
	value: string;
	onChange: (key: string) => void;
}) {
	const [recording, setRecording] = useState(false);

	useEffect(() => {
		if (!recording) return;
		const onKeyDown = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopPropagation();
			if (event.key === "Escape") {
				setRecording(false);
				return;
			}
			if (event.key === "Backspace" || event.key === "Delete") {
				onChange("");
				setRecording(false);
				return;
			}
			const accelerator = acceleratorFromEvent(event);
			if (!accelerator) return; // wait for a non-modifier key
			onChange(accelerator);
			setRecording(false);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [onChange, recording]);

	return (
		<Button
			className={cn("min-w-32", recording && "ring-2 ring-primary")}
			onBlur={() => setRecording(false)}
			onClick={() => setRecording((current) => !current)}
			size="sm"
			title="Click, then press the new shortcut. Esc cancels, Backspace unbinds."
			type="button"
			variant="outline"
		>
			{recording ? (
				"Press shortcut…"
			) : value ? (
				<KbdGroup>
					{acceleratorKeys(value).map((part) => (
						<Kbd key={part}>{part}</Kbd>
					))}
				</KbdGroup>
			) : (
				"Unbound"
			)}
		</Button>
	);
}

export function KeybindingsContent() {
	const stored = useKeybindings();
	const [draft, setDraft] = useState<ResolvedKeybindings>(stored);
	const [error, setError] = useState<string | null>(null);

	// Follow external changes (file edits, other windows).
	useEffect(() => setDraft(stored), [stored]);

	const persist = (next: ResolvedKeybindings) => {
		setDraft(next);
		setError(null);
		void saveKeybindings(next).catch((cause) =>
			setError(cause instanceof Error ? cause.message : String(cause)),
		);
	};

	const update = (id: KeybindingActionId, patch: Partial<KeybindingEntry>) =>
		persist({ ...draft, [id]: { ...draft[id], ...patch } });

	const conflicts = (id: KeybindingActionId) => {
		const key = draft[id].key;
		if (!key) return null;
		return (
			KEYBINDING_DEFINITIONS.find(
				(other) => other.id !== id && draft[other.id].key === key,
			)?.label ?? null
		);
	};

	return (
		<PageFrame>
			<PageHeader
				actions={
					<div className="flex gap-2">
						<Button
							onClick={() =>
								void desktopClient
									.invoke("open_keybindings_file")
									.catch(() => {})
							}
							type="button"
							variant="outline"
						>
							Open keybindings.json
						</Button>
						<Button
							onClick={() => persist(defaultKeybindings())}
							type="button"
							variant="outline"
						>
							Reset to defaults
						</Button>
					</div>
				}
				description="Click a shortcut to record a new one. Changes are saved to local keybindings.json file"
				icon={Keyboard}
				title="Keybindings"
			/>
			{error ? (
				<p className="mb-4 text-sm text-destructive">
					Could not save keybindings: {error}
				</p>
			) : null}
			<div className="divide-y rounded-lg border">
				{KEYBINDING_DEFINITIONS.map((definition) => {
					const entry = draft[definition.id];
					const conflict = conflicts(definition.id);
					return (
						<div
							className="flex items-center justify-between gap-6 px-4 py-3"
							key={definition.id}
						>
							<div className="min-w-0">
								<p className="text-sm font-medium">{definition.label}</p>
								<p className="text-xs text-muted-foreground">
									{definition.description}
								</p>
								{conflict ? (
									<p className="mt-1 text-xs text-destructive">
										Also assigned to “{conflict}”.
									</p>
								) : null}
							</div>
							<div className="flex shrink-0 items-center gap-3">
								{definition.supportsHold && entry.key ? (
									<label className="flex items-center gap-2 text-xs text-muted-foreground">
										Hold (s)
										<Input
											aria-label={`${definition.label} hold time in seconds`}
											className="h-8 w-16"
											min={0}
											max={5}
											onChange={(event) => {
												const seconds = Number(event.target.value);
												if (!Number.isFinite(seconds)) return;
												update(definition.id, {
													holdMs: Math.round(
														Math.min(5, Math.max(0, seconds)) * 1000,
													),
												});
											}}
											step={0.1}
											type="number"
											value={(entry.holdMs ?? 0) / 1000}
										/>
									</label>
								) : null}
								<ShortcutRecorder
									onChange={(key) =>
										update(definition.id, {
											key,
											...(definition.supportsHold && !entry.holdMs
												? { holdMs: DEFAULT_QUIT_HOLD_MS }
												: {}),
										})
									}
									value={entry.key}
								/>
							</div>
						</div>
					);
				})}
			</div>
		</PageFrame>
	);
}
