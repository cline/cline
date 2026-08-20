"use client";

import { Cpu } from "lucide-react";
import { SearchCombobox } from "@cline/ui";
import type { ProviderProjection } from "@shared/projection";

export function ModelSelector({
	providers,
	providerId,
	modelId,
	disabled,
	onProviderChange,
	onModelChange,
}: {
	providers: ProviderProjection[];
	providerId: string;
	modelId: string;
	disabled?: boolean;
	onProviderChange: (providerId: string) => void;
	onModelChange: (modelId: string) => void;
}) {
	const models =
		providers.find((provider) => provider.providerId === providerId)?.modelIds ?? [];
	if (providers.length === 0) return null;
	return (
		<div className="flex min-w-0 items-center gap-0.5">
			<Cpu className="mx-1 size-3.5 shrink-0 text-muted-foreground" />
			<SearchCombobox
				ariaLabel="Provider"
				className="max-w-32 text-xs"
				disabled={disabled}
				emptyText="No configured providers found."
				onValueChange={onProviderChange}
				options={providers.map((provider) => ({ label: provider.providerId, value: provider.providerId }))}
				placement="top"
				searchPlaceholder="Search providers"
				value={providerId}
			/>
			<div className="h-4 w-px bg-border" />
			<SearchCombobox
				ariaLabel="Model"
				className="max-w-64 text-xs"
				disabled={disabled || models.length === 0}
				emptyText="No models found."
				onValueChange={onModelChange}
				options={models.map((model) => ({ label: model, value: model }))}
				placement="top"
				searchPlaceholder="Search models"
				value={modelId}
			/>
		</div>
	);
}
