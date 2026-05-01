"use client";

import {
	ArrowLeft,
	ChevronDown,
	Copy,
	Eye,
	EyeOff,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const CAPABILITY_OPTIONS = [
	"streaming",
	"tools",
	"reasoning",
	"vision",
	"prompt-cache",
] as const;

type Capability = (typeof CAPABILITY_OPTIONS)[number];

export interface AddProviderPayload {
	providerId: string;
	name: string;
	baseUrl: string;
	apiKey?: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
	models: string[];
	defaultModelId?: string;
	modelsSourceUrl?: string;
	capabilities?: Capability[];
}

interface NewProviderForm {
	providerId: string;
	name: string;
	models: string[];
	defaultModel: string;
	apiKey: string;
	baseUrl: string;
	modelsSourceUrl: string;
	headers: Record<string, string>;
	timeoutMs: string;
	capabilities: Capability[];
}

export function AddProviderContent({
	onBack,
	onSave,
	existingProviderIds,
}: {
	onBack: () => void;
	onSave: (payload: AddProviderPayload) => Promise<void>;
	existingProviderIds: string[];
}) {
	const [form, setForm] = useState<NewProviderForm>({
		providerId: "",
		name: "",
		models: [],
		defaultModel: "",
		apiKey: "",
		baseUrl: "",
		modelsSourceUrl: "",
		headers: {},
		timeoutMs: "",
		capabilities: ["streaming", "tools"],
	});
	const [modelInput, setModelInput] = useState("");
	const [showApiKey, setShowApiKey] = useState(false);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const normalizedProviderId = useMemo(
		() => form.providerId.trim().toLowerCase().replace(/\s+/g, "-"),
		[form.providerId],
	);

	const duplicateProviderId =
		existingProviderIds.includes(normalizedProviderId);
	const hasManualModels = form.models.length > 0;
	const hasModelsSource = form.modelsSourceUrl.trim().length > 0;
	const canSave =
		normalizedProviderId.length > 0 &&
		form.name.trim().length > 0 &&
		form.baseUrl.trim().length > 0 &&
		(hasManualModels || hasModelsSource) &&
		!duplicateProviderId;

	const handleAddModel = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if ((e.key === "Enter" || e.key === ",") && modelInput.trim()) {
			e.preventDefault();
			const value = modelInput.trim().replace(/,/g, "");
			if (value && !form.models.includes(value)) {
				setForm((prev) => ({
					...prev,
					models: [...prev.models, value],
					defaultModel: prev.defaultModel || value,
				}));
			}
			setModelInput("");
		} else if (e.key === "Backspace" && !modelInput && form.models.length > 0) {
			setForm((prev) => ({
				...prev,
				models: prev.models.slice(0, -1),
			}));
		}
	};

	const removeModel = (model: string) => {
		setForm((prev) => {
			const nextModels = prev.models.filter((m) => m !== model);
			return {
				...prev,
				models: nextModels,
				defaultModel:
					prev.defaultModel === model
						? (nextModels[0] ?? "")
						: prev.defaultModel,
			};
		});
	};

	const toggleCapability = (cap: Capability) => {
		setForm((prev) => ({
			...prev,
			capabilities: prev.capabilities.includes(cap)
				? prev.capabilities.filter((c) => c !== cap)
				: [...prev.capabilities, cap],
		}));
	};

	const addHeader = () => {
		setForm((prev) => ({ ...prev, headers: { ...prev.headers, "": "" } }));
	};

	const updateHeaderKey = (oldKey: string, newKey: string, idx: number) => {
		const entries = Object.entries(form.headers);
		const next: Record<string, string> = {};
		entries.forEach(([key, value], index) => {
			next[index === idx ? newKey : key] = value;
		});
		if (oldKey !== newKey) {
			delete next[oldKey];
		}
		setForm((prev) => ({ ...prev, headers: next }));
	};

	const updateHeaderValue = (key: string, value: string) => {
		setForm((prev) => ({
			...prev,
			headers: { ...prev.headers, [key]: value },
		}));
	};

	const removeHeader = (key: string) => {
		const next = { ...form.headers };
		delete next[key];
		setForm((prev) => ({ ...prev, headers: next }));
	};

	const handleSave = async () => {
		if (!canSave || saving) {
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await onSave({
				providerId: normalizedProviderId,
				name: form.name.trim(),
				baseUrl: form.baseUrl.trim(),
				apiKey: form.apiKey.trim() || undefined,
				headers: Object.fromEntries(
					Object.entries(form.headers)
						.map(([key, value]) => [key.trim(), value])
						.filter(([key]) => key.length > 0),
				),
				timeoutMs:
					form.timeoutMs.trim().length > 0
						? Number.parseInt(form.timeoutMs.trim(), 10)
						: undefined,
				models: form.models,
				defaultModelId: form.defaultModel || form.models[0],
				modelsSourceUrl: form.modelsSourceUrl.trim() || undefined,
				capabilities:
					form.capabilities.length > 0 ? form.capabilities : undefined,
			});
		} catch (saveError) {
			setError(
				saveError instanceof Error ? saveError.message : String(saveError),
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto max-w-3xl px-8 py-6">
				<div className="mb-6 flex items-center gap-3">
					<Button
						onClick={onBack}
						className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
						aria-label="Back to providers"
					>
						<ArrowLeft className="h-4 w-4" />
					</Button>
					<h2 className="text-lg font-semibold text-foreground">
						Add Provider
					</h2>
				</div>

				<div className="flex flex-col gap-6">
					<div className="rounded-lg border border-border p-5">
						<h3 className="mb-4 text-sm font-semibold text-foreground">
							OpenAI-Compatible Provider
						</h3>
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<div>
								<Label className="mb-2 block text-xs font-medium text-muted-foreground">
									Provider ID
								</Label>
								<input
									type="text"
									value={form.providerId}
									onChange={(e) =>
										setForm((prev) => ({ ...prev, providerId: e.target.value }))
									}
									placeholder="my-provider"
									className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
								/>
								<p className="mt-1.5 text-xs text-muted-foreground">
									Lowercase ID used in provider registry.
								</p>
								{duplicateProviderId ? (
									<p className="mt-1 text-xs text-destructive">
										This provider ID already exists.
									</p>
								) : null}
							</div>
							<div>
								<Label className="mb-2 block text-xs font-medium text-muted-foreground">
									Provider Name
								</Label>
								<input
									type="text"
									value={form.name}
									onChange={(e) =>
										setForm((prev) => ({ ...prev, name: e.target.value }))
									}
									placeholder="My Provider"
									className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
								/>
							</div>
						</div>
					</div>

					<div className="rounded-lg border border-border p-5">
						<Label className="mb-2 block text-xs font-medium text-muted-foreground">
							Base URL
						</Label>
						<input
							type="url"
							value={form.baseUrl}
							onChange={(e) =>
								setForm((prev) => ({ ...prev, baseUrl: e.target.value }))
							}
							placeholder="https://api.example.com/v1"
							className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
						/>
					</div>

					<div className="rounded-lg border border-border p-5">
						<Label className="mb-2 block text-xs font-medium text-muted-foreground">
							Model Source URL (Optional)
						</Label>
						<input
							type="url"
							value={form.modelsSourceUrl}
							onChange={(e) =>
								setForm((prev) => ({
									...prev,
									modelsSourceUrl: e.target.value,
								}))
							}
							placeholder="https://api.example.com/v1/models"
							className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
						/>
						<p className="mt-1.5 text-xs text-muted-foreground">
							Supported JSON: OpenAI `/models` shape with a `data` array, or a
							direct model array.
						</p>
					</div>

					<div className="rounded-lg border border-border p-5">
						<Label className="mb-2 block text-xs font-medium text-muted-foreground">
							Models
						</Label>
						<div className="flex min-h-11 flex-wrap content-start gap-1.5 rounded-lg border border-border bg-input px-3 py-2 focus-within:ring-1 focus-within:ring-ring">
							{form.models.map((model) => (
								<span
									key={model}
									className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
								>
									<span className="font-mono">{model}</span>
									<Button
										onClick={() => removeModel(model)}
										className="text-primary/60 hover:text-primary transition-colors"
										aria-label={`Remove ${model}`}
									>
										<X className="h-3 w-3" />
									</Button>
								</span>
							))}
							<input
								type="text"
								value={modelInput}
								onChange={(e) => setModelInput(e.target.value)}
								onKeyDown={handleAddModel}
								placeholder={
									form.models.length === 0
										? "Type model ID and press Enter"
										: ""
								}
								className="min-w-35 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none"
							/>
						</div>
						<p className="mt-1.5 text-xs text-muted-foreground">
							Add at least one model or set a Model Source URL.
						</p>
					</div>

					{form.models.length > 1 ? (
						<div className="rounded-lg border border-border p-5">
							<Label className="mb-2 block text-xs font-medium text-muted-foreground">
								Default Model
							</Label>
							<select
								value={form.defaultModel}
								onChange={(e) =>
									setForm((prev) => ({ ...prev, defaultModel: e.target.value }))
								}
								className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
							>
								{form.models.map((model) => (
									<option key={model} value={model}>
										{model}
									</option>
								))}
							</select>
						</div>
					) : null}

					<div className="rounded-lg border border-border p-5">
						<Label className="mb-2 block text-xs font-medium text-muted-foreground">
							API Key (Optional)
						</Label>
						<div className="relative">
							<input
								type={showApiKey ? "text" : "password"}
								value={form.apiKey}
								onChange={(e) =>
									setForm((prev) => ({ ...prev, apiKey: e.target.value }))
								}
								placeholder="sk-..."
								className="w-full rounded-lg border border-border bg-input px-3 py-2 pr-20 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
							/>
							<div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
								<Button
									onClick={() => setShowApiKey(!showApiKey)}
									className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
									aria-label={showApiKey ? "Hide API key" : "Show API key"}
								>
									{showApiKey ? (
										<EyeOff className="h-4 w-4" />
									) : (
										<Eye className="h-4 w-4" />
									)}
								</Button>
								<Button
									onClick={() => navigator.clipboard.writeText(form.apiKey)}
									className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
									aria-label="Copy API key"
								>
									<Copy className="h-4 w-4" />
								</Button>
							</div>
						</div>
					</div>

					<div className="rounded-lg border border-border p-5">
						<Label className="mb-3 block text-xs font-medium text-muted-foreground">
							Capabilities
						</Label>
						<div className="flex flex-wrap gap-2">
							{CAPABILITY_OPTIONS.map((cap) => (
								<Button
									key={cap}
									onClick={() => toggleCapability(cap)}
									className={cn(
										"rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
										form.capabilities.includes(cap)
											? "border-primary/40 bg-primary/10 text-primary"
											: "border-border bg-card text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground",
									)}
								>
									{cap.replace(/-/g, " ")}
								</Button>
							))}
						</div>
					</div>

					<div className="rounded-lg border border-border overflow-hidden">
						<Button
							onClick={() => setShowAdvanced(!showAdvanced)}
							className="flex w-full items-center justify-between px-5 py-4 text-sm font-medium text-foreground hover:bg-accent/30 transition-colors"
						>
							Advanced Settings
							<ChevronDown
								className={cn(
									"h-4 w-4 text-muted-foreground transition-transform",
									showAdvanced && "rotate-180",
								)}
							/>
						</Button>

						{showAdvanced ? (
							<div className="border-t border-border px-5 py-5 flex flex-col gap-5">
								<div>
									<Label className="mb-2 block text-xs font-medium text-muted-foreground">
										Timeout (ms)
									</Label>
									<input
										type="number"
										value={form.timeoutMs}
										onChange={(e) =>
											setForm((prev) => ({
												...prev,
												timeoutMs: e.target.value,
											}))
										}
										placeholder="30000"
										className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
									/>
								</div>

								<div>
									<Label className="mb-2 block text-xs font-medium text-muted-foreground">
										Custom Headers
									</Label>
									<div className="flex flex-col gap-2">
										{Object.entries(form.headers).map(([key, value], idx) => (
											<div key={key} className="flex items-center gap-2">
												<input
													type="text"
													value={key}
													onChange={(e) =>
														updateHeaderKey(key, e.target.value, idx)
													}
													placeholder="Header name"
													className="flex-1 rounded-lg border border-border bg-input px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
												/>
												<input
													type="text"
													value={value}
													onChange={(e) =>
														updateHeaderValue(key, e.target.value)
													}
													placeholder="Value"
													className="flex-1 rounded-lg border border-border bg-input px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
												/>
												<Button
													onClick={() => removeHeader(key)}
													className="rounded-md p-2 text-muted-foreground hover:text-destructive transition-colors"
													aria-label="Remove header"
												>
													<Trash2 className="h-4 w-4" />
												</Button>
											</div>
										))}
										<Button
											onClick={addHeader}
											className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-fit"
										>
											<Plus className="h-3 w-3" />
											Add Header
										</Button>
									</div>
								</div>
							</div>
						) : null}
					</div>

					{error ? <p className="text-sm text-destructive">{error}</p> : null}

					<div className="flex items-center justify-end gap-3 pt-2">
						<Button
							onClick={onBack}
							className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
						>
							Cancel
						</Button>
						<Button
							onClick={() => void handleSave()}
							disabled={!canSave || saving}
							className={cn(
								"rounded-lg px-4 py-2 text-sm font-medium transition-colors",
								canSave && !saving
									? "bg-primary text-primary-foreground hover:bg-primary/90"
									: "bg-muted text-muted-foreground cursor-not-allowed",
							)}
						>
							{saving ? "Saving..." : "Add Provider"}
						</Button>
					</div>
				</div>
			</div>
		</ScrollArea>
	);
}
