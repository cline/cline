"use client";

import {
	ArrowLeft,
	Copy,
	Eye,
	EyeOff,
	Link as LinkIcon,
	Loader2,
	Paperclip,
	PlusCircle,
	RefreshCw,
	Settings2,
	Star,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import type {
	Provider,
	ProviderConfigField,
	ProviderConfigFieldPrimitive,
	ProviderSettingsUpdate,
} from "@/lib/provider-schema";
import { cn } from "@/lib/utils";

// -----------------------------------------------------------
// Provider LIST content (the grid of all providers)
// -----------------------------------------------------------

function getInitialConfigValues(
	provider: Provider,
): Record<string, ProviderConfigFieldPrimitive> {
	const values: Record<string, ProviderConfigFieldPrimitive> = {
		...(provider.configValues ?? {}),
	};
	if (provider.apiKey !== undefined && values.apiKey === undefined) {
		values.apiKey = provider.apiKey;
	}
	if (provider.baseUrl !== undefined && values.baseUrl === undefined) {
		values.baseUrl = provider.baseUrl;
	}
	for (const field of provider.configFields ?? []) {
		if (values[field.path] === undefined && field.defaultValue !== undefined) {
			values[field.path] = field.defaultValue;
		}
	}
	return values;
}

function fieldValueToString(value: ProviderConfigFieldPrimitive | undefined) {
	if (value === undefined || value === null) return "";
	return String(value);
}

function coerceFieldValue(
	field: ProviderConfigField,
	value: string | boolean,
): ProviderConfigFieldPrimitive {
	if (field.type === "boolean") {
		return Boolean(value);
	}
	if (typeof value === "boolean") {
		return value;
	}
	if (field.type === "select") {
		const option = field.options?.find((item) => String(item.value) === value);
		if (option) {
			return option.value;
		}
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return null;
	}
	if (field.type === "number") {
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return trimmed;
}

function assignSettingsPath(
	target: Record<string, unknown>,
	path: string,
	value: ProviderConfigFieldPrimitive,
) {
	const segments = path.split(".").filter(Boolean);
	if (segments.length === 0) return;
	let cursor = target;
	for (const segment of segments.slice(0, -1)) {
		const existing = cursor[segment];
		if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
			cursor[segment] = {};
		}
		cursor = cursor[segment] as Record<string, unknown>;
	}
	const last = segments.at(-1);
	if (last) {
		cursor[last] = value;
	}
}

export function toSettingsPatch(
	values: Record<string, ProviderConfigFieldPrimitive>,
): Record<string, unknown> {
	const settings: Record<string, unknown> = {};
	for (const [path, value] of Object.entries(values)) {
		assignSettingsPath(settings, path, value);
	}
	return settings;
}

export function ProviderListContent({
	providers,
	onToggle,
	onConfigure,
	onAddProvider,
}: {
	providers: Provider[];
	onToggle: (id: string) => void;
	onConfigure: (id: string) => void;
	onAddProvider: () => void;
}) {
	return (
		<ScrollArea className="h-full">
			<div className="mx-auto max-w-3xl px-8 py-6">
				<div className="mb-6 flex items-center justify-between">
					<h2 className="text-lg font-semibold text-foreground">
						Model Providers
					</h2>
					<Button
						className="flex items-center gap-2 rounded-lg border border-border bg-accent px-3.5 py-2 text-sm font-medium text-foreground hover:bg-accent/80 transition-colors"
						onClick={onAddProvider}
						variant="ghost"
					>
						<PlusCircle className="h-4 w-4" />
						Add Provider
					</Button>
				</div>

				<div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
					{providers.map((prov) => (
						<div
							className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-accent/30"
							key={prov.id}
						>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-medium text-foreground">
									{prov.name}
								</p>
								<p className="text-xs text-muted-foreground">
									{prov.models === null
										? "Models load on demand"
										: `${prov.models} Model${prov.models !== 1 ? "s" : ""}`}
								</p>
							</div>
							<Button
								aria-label={`Configure ${prov.name}`}
								className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
								onClick={() => onConfigure(prov.id)}
								variant="ghost"
							>
								<Settings2 className="h-4 w-4" />
							</Button>
							<Switch
								aria-label={`Toggle ${prov.name}`}
								checked={prov.enabled}
								onCheckedChange={() => onToggle(prov.id)}
							/>
						</div>
					))}
				</div>
			</div>
		</ScrollArea>
	);
}

export function ProviderDetailContent({
	provider,
	onBack,
	onUpdate,
	onLoadModels,
	modelsLoading = false,
	modelsError,
	onOAuthLogin,
	oauthLoginPending = false,
}: {
	provider: Provider;
	onBack: () => void;
	onUpdate: (updates: ProviderSettingsUpdate) => void;
	onLoadModels?: () => void;
	modelsLoading?: boolean;
	modelsError?: string | null;
	onOAuthLogin?: () => void;
	oauthLoginPending?: boolean;
}) {
	const [shownSecrets, setShownSecrets] = useState<Record<string, boolean>>({});
	const [localConfigValues, setLocalConfigValues] = useState<
		Record<string, ProviderConfigFieldPrimitive>
	>(() => getInitialConfigValues(provider));

	useEffect(() => {
		setLocalConfigValues(getInitialConfigValues(provider));
	}, [provider]);

	const configFields = provider.configFields ?? [];
	const apiKeyValue = fieldValueToString(localConfigValues.apiKey);

	const commitField = (
		field: ProviderConfigField,
		rawValue: string | boolean,
	) => {
		const value = coerceFieldValue(field, rawValue);
		const nextConfigValues = {
			...localConfigValues,
			[field.path]: value,
		};
		setLocalConfigValues(nextConfigValues);

		const updates: ProviderSettingsUpdate = {
			configValues: { [field.path]: value },
		};
		if (field.path === "apiKey") {
			updates.apiKey = fieldValueToString(value);
		}
		if (field.path === "baseUrl") {
			updates.baseUrl = fieldValueToString(value);
		}
		onUpdate(updates);
	};

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto max-w-3xl px-8 py-6">
				{/* Back + title */}
				<div className="mb-8 flex items-center gap-3">
					<Button
						aria-label="Back to providers"
						className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
						onClick={onBack}
						variant="ghost"
					>
						<ArrowLeft className="h-4 w-4" />
					</Button>
					<h2 className="text-lg font-semibold text-foreground">
						{provider.name}
					</h2>
				</div>

				{configFields.length > 0 ? (
					<section className="mb-8">
						<div className="flex flex-col gap-5">
							{configFields.map((field) => {
								const value = localConfigValues[field.path];
								const valueText = fieldValueToString(value);
								const isSecret = field.type === "password" || field.secret;
								const isShown = shownSecrets[field.path] ?? false;
								return (
									<div key={field.path}>
										<header className="mb-2">
											<h3 className="text-sm font-semibold text-foreground">
												{field.label}
											</h3>
											{field.description ? (
												<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
													{field.description}
												</p>
											) : null}
										</header>
										{field.type === "boolean" ? (
											<div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
												<span className="text-sm text-muted-foreground">
													{field.label}
												</span>
												<Switch
													checked={Boolean(value)}
													onCheckedChange={(checked) =>
														commitField(field, checked)
													}
												/>
											</div>
										) : field.type === "select" ? (
											<select
												className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
												onChange={(event) =>
													commitField(field, event.target.value)
												}
												value={valueText}
											>
												<option value="">Not set</option>
												{field.options?.map((option) => (
													<option
														key={String(option.value)}
														value={String(option.value)}
													>
														{option.label}
													</option>
												))}
											</select>
										) : (
											<div className="flex items-center gap-2 rounded-lg border border-border bg-input px-4 py-3">
												{field.type === "url" ? (
													<LinkIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
												) : null}
												<Input
													className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
													onBlur={() => commitField(field, valueText)}
													onChange={(event) =>
														setLocalConfigValues((current) => ({
															...current,
															[field.path]: event.target.value,
														}))
													}
													placeholder={field.placeholder}
													spellCheck={false}
													type={
														isSecret && !isShown
															? "password"
															: field.type === "number"
																? "number"
																: field.type === "url"
																	? "url"
																	: "text"
													}
													value={valueText}
												/>
												{isSecret ? (
													<>
														<Button
															aria-label={
																isShown ? "Hide secret" : "Show secret"
															}
															className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
															onClick={() =>
																setShownSecrets((current) => ({
																	...current,
																	[field.path]: !isShown,
																}))
															}
															variant="ghost"
														>
															{isShown ? (
																<EyeOff className="h-4 w-4" />
															) : (
																<Eye className="h-4 w-4" />
															)}
														</Button>
														<Button
															aria-label={`Copy ${field.label}`}
															className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
															onClick={() =>
																navigator.clipboard.writeText(valueText)
															}
															variant="ghost"
														>
															<Copy className="h-4 w-4" />
														</Button>
													</>
												) : null}
											</div>
										)}
									</div>
								);
							})}
						</div>
					</section>
				) : null}

				{!apiKeyValue && !provider.oauthAccessTokenPresent && onOAuthLogin ? (
					<div className="mb-8">
						<Button
							className="inline-flex items-center gap-2 w-full"
							disabled={oauthLoginPending}
							onClick={onOAuthLogin}
							variant="default"
						>
							{oauthLoginPending ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : null}
							<span>Login via Browser</span>
						</Button>
					</div>
				) : null}
				{provider.oauthAccessTokenPresent ? (
					<p className="mb-8 text-xs text-muted-foreground">
						OAuth is connected. Manual credentials remain available when this
						provider supports them.
					</p>
				) : null}

				{/* Models section */}
				<section>
					<div className="mb-4 flex items-center justify-between">
						<h3 className="text-sm font-semibold text-foreground">Models</h3>
						<div className="flex items-center gap-1">
							<Button
								aria-label="Refresh models"
								className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
								disabled={modelsLoading}
								onClick={onLoadModels}
								variant="ghost"
							>
								<RefreshCw
									className={cn("size-3", modelsLoading && "animate-spin")}
								/>
							</Button>
						</div>
					</div>

					{modelsError ? (
						<div className="rounded-lg border border-border px-4 py-8 text-center">
							<p className="text-sm text-destructive">{modelsError}</p>
						</div>
					) : provider.modelList && provider.modelList.length > 0 ? (
						<div className="flex flex-col divide-y divide-border rounded-lg border border-border max-h-125 overflow-y-scroll">
							{provider.modelList.map((model) => (
								<div
									className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30"
									key={model.id}
								>
									{/* Model name */}
									<span className="flex-1 text-sm text-foreground font-mono">
										<div className="flex items-center gap-1.5">
											{model.name}
											{/* Capability icons */}
											{model.supportsAttachments && (
												<Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
											)}
											{model.supportsVision && (
												<Eye className="h-3.5 w-3.5 text-muted-foreground" />
											)}
										</div>
									</span>

									{/* Action icons */}
									<div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
										<Button
											aria-label={`Favorite ${model.name}`}
											className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
											variant="ghost"
										>
											<Star className="h-3.5 w-3.5" />
										</Button>
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="rounded-lg border border-border px-4 py-8 text-center">
							<p className="text-sm text-muted-foreground">
								{modelsLoading
									? "Loading models..."
									: "No models available. Click refresh to load models."}
							</p>
						</div>
					)}
				</section>
			</div>
		</ScrollArea>
	);
}
