"use client";

import { SearchCombobox } from "@cline/ui";
import { Cpu } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "@/contexts/account-context";
import {
	type CloudPickerModel,
	cloudCatalogId,
	loadCloudModelCatalog,
} from "@/lib/cloud-model-catalog";
import { desktopClient } from "@/lib/desktop-client";

const CATALOGS = [
	{
		value: "cline",
		label: "Cline Usage-Billing",
		description: "Pay for model usage with Cline credits",
	},
	{
		value: "cline-pass",
		label: "ClinePass",
		description: "Models included with ClinePass",
	},
	{
		value: "cline-cloud",
		label: "ClineFree",
		description: "Free models for Cline Cloud agents",
	},
] as const;

// Catalogs select model IDs; cloud sessions continue to use the Cline provider.
// This picker never reads or writes the local provider selection preference.
export function CloudModelSelector({
	isBusy,
	model,
	preserveUnavailableModel,
	onModelChange,
	onModelSupportsImagesChange,
	onModelSupportsReasoningChange,
	onSelectionPendingChange,
}: {
	isBusy: boolean;
	model: string;
	preserveUnavailableModel: boolean;
	onModelChange: (model: string) => void;
	onModelSupportsImagesChange: (supported: boolean | null) => void;
	onModelSupportsReasoningChange: (supported: boolean | null) => void;
	onSelectionPendingChange: (pending: boolean) => void;
}) {
	const { user, activeOrganization } = useAccount();
	const scope = `${user?.id ?? ""}:${activeOrganization?.id ?? ""}`;
	const [catalog, setCatalog] = useState<{
		scope: string;
		models: CloudPickerModel[];
	}>();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(false);
	const [pendingCatalog, setPendingCatalog] = useState<string>();
	const [mobileOpen, setMobileOpen] = useState(false);
	const requestId = useRef(0);
	const refresh = useCallback(async () => {
		const request = ++requestId.current;
		setLoading(true);
		setError(false);
		try {
			const models = await loadCloudModelCatalog();
			if (request !== requestId.current) return;
			setCatalog({ scope, models });
		} catch {
			if (request === requestId.current) setError(true);
		} finally {
			if (request === requestId.current) setLoading(false);
		}
	}, [scope]);

	useEffect(() => {
		setPendingCatalog(undefined);
		void refresh();
		const unsubscribe = desktopClient.subscribe(
			"cloud_sessions_changed",
			() => {
				setCatalog(undefined);
				setPendingCatalog(undefined);
				void refresh();
			},
		);
		return () => {
			requestId.current += 1;
			unsubscribe();
		};
	}, [refresh]);

	const models = catalog?.scope === scope ? catalog.models : [];
	const selected = models.find((entry) => entry.id === model);
	const currentCatalog = selected?.catalogId ?? cloudCatalogId(model);
	const availableModels = [...models];
	if (preserveUnavailableModel && model && !selected) {
		availableModels.push({ id: model, name: model, catalogId: currentCatalog });
	}
	const providerOptions = CATALOGS.filter((option) =>
		availableModels.some((entry) => entry.catalogId === option.value),
	);
	const availablePendingCatalog = providerOptions.some(
		(option) => option.value === pendingCatalog,
	)
		? pendingCatalog
		: undefined;
	const providerId = availablePendingCatalog ?? currentCatalog;
	const modelOptions = availableModels
		.filter((entry) => entry.catalogId === providerId)
		.map((entry) => ({ label: entry.name, value: entry.id }));
	const selectedModel = modelOptions.some((entry) => entry.value === model)
		? model
		: "";

	// biome-ignore lint/correctness/useExhaustiveDependencies: an externally changed session model cancels a pending catalog selection.
	useEffect(() => {
		setPendingCatalog(undefined);
	}, [model]);

	useEffect(() => {
		if (isBusy || preserveUnavailableModel || selected || loading || error)
			return;
		const fallback =
			models.find((entry) => entry.catalogId === "cline-cloud") ??
			models.find((entry) => entry.catalogId === "cline") ??
			models[0];
		if (fallback) onModelChange(fallback.id);
	}, [
		error,
		isBusy,
		loading,
		models,
		onModelChange,
		preserveUnavailableModel,
		selected,
	]);

	useEffect(() => {
		onSelectionPendingChange(
			Boolean(availablePendingCatalog) ||
				(!preserveUnavailableModel && (!selected || loading || error)),
		);
	}, [
		availablePendingCatalog,
		error,
		loading,
		onSelectionPendingChange,
		preserveUnavailableModel,
		selected,
	]);

	useEffect(() => {
		onModelSupportsImagesChange(
			selected?.inputModalities !== undefined
				? selected.inputModalities.includes("image")
				: (selected?.supportsVision ?? null),
		);
		onModelSupportsReasoningChange(selected?.supportsReasoning ?? null);
	}, [selected, onModelSupportsImagesChange, onModelSupportsReasoningChange]);

	const providerSelect = (className: string) => (
		<SearchCombobox
			ariaLabel="Provider"
			className={className}
			disabled={isBusy || loading}
			loading={loading}
			onOpen={() => void refresh()}
			onValueChange={(value) =>
				setPendingCatalog(value === currentCatalog ? undefined : value)
			}
			options={providerOptions}
			placeholder="Provider"
			placement="top"
			searchPlaceholder="Search providers"
			value={providerId}
		/>
	);
	const modelSelect = (className: string) => (
		<SearchCombobox
			ariaLabel="Model"
			className={className}
			disabled={isBusy || loading || modelOptions.length === 0}
			loading={loading}
			onOpen={() => void refresh()}
			onValueChange={(value) => {
				onModelChange(value);
				setPendingCatalog(undefined);
				setMobileOpen(false);
			}}
			options={modelOptions}
			panelWidth="20rem"
			placeholder="Choose model…"
			placement="top"
			searchPlaceholder="Search models"
			value={selectedModel}
		/>
	);

	return (
		<div className="relative min-w-0 shrink-0 text-sm">
			{error ? (
				<button
					className="text-xs text-destructive"
					onClick={() => void refresh()}
					type="button"
				>
					Could not load cloud models. Retry
				</button>
			) : null}
			<button
				aria-expanded={mobileOpen}
				aria-haspopup="dialog"
				aria-label="Model and provider"
				className="hidden size-7 items-center justify-center rounded-md text-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 max-[560px]:inline-flex"
				disabled={isBusy}
				onClick={() => setMobileOpen((open) => !open)}
				title={`${CATALOGS.find((entry) => entry.value === providerId)?.label} / ${selected?.name ?? model}`}
				type="button"
			>
				<Cpu className="size-3.5" />
			</button>
			{mobileOpen ? (
				<>
					<button
						aria-label="Close model selector"
						className="fixed inset-0 z-40 hidden cursor-default opacity-0 max-[560px]:block"
						onClick={() => setMobileOpen(false)}
						type="button"
					/>
					<div className="absolute bottom-full left-0 z-50 mb-2 hidden w-64 max-w-[calc(100vw-2rem)] space-y-3 rounded-lg border border-border bg-popover p-3 shadow-xl max-[560px]:block">
						{providerSelect("w-full max-w-none justify-between text-sm")}
						{modelSelect("w-full max-w-none justify-between text-sm")}
					</div>
				</>
			) : null}
			<div className="flex min-w-0 items-center gap-0.5 max-[560px]:hidden">
				{providerSelect("max-w-56")}
				<div className="bg-border-2 h-4 w-[0.1rem]" />
				{modelSelect("max-w-52")}
			</div>
		</div>
	);
}
