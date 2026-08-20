"use client";

import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type {
	MediaGenerationType,
	MediaModelSelection,
	Provider,
} from "@/lib/provider-schema";
import { cn } from "@/lib/utils";

/**
 * Configuration state for one media type (image, audio, video) shown under
 * the generate_media tool card. `modelIdsByProvider` is the
 * server-authoritative eligibility catalog; only models listed there may be
 * selected, regardless of what a provider advertises.
 */
export interface MediaTypeConfiguration {
	mediaType: MediaGenerationType;
	modelIdsByProvider: Readonly<Record<string, readonly string[]>>;
	saving: boolean;
	selection?: MediaModelSelection;
}

export interface GenerateMediaToolConfig {
	error: string | null;
	loading: boolean;
	mediaTypes: readonly MediaTypeConfiguration[];
	onChange: (
		mediaType: MediaGenerationType,
		selection: MediaModelSelection | undefined,
	) => void | Promise<void>;
	onConfigureProviders: () => void;
	providers: readonly Provider[];
}

const MEDIA_TYPE_PRESENTATION: Record<
	MediaGenerationType,
	{ label: string; modelLabel: string }
> = {
	audio: { label: "Audio generation", modelLabel: "Audio model" },
	image: { label: "Image generation", modelLabel: "Image model" },
	video: { label: "Video generation", modelLabel: "Video model" },
};

/**
 * A selection is valid only when its provider is enabled, the model is in
 * the authoritative eligibility catalog for that provider, and the provider
 * actually lists the model. Stale persisted selections fail this check.
 */
export function isValidMediaSelection(
	config: GenerateMediaToolConfig,
	media: MediaTypeConfiguration,
): boolean {
	const selection = media.selection;
	if (!selection) return false;
	const provider = config.providers.find(
		(candidate) => candidate.enabled && candidate.id === selection.providerId,
	);
	if (!provider) return false;
	if (!media.modelIdsByProvider[provider.id]?.includes(selection.modelId)) {
		return false;
	}
	return (
		provider.modelList?.some((model) => model.id === selection.modelId) === true
	);
}

/** True when at least one media type has a valid persisted selection. */
export function hasConfiguredMediaSelection(
	config: GenerateMediaToolConfig | undefined,
): boolean {
	if (!config) return false;
	return config.mediaTypes.some((media) =>
		isValidMediaSelection(config, media),
	);
}

export function MediaModelConfiguration({
	config,
	media,
}: {
	config: GenerateMediaToolConfig;
	media: MediaTypeConfiguration;
}) {
	const presentation = MEDIA_TYPE_PRESENTATION[media.mediaType];
	const eligibleProviders = config.providers
		.filter((provider) => provider.enabled)
		.map((provider) => ({
			provider,
			models: (provider.modelList ?? []).filter((model) =>
				media.modelIdsByProvider[provider.id]?.includes(model.id),
			),
		}))
		.filter((entry) => entry.models.length > 0);
	const selectedProvider = eligibleProviders.find(
		(entry) => entry.provider.id === media.selection?.providerId,
	);
	const selectedModels = selectedProvider?.models ?? [];
	const hasValidSelection = isValidMediaSelection(config, media);

	if (eligibleProviders.length === 0) {
		return (
			<div className="space-y-2" data-media-type-config={media.mediaType}>
				<p className="text-xs font-medium text-foreground">
					{presentation.label}
				</p>
				<p className="text-xs text-muted-foreground">
					Configure and enable a provider with an eligible {media.mediaType}
					-generation model.
				</p>
				<Button
					onClick={config.onConfigureProviders}
					size="sm"
					type="button"
					variant="outline"
				>
					Configure providers
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-3" data-media-type-config={media.mediaType}>
			<p className="text-xs font-medium text-foreground">
				{presentation.label}
			</p>
			{hasValidSelection ? null : (
				<p className="text-xs text-amber-600 dark:text-amber-400">
					Select a provider and model to enable {media.mediaType} generation.
				</p>
			)}
			<div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
				<label className="space-y-1.5 text-xs text-muted-foreground">
					<span>Provider</span>
					<select
						aria-label={`${presentation.label} provider`}
						className="h-9 w-full rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
						disabled={media.saving}
						onChange={(event) => {
							const providerId = event.target.value;
							if (!providerId) {
								void config.onChange(media.mediaType, undefined);
								return;
							}
							const modelId = eligibleProviders.find(
								(entry) => entry.provider.id === providerId,
							)?.models[0]?.id;
							if (modelId) {
								void config.onChange(media.mediaType, {
									providerId,
									modelId,
								});
							}
						}}
						value={selectedProvider?.provider.id ?? ""}
					>
						<option value="">Not configured</option>
						{eligibleProviders.map(({ provider }) => (
							<option key={provider.id} value={provider.id}>
								{provider.name}
							</option>
						))}
					</select>
				</label>
				<label className="space-y-1.5 text-xs text-muted-foreground">
					<span>{presentation.modelLabel}</span>
					<select
						aria-label={`${presentation.label} model`}
						className="h-9 w-full rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
						disabled={!selectedProvider || media.saving}
						onChange={(event) => {
							if (!selectedProvider || !event.target.value) return;
							void config.onChange(media.mediaType, {
								providerId: selectedProvider.provider.id,
								modelId: event.target.value,
							});
						}}
						value={hasValidSelection ? media.selection?.modelId : ""}
					>
						{selectedModels.length === 0 ? (
							<option value="">Select a provider first</option>
						) : null}
						{selectedModels.map((model) => (
							<option key={model.id} value={model.id}>
								{model.name}
							</option>
						))}
					</select>
				</label>
			</div>
		</div>
	);
}

export function GenerateMediaConfiguration({
	config,
}: {
	config: GenerateMediaToolConfig;
}) {
	if (config.loading) {
		return (
			<p className="text-xs text-muted-foreground">
				Loading media-generation models...
			</p>
		);
	}

	if (config.error) {
		return (
			<div className="space-y-2">
				<p className="text-xs text-destructive">
					Failed to load media-generation models: {config.error}
				</p>
				<Button
					onClick={config.onConfigureProviders}
					size="sm"
					type="button"
					variant="outline"
				>
					Open Models settings
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{config.mediaTypes.map((media) => (
				<MediaModelConfiguration
					config={config}
					key={media.mediaType}
					media={media}
				/>
			))}
			<p className="text-xs text-muted-foreground">
				Tool availability changes apply to new chats.
			</p>
		</div>
	);
}

/**
 * The generate_media entry in the builtin-tools list: an expandable card
 * whose switch stays visually off and disabled until a valid provider/model
 * selection exists. Clicking the summary expands the inline configuration.
 */
export function GenerateMediaToolCard({
	config,
	enabled,
	onToggle,
	summary,
	toggling,
	toolId,
	toolName,
}: {
	config?: GenerateMediaToolConfig;
	enabled: boolean;
	onToggle: (checked: boolean) => void;
	summary: ReactNode;
	toggling: boolean;
	toolId: string;
	toolName: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const configurationLoading = config?.loading === true;
	const setupRequired =
		!configurationLoading && !hasConfiguredMediaSelection(config);
	const effectivelyEnabled = enabled && !setupRequired;

	return (
		<div className="rounded-lg border border-border px-5 py-4">
			<div className="flex items-start gap-3">
				<button
					aria-controls={`tool-config-${toolId}`}
					aria-expanded={expanded}
					aria-label={`Configure ${toolName}`}
					className="min-w-0 flex-1 cursor-pointer text-left"
					onClick={() => setExpanded((current) => !current)}
					type="button"
				>
					{summary}
				</button>
				<span
					className={cn(
						"text-xs",
						setupRequired
							? "text-amber-600 dark:text-amber-400"
							: "text-muted-foreground",
					)}
				>
					{configurationLoading
						? "Checking setup"
						: setupRequired
							? "Setup required"
							: effectivelyEnabled
								? "Enabled"
								: "Disabled"}
				</span>
				<Switch
					checked={effectivelyEnabled}
					onCheckedChange={onToggle}
					disabled={toggling || setupRequired || configurationLoading}
					aria-label={`Toggle ${toolName}`}
				/>
			</div>
			{expanded ? (
				<div
					className="mt-4 ml-7 border-t border-border pt-4"
					id={`tool-config-${toolId}`}
				>
					{config ? (
						<GenerateMediaConfiguration config={config} />
					) : (
						<p className="text-xs text-muted-foreground">
							Open the desktop Tools settings to configure an eligible media
							provider and model.
						</p>
					)}
				</div>
			) : null}
		</div>
	);
}
