"use client";

import { Check, Copy, Cpu, Loader2, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, EmptyState, InlineAlert } from "@/components/ui";
import { ApiClientError, apiFetch } from "@/lib/client-api";
import type { OpenRouterModel } from "@/lib/types";
import { cn, formatNumber } from "@/lib/utils";

type ModelsPayload = {
	models: OpenRouterModel[];
	configured: boolean;
	error?: string;
	total: number;
	providers: string[];
	fetchedAt: string;
};

const CONTEXT_OPTIONS = [
	{ value: 0, label: "Any context" },
	{ value: 32_000, label: "32k+" },
	{ value: 128_000, label: "128k+" },
	{ value: 200_000, label: "200k+" },
	{ value: 1_000_000, label: "1M+" },
];

function priceLabel(model: OpenRouterModel): string {
	const prompt = model.pricing.promptPerMillion;
	const completion = model.pricing.completionPerMillion;
	if (prompt === null && completion === null) return "pricing unknown";
	const fmt = (value: number | null) =>
		value === null
			? "?"
			: value === 0
				? "free"
				: value < 0.01
					? `$${value.toFixed(4)}`
					: `$${value.toFixed(2)}`;
	return `${fmt(prompt)} in · ${fmt(completion)} out / 1M`;
}

export function ModelCatalog({ defaultModel }: { defaultModel: string | null }) {
	const [payload, setPayload] = useState<ModelsPayload | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [provider, setProvider] = useState("all");
	const [toolsOnly, setToolsOnly] = useState(false);
	const [minContext, setMinContext] = useState(0);
	const [selected, setSelected] = useState<OpenRouterModel | null>(null);
	const [savedId, setSavedId] = useState<string | null>(defaultModel);
	const [saving, setSaving] = useState(false);
	const [saveMessage, setSaveMessage] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const load = useCallback((refresh = false) => {
		setLoading(true);
		setError(null);
		apiFetch<ModelsPayload>(`/api/models${refresh ? "?refresh=1" : ""}`)
			.then((data) => setPayload(data))
			.catch((caught) =>
				setError(caught instanceof ApiClientError ? caught.message : "Could not load models."),
			)
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const models = payload?.models ?? [];
	const providers = payload?.providers ?? [];

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase();
		return models.filter((model) => {
			if (toolsOnly && !model.supportsTools) return false;
			if (provider !== "all" && model.provider !== provider) return false;
			if (minContext && (model.contextLength ?? 0) < minContext) return false;
			if (!term) return true;
			return (
				model.id.toLowerCase().includes(term) ||
				model.name.toLowerCase().includes(term) ||
				model.provider.toLowerCase().includes(term)
			);
		});
	}, [models, search, provider, toolsOnly, minContext]);

	async function setAsDefault(model: OpenRouterModel) {
		setSaving(true);
		setSaveMessage(null);
		try {
			await apiFetch("/api/settings", {
				method: "PATCH",
				body: JSON.stringify({ defaultModel: model.id }),
			});
			setSavedId(model.id);
			setSaveMessage(`${model.name} is now your default model.`);
		} catch (caught) {
			setSaveMessage(
				caught instanceof ApiClientError ? caught.message : "Could not save the default model.",
			);
		} finally {
			setSaving(false);
		}
	}

	async function copyId(id: string) {
		try {
			await navigator.clipboard.writeText(id);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			setCopied(false);
		}
	}

	return (
		<div className="space-y-4">
			{payload && !payload.configured ? (
				<InlineAlert tone="warning" title="OpenRouter key not configured">
					Add a server key or your own key in Settings before running tasks. The catalog itself is
					public.
				</InlineAlert>
			) : null}
			{error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
			{payload?.error ? (
				<InlineAlert tone="warning" title="Partial catalog">
					{payload.error}
				</InlineAlert>
			) : null}

			<div className="surface flex flex-wrap items-end gap-3 p-3">
				<div className="relative min-w-[220px] flex-1">
					<Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-mist-600" />
					<input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Search models, providers or ids…"
						className="input pl-9"
					/>
				</div>
				<div className="w-full sm:w-44">
					<label className="label" htmlFor="model-provider">
						Provider
					</label>
					<select
						id="model-provider"
						value={provider}
						onChange={(event) => setProvider(event.target.value)}
						className="input"
					>
						<option value="all">All providers</option>
						{providers.map((item) => (
							<option key={item} value={item}>
								{item}
							</option>
						))}
					</select>
				</div>
				<div className="w-full sm:w-40">
					<label className="label" htmlFor="model-context">
						Context
					</label>
					<select
						id="model-context"
						value={minContext}
						onChange={(event) => setMinContext(Number(event.target.value))}
						className="input"
					>
						{CONTEXT_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</div>
				<label className="flex h-10 items-center gap-2 rounded-lg border border-white/[0.09] bg-black/20 px-3 text-[0.72rem] text-mist-300">
					<input
						type="checkbox"
						checked={toolsOnly}
						onChange={(event) => setToolsOnly(event.target.checked)}
						className="size-3.5 accent-[#c2ef4a]"
					/>
					<SlidersHorizontal className="size-3.5 text-mist-500" /> tools only
				</label>
				<button
					type="button"
					onClick={() => load(true)}
					className="btn btn-ghost h-10 px-3"
					aria-label="Refresh catalog"
				>
					<RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
				</button>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-2 text-[0.7rem] text-mist-500">
				<span>
					{loading
						? "Loading the live OpenRouter catalog…"
						: `${formatNumber(filtered.length)} of ${formatNumber(models.length)} models`}
				</span>
				<span className="font-mono text-[0.6rem] text-mist-700">
					{payload?.fetchedAt ? `fetched ${new Date(payload.fetchedAt).toLocaleTimeString()}` : ""}
				</span>
			</div>

			{loading && models.length === 0 ? (
				<div className="surface grid place-items-center p-16">
					<Loader2 className="size-5 animate-spin text-mist-500" />
				</div>
			) : filtered.length === 0 ? (
				<EmptyState
					icon={Cpu}
					title={models.length === 0 ? "Catalog unavailable" : "No matching models"}
					description={
						models.length === 0
							? "OpenRouter model discovery did not return a catalog. Check connectivity and retry."
							: "Relax the filters or search for a different provider."
					}
				/>
			) : (
				<div className="grid gap-3 lg:grid-cols-2">
					{filtered.map((model) => (
						<button
							key={model.id}
							type="button"
							onClick={() => {
								setSelected(model);
								setSaveMessage(null);
							}}
							className={cn(
								"surface flex flex-col gap-2 p-4 text-left transition hover:border-white/[0.15]",
								selected?.id === model.id && "border-signal-500/30",
							)}
						>
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0">
									<p className="truncate font-display text-[0.85rem] font-semibold text-mist-100">
										{model.name}
									</p>
									<p className="mt-0.5 truncate font-mono text-[0.6rem] text-mist-600">
										{model.id}
									</p>
								</div>
								{savedId === model.id ? (
									<Badge tone="success">
										<Check className="size-3" /> default
									</Badge>
								) : null}
							</div>
							<div className="flex flex-wrap gap-1.5">
								<span className="chip">
									{model.contextLength ? `${formatNumber(model.contextLength)} ctx` : "ctx unknown"}
								</span>
								<span className="chip font-mono text-[0.6rem]">{priceLabel(model)}</span>
								{model.supportsTools ? (
									<span className="chip border-signal-500/20 text-signal-300">tools</span>
								) : (
									<span className="chip text-mist-600">no tools</span>
								)}
								{model.inputModalities.includes("image") ? (
									<span className="chip">vision</span>
								) : null}
								{model.moderated ? <span className="chip">moderated</span> : null}
							</div>
						</button>
					))}
				</div>
			)}

			{selected ? (
				<div className="surface p-5">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<p className="eyebrow">Model</p>
							<h2 className="display mt-1 text-xl font-semibold">{selected.name}</h2>
							<p className="mt-1 font-mono text-[0.65rem] text-mist-600">{selected.id}</p>
						</div>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => copyId(selected.id)}
								className="btn btn-secondary h-8 px-2.5 text-[0.7rem]"
							>
								<Copy className="size-3" /> {copied ? "Copied" : "Copy id"}
							</button>
							<button
								type="button"
								onClick={() => setAsDefault(selected)}
								disabled={saving || savedId === selected.id}
								className="btn btn-primary h-8 px-3 text-[0.7rem]"
							>
								{saving ? (
									<Loader2 className="size-3 animate-spin" />
								) : (
									<Check className="size-3" />
								)}
								Use as default
							</button>
						</div>
					</div>
					<p className="mt-3 max-w-3xl text-[0.8rem] leading-relaxed text-mist-400">
						{selected.description || "No description provided by OpenRouter."}
					</p>
					<div className="mt-4 grid gap-3 sm:grid-cols-4">
						{[
							[
								"Context",
								selected.contextLength ? formatNumber(selected.contextLength) : "unknown",
							],
							[
								"Max output",
								selected.maxCompletionTokens
									? formatNumber(selected.maxCompletionTokens)
									: "unknown",
							],
							[
								"Prompt / 1M",
								selected.pricing.promptPerMillion === null
									? "unknown"
									: `$${selected.pricing.promptPerMillion.toFixed(4)}`,
							],
							[
								"Completion / 1M",
								selected.pricing.completionPerMillion === null
									? "unknown"
									: `$${selected.pricing.completionPerMillion.toFixed(4)}`,
							],
						].map(([label, value]) => (
							<div key={label} className="surface-muted px-3 py-2">
								<p className="text-[0.6rem] uppercase tracking-[0.1em] text-mist-600">{label}</p>
								<p className="mt-0.5 font-mono text-[0.75rem] text-mist-200">{value}</p>
							</div>
						))}
					</div>
					{saveMessage ? <p className="mt-3 text-[0.7rem] text-signal-300">{saveMessage}</p> : null}
				</div>
			) : null}
		</div>
	);
}
