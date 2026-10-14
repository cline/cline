"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ModelIdInput({
	models,
	onChange,
	disabled = false,
}: {
	models: string[];
	onChange: (models: string[]) => void;
	disabled?: boolean;
}) {
	const [modelInput, setModelInput] = useState("");

	const addPendingModel = () => {
		const value = modelInput.trim().replace(/,/g, "");
		if (value && !models.includes(value)) {
			onChange([...models, value]);
		}
		setModelInput("");
	};

	return (
		<div className="flex min-h-11 flex-wrap content-start gap-1.5 rounded-lg border border-border bg-input px-3 py-2 focus-within:ring-1 focus-within:ring-ring">
			{models.map((model) => (
				<span
					className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
					key={model}
				>
					<span className="font-mono">{model}</span>
					<Button
						aria-label={`Remove ${model}`}
						className="text-foreground hover:text-foreground"
						disabled={disabled}
						onClick={() => onChange(models.filter((entry) => entry !== model))}
						type="button"
						size="icon-sm"
					>
						<X className="size-2" />
					</Button>
				</span>
			))}
			<input
				className="min-w-35 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none"
				disabled={disabled}
				onChange={(event) => setModelInput(event.target.value)}
				onKeyDown={(event) => {
					if (
						(event.key === "Enter" || event.key === ",") &&
						modelInput.trim()
					) {
						event.preventDefault();
						addPendingModel();
					} else if (
						event.key === "Backspace" &&
						!modelInput &&
						models.length > 0
					) {
						onChange(models.slice(0, -1));
					}
				}}
				placeholder={models.length === 0 ? "Type model ID and press Enter" : ""}
				type="text"
				value={modelInput}
			/>
		</div>
	);
}
