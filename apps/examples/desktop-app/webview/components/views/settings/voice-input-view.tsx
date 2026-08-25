"use client";

import { AudioLines, Mic, Radio } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { desktopClient } from "@/lib/desktop-client";
import { isProviderConnected } from "@/lib/provider-connection";
import {
	fetchProviderCatalog,
	isDedicatedTranscriptionModel,
	notifyVoiceInputSettingsChanged,
} from "@/lib/provider-model-catalog";
import type {
	Provider,
	ProviderModel,
	VoiceInputSelection,
} from "@/lib/provider-schema";
import { cn } from "@/lib/utils";
import { PageFrame, PageHeader } from "../page-layout";

type VoiceProviderEntry = {
	provider: Provider;
	models: ProviderModel[];
};

/**
 * The model preselected when the user enables voice input or switches
 * provider: streaming (live) transcription when available, else the first
 * transcription model the provider offers.
 */
export function defaultTranscriptionModel(
	models: ProviderModel[],
): ProviderModel | undefined {
	return (
		models.find((model) => model.operationModes?.includes("streaming")) ??
		models[0]
	);
}

function isStreamingModel(model: ProviderModel): boolean {
	return model.operationModes?.includes("streaming") === true;
}

export function VoiceInputContent({
	onOpenModelProviders,
}: {
	onOpenModelProviders: () => void;
}) {
	const [providers, setProviders] = useState<Provider[] | null>(null);
	const [voiceInput, setVoiceInput] = useState<VoiceInputSelection | undefined>(
		undefined,
	);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void fetchProviderCatalog()
			.then((payload) => {
				if (cancelled) return;
				setProviders(payload.providers ?? []);
				setVoiceInput(payload.voiceInput);
				setLoadError(null);
			})
			.catch((error) => {
				if (cancelled) return;
				setLoadError(error instanceof Error ? error.message : String(error));
				setProviders([]);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const connectedProviders = (providers ?? []).filter(isProviderConnected);
	const voiceProviders: VoiceProviderEntry[] = connectedProviders
		.map((provider) => ({
			provider,
			models: (provider.modelList ?? []).filter(isDedicatedTranscriptionModel),
		}))
		.filter((entry) => entry.models.length > 0);
	// Providers that would qualify once connected, so the empty states can
	// point the user at something actionable.
	const voiceCapableProviderNames = (providers ?? [])
		.filter((provider) =>
			(provider.modelList ?? []).some(isDedicatedTranscriptionModel),
		)
		.map((provider) => provider.name);

	const selectedEntry = voiceProviders.find(
		(entry) => entry.provider.id === voiceInput?.providerId,
	);

	const save = useCallback(
		async (selection: VoiceInputSelection | undefined) => {
			const previous = voiceInput;
			setVoiceInput(selection);
			setSaving(true);
			setSaveError(null);
			try {
				const result = await desktopClient.invoke<{
					voiceInput?: VoiceInputSelection;
				}>("save_voice_input_settings", {
					provider: selection?.providerId,
					model: selection?.modelId,
				});
				setVoiceInput(result.voiceInput);
				notifyVoiceInputSettingsChanged();
			} catch (error) {
				setVoiceInput(previous);
				setSaveError(error instanceof Error ? error.message : String(error));
			} finally {
				setSaving(false);
			}
		},
		[voiceInput],
	);

	const enableWithDefaults = useCallback(() => {
		const entry = voiceProviders[0];
		const model = entry ? defaultTranscriptionModel(entry.models) : undefined;
		if (!entry || !model) return;
		void save({ providerId: entry.provider.id, modelId: model.id });
	}, [save, voiceProviders]);

	const selectProvider = useCallback(
		(providerId: string) => {
			const entry = voiceProviders.find(
				(candidate) => candidate.provider.id === providerId,
			);
			const model = entry ? defaultTranscriptionModel(entry.models) : undefined;
			if (!entry || !model) return;
			void save({ providerId: entry.provider.id, modelId: model.id });
		},
		[save, voiceProviders],
	);

	const header = (
		<PageHeader
			description="Speak instead of typing: the microphone in chat transcribes your voice with the model chosen here. Live models show text as you speak; others transcribe when the recording stops."
			title="Voice input"
		/>
	);

	if (providers === null) {
		return (
			<PageFrame>
				{header}
				<p className="text-sm text-muted-foreground">Loading providers...</p>
			</PageFrame>
		);
	}

	if (loadError) {
		return (
			<PageFrame>
				{header}
				<p className="text-sm text-destructive">
					Failed to load providers: {loadError}
				</p>
			</PageFrame>
		);
	}

	if (voiceProviders.length === 0) {
		const hasConnected = connectedProviders.length > 0;
		return (
			<PageFrame>
				{header}
				<div className="flex max-w-2xl flex-col items-start gap-3 rounded-lg border border-dashed px-6 py-8">
					<Mic aria-hidden="true" className="size-6 text-muted-foreground" />
					<p className="text-base font-medium text-foreground">
						{hasConnected
							? "None of your configured providers offer speech-to-text models"
							: "Voice input needs a configured model provider"}
					</p>
					<p className="text-sm text-muted-foreground">
						{voiceCapableProviderNames.length > 0
							? `Connect a provider with transcription models — for example ${voiceCapableProviderNames
									.slice(0, 4)
									.join(", ")} — and this page unlocks automatically.`
							: "Connect a provider with transcription models and this page unlocks automatically."}
					</p>
					<Button onClick={onOpenModelProviders} size="sm" type="button">
						Open Model Providers
					</Button>
				</div>
			</PageFrame>
		);
	}

	const enabled = Boolean(voiceInput);

	return (
		<PageFrame>
			{header}
			<section className="max-w-2xl">
				<div className="flex items-center justify-between gap-5 border-y py-4">
					<div className="flex flex-col gap-1">
						<p className="text-base font-semibold text-foreground">
							Enable voice input
						</p>
						<p className="text-sm text-muted-foreground">
							Turns on the microphone button in chat. A default model is
							preselected — adjust it below.
						</p>
					</div>
					<Switch
						aria-label="Enable voice input"
						checked={enabled}
						disabled={saving}
						onCheckedChange={(checked) => {
							if (checked) enableWithDefaults();
							else void save(undefined);
						}}
					/>
				</div>

				{saveError ? (
					<p className="mt-3 text-xs text-destructive" role="alert">
						Failed to save voice input settings: {saveError}
					</p>
				) : null}

				{enabled ? (
					<>
						<div className="mt-6">
							<p className="mb-2 text-sm font-semibold text-foreground">
								Provider
							</p>
							<div className="flex flex-wrap gap-2">
								{voiceProviders.map(({ provider }) => {
									const isSelected = voiceInput?.providerId === provider.id;
									return (
										<button
											aria-pressed={isSelected}
											className={cn(
												"flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
												isSelected
													? "border-primary/40 bg-primary/8 text-foreground"
													: "text-muted-foreground hover:bg-surface-hover-lighter hover:text-foreground",
											)}
											disabled={saving}
											key={provider.id}
											onClick={() => selectProvider(provider.id)}
											type="button"
										>
											{provider.name}
										</button>
									);
								})}
							</div>
						</div>

						{selectedEntry ? (
							<div className="mt-6">
								<p className="mb-2 text-sm font-semibold text-foreground">
									Model
								</p>
								<div
									aria-label="Voice input model"
									className="overflow-hidden rounded-lg border"
									role="radiogroup"
								>
									{selectedEntry.models.map((model) => {
										const isSelected = voiceInput?.modelId === model.id;
										const isDefault =
											defaultTranscriptionModel(selectedEntry.models)?.id ===
											model.id;
										return (
											<button
												aria-checked={isSelected}
												className={cn(
													"flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-surface-hover-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
													isSelected && "bg-surface-hover",
												)}
												disabled={saving}
												key={model.id}
												onClick={() =>
													void save({
														providerId: selectedEntry.provider.id,
														modelId: model.id,
													})
												}
												role="radio"
												type="button"
											>
												<span
													aria-hidden="true"
													className={cn(
														"grid size-4 shrink-0 place-items-center rounded-full border",
														isSelected
															? "border-primary"
															: "border-muted-foreground/40",
													)}
												>
													{isSelected ? (
														<span className="size-2 rounded-full bg-primary" />
													) : null}
												</span>
												<div className="min-w-0 flex-1">
													<div className="flex min-w-0 items-center gap-2">
														<span className="truncate text-sm text-foreground">
															{model.name}
														</span>
														{isStreamingModel(model) ? (
															<span className="inline-flex shrink-0 items-center gap-1 rounded bg-surface-hover px-1.5 py-px text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
																<Radio aria-hidden="true" className="size-3" />
																Live
															</span>
														) : (
															<span className="inline-flex shrink-0 items-center gap-1 rounded bg-surface-hover px-1.5 py-px text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
																<AudioLines
																	aria-hidden="true"
																	className="size-3"
																/>
																After recording
															</span>
														)}
														{isDefault ? (
															<span className="shrink-0 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
																Default
															</span>
														) : null}
													</div>
													<p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
														{model.id}
													</p>
												</div>
											</button>
										);
									})}
								</div>
							</div>
						) : null}
					</>
				) : null}
			</section>
		</PageFrame>
	);
}
