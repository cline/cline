"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { desktopClient } from "@/lib/desktop-client";

const DEFAULT_HOOK = `// Read the event payload from standard input.
let input = "";
for await (const chunk of process.stdin) input += chunk;
const event = JSON.parse(input);

// Add your hook logic here.
process.stdout.write(JSON.stringify({}));
`;

export function CreateCustomizationDialog({
	type,
	onCreated,
}: {
	type: "rule" | "skill" | "hook";
	onCreated: () => Promise<void>;
}) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [content, setContent] = useState(type === "hook" ? DEFAULT_HOOK : "");
	const [events, setEvents] = useState<string[]>([]);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open || type !== "hook") return;
		let cancelled = false;
		void desktopClient
			.invoke<{ events: string[] }>("list_creatable_hook_events")
			.then((result) => {
				if (cancelled) return;
				setEvents(result.events);
				setName((current) => current || result.events[0] || "");
			})
			.catch((error) => {
				if (!cancelled) setError(String(error));
			});
		return () => {
			cancelled = true;
		};
	}, [open, type]);

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (saving) return;
		setSaving(true);
		setError(null);
		try {
			await desktopClient.invoke("create_global_customization", {
				type,
				name,
				description,
				content,
			});
			setOpen(false);
			setName("");
			setDescription("");
			setContent(type === "hook" ? DEFAULT_HOOK : "");
			await onCreated();
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
		} finally {
			setSaving(false);
		}
	};

	return (
		<>
			<Button
				variant="outline"
				size="sm"
				onClick={() => {
					setError(null);
					setOpen(true);
				}}
			>
				<Plus className="size-4" />
				New {type}
			</Button>
			<Dialog
				open={open}
				onOpenChange={(next) => {
					if (!saving) setOpen(next);
				}}
			>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>Create global {type}</DialogTitle>
						<DialogDescription>
							{type === "hook"
								? "Runs for the selected event across all projects. Write a JavaScript script that reads JSON from stdin and writes its result to stdout."
								: "Available across all projects. Write the instructions in Markdown."}
						</DialogDescription>
					</DialogHeader>
					<form onSubmit={submit} className="grid gap-4">
						<div className="grid gap-2">
							<Label htmlFor="customization-name">
								{type === "hook" ? "Event" : "Name"}
							</Label>
							{type === "hook" ? (
								<select
									id="customization-name"
									value={name}
									onChange={(event) => setName(event.target.value)}
									disabled={saving || !events.length}
									className="h-9 rounded-md border bg-background px-3 text-sm"
								>
									{events.map((event) => (
										<option key={event} value={event}>
											{event}
										</option>
									))}
								</select>
							) : (
								<Input
									id="customization-name"
									placeholder="code-review"
									value={name}
									onChange={(event) => setName(event.target.value)}
									pattern="[a-z0-9]+(-[a-z0-9]+)*"
									maxLength={64}
									required
									disabled={saving}
								/>
							)}
						</div>
						{type === "skill" && (
							<div className="grid gap-2">
								<Label htmlFor="customization-description">Description</Label>
								<Input
									id="customization-description"
									placeholder="When should Cline use this skill?"
									value={description}
									onChange={(event) => setDescription(event.target.value)}
									required
									disabled={saving}
								/>
							</div>
						)}
						<div className="grid gap-2">
							<Label htmlFor="customization-content">
								{type === "hook" ? "JavaScript" : "Instructions"}
							</Label>
							<Textarea
								id="customization-content"
								value={content}
								onChange={(event) => setContent(event.target.value)}
								className="min-h-64 max-h-[45vh] font-mono text-sm"
								required
								disabled={saving}
							/>
						</div>
						{error && (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						)}
						<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => setOpen(false)}
								disabled={saving}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={
									saving ||
									!name.trim() ||
									!content.trim() ||
									(type === "skill" && !description.trim())
								}
							>
								{saving ? "Creating..." : `Create ${type}`}
							</Button>
						</div>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
