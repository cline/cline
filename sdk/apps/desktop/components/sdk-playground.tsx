"use client";

import type {
	CustomProviderConfig,
	ProviderSelectionConfig,
} from "@clinebot/llms";
import * as Llms from "@clinebot/llms";
import {
	AlertCircle,
	Braces,
	Check,
	CheckCircle2,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Code2,
	Copy,
	Loader2,
	Play,
	Plus,
	Settings2,
	Terminal,
	Trash2,
	X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { UserNav } from "@/components/user-nav";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ProviderConfig {
	id: string;
	providerId: string;
	models: string[];
	defaultModel: string;
	apiKey: string;
	apiKeyEnv: string;
	baseUrl: string;
	headers: Record<string, string>;
	timeoutMs: number | null;
	capabilities: string[];
	useApiKeyEnv: boolean;
	// Vertex / GCP settings
	gcpProjectId: string;
	gcpRegion: string;
	// AWS / Bedrock settings
	awsAuthentication: "iam" | "api-key" | "profile";
	awsRegion: string;
	awsAccessKey: string;
	awsSecretKey: string;
	awsSessionToken: string;
	awsProfile: string;
	// Known models
	knownModels: Record<
		string,
		{
			name: string;
			contextWindow: number;
			maxTokens: number;
			capabilities: string[];
			status: string;
		}
	>;
}

interface TestResult {
	providerId: string;
	modelId: string;
	status: "success" | "error" | "pending";
	message: string;
	timestamp: number;
	configSnapshot?: string;
}

type CatalogProviderCapability = NonNullable<
	(typeof Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID)[string]["provider"]["capabilities"]
>[number];

// ─── Constants ──────────────────────────────────────────────────────────────

const CAPABILITY_OPTIONS = [
	"streaming",
	"tools",
	"reasoning",
	"vision",
	"computer_use",
	"prompt_caching",
] as const;
const PLAYGROUND_CAPABILITY_FROM_PROVIDER: Partial<
	Record<CatalogProviderCapability, string>
> = {
	reasoning: "reasoning",
	tools: "tools",
	"prompt-cache": "prompt_caching",
};

function mapProviderCapabilityToPlayground(
	capability: string,
): string | undefined {
	return PLAYGROUND_CAPABILITY_FROM_PROVIDER[
		capability as CatalogProviderCapability
	];
}

interface BuiltInProviderPreset {
	id: string;
	label: string;
	models: string[];
	defaultModel: string;
	baseUrl: string;
	capabilities: string[];
}

type RuntimeProviderCapability = NonNullable<
	ProviderSelectionConfig["capabilities"]
>[number];

const BUILT_IN_PROVIDER_LABELS: Record<string, string> = {
	anthropic: "Anthropic",
	"claude-code": "Claude Code",
	cline: "Cline",
	openai: "OpenAI",
	"openai-native": "OpenAI",
	"openai-codex": "OpenAI Codex",
	opencode: "OpenCode",
	bedrock: "AWS Bedrock",
	gemini: "Google Gemini",
	vertex: "Google Vertex AI",
	openrouter: "OpenRouter",
	deepseek: "DeepSeek",
	xai: "xAI",
	together: "Together",
	fireworks: "Fireworks",
	groq: "Groq",
	cerebras: "Cerebras",
	sambanova: "SambaNova",
	nebius: "Nebius",
	baseten: "Baseten",
	requesty: "Requesty",
	litellm: "LiteLLM",
	huggingface: "Hugging Face",
	"vercel-ai-gateway": "Vercel AI Gateway",
	aihubmix: "AIHubMix",
	hicap: "Hicap",
	nousResearch: "Nous Research",
	"huawei-cloud-maas": "Huawei Cloud MaaS",
	ollama: "Ollama",
	doubao: "Doubao",
	moonshot: "Moonshot",
	qwen: "Qwen",
	"qwen-code": "Qwen Code",
	sapaicore: "SAP AI Core",
	minimax: "MiniMax",
	zai: "Z.AI",
};

function titleCaseProviderId(id: string): string {
	return id
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split("-")
		.join(" ")
		.split(" ")
		.filter(Boolean)
		.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
		.join(" ");
}

function sortModelList(modelIds: string[], defaultModel: string): string[] {
	const unique = Array.from(new Set(modelIds.filter(Boolean)));
	if (defaultModel && unique.includes(defaultModel)) {
		return [defaultModel, ...unique.filter((id) => id !== defaultModel)];
	}
	if (defaultModel) {
		return [defaultModel, ...unique];
	}
	return unique;
}

function presetFromCollection(
	id: string,
	label: string,
	provider: {
		defaultModelId: string;
		baseUrl?: string;
		capabilities?: CatalogProviderCapability[];
	},
	models: Record<string, unknown>,
): BuiltInProviderPreset {
	return {
		id,
		label,
		models: sortModelList(Object.keys(models), provider.defaultModelId),
		defaultModel: provider.defaultModelId,
		baseUrl: provider.baseUrl ?? "",
		capabilities: (provider.capabilities ?? [])
			.map(mapProviderCapabilityToPlayground)
			.filter((capability): capability is string => Boolean(capability)),
	};
}

const CORE_PROVIDER_IDS = [
	"anthropic",
	"bedrock",
	"gemini",
	"vertex",
	"cline",
	"claude-code",
] as const;

const BUILT_IN_PROVIDERS: BuiltInProviderPreset[] = [
	...CORE_PROVIDER_IDS.map((id) => {
		const label = BUILT_IN_PROVIDER_LABELS[id] ?? titleCaseProviderId(id);

		const collection = Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID[id];
		if (collection) {
			return presetFromCollection(
				id,
				label,
				collection.provider,
				collection.models,
			);
		}

		return {
			id,
			label,
			models: [],
			defaultModel: "",
			baseUrl: "",
			capabilities: [],
		};
	}),
	{
		id: "openai-compat",
		label: "OpenAI-Compatible (Custom)",
		models: [],
		defaultModel: "",
		baseUrl: "https://api.openai.com/v1",
		capabilities: [],
	},
];

function createEmptyProvider(): ProviderConfig {
	return {
		id: crypto.randomUUID(),
		providerId: "",
		models: [],
		defaultModel: "",
		apiKey: "",
		apiKeyEnv: "",
		baseUrl: "",
		headers: {},
		timeoutMs: null,
		capabilities: [],
		useApiKeyEnv: true,
		gcpProjectId: "",
		gcpRegion: "",
		awsAuthentication: "iam",
		awsRegion: "us-east-1",
		awsAccessKey: "",
		awsSecretKey: "",
		awsSessionToken: "",
		awsProfile: "",
		knownModels: {},
	};
}

const PLAYGROUND_CAPABILITY_MAP: Record<
	(typeof CAPABILITY_OPTIONS)[number],
	RuntimeProviderCapability
> = {
	streaming: "streaming",
	tools: "tools",
	reasoning: "reasoning",
	vision: "vision",
	computer_use: "computer-use",
	prompt_caching: "prompt-cache",
};

const PLAYGROUND_MODEL_CAPABILITY_MAP: Partial<
	Record<(typeof CAPABILITY_OPTIONS)[number], string>
> = {
	streaming: "streaming",
	tools: "tools",
	reasoning: "reasoning",
	vision: "images",
	computer_use: "computer-use",
	prompt_caching: "prompt-cache",
};
type ModelCapability =
	| "streaming"
	| "tools"
	| "reasoning"
	| "prompt-cache"
	| "computer-use"
	| "images"
	| "reasoning-effort"
	| "global-endpoint";

const MODEL_STATUS_VALUES = [
	"active",
	"preview",
	"deprecated",
	"legacy",
] as const;
type ModelStatus = (typeof MODEL_STATUS_VALUES)[number];

function isModelStatus(value: string): value is ModelStatus {
	return (MODEL_STATUS_VALUES as readonly string[]).includes(value);
}

function normalizeModels(models: string[]): string[] {
	return Array.from(
		new Set(
			models.map((model) => model.trim()).filter((model) => model.length > 0),
		),
	);
}

function normalizeHeaders(
	headers: Record<string, string>,
): Record<string, string> | undefined {
	const next = Object.fromEntries(
		Object.entries(headers)
			.map(([key, value]) => [key.trim(), value.trim()])
			.filter(([key]) => key.length > 0),
	);
	return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeCapabilities(
	capabilities: string[],
): RuntimeProviderCapability[] | undefined {
	const mapped = capabilities
		.map(
			(capability) =>
				PLAYGROUND_CAPABILITY_MAP[
					capability as keyof typeof PLAYGROUND_CAPABILITY_MAP
				],
		)
		.filter((capability): capability is RuntimeProviderCapability =>
			Boolean(capability),
		);
	return mapped.length > 0 ? mapped : undefined;
}

function normalizeModelCapabilities(
	capabilities: string[],
): ModelCapability[] | undefined {
	const mapped = capabilities
		.map(
			(capability) =>
				PLAYGROUND_MODEL_CAPABILITY_MAP[
					capability as keyof typeof PLAYGROUND_MODEL_CAPABILITY_MAP
				],
		)
		.filter((capability): capability is ModelCapability => Boolean(capability));
	return mapped.length > 0 ? mapped : undefined;
}

function normalizeProviderCapabilitiesForCatalog(
	capabilities: string[],
): Array<"reasoning" | "prompt-cache"> | undefined {
	const mapped = capabilities
		.map(
			(capability) =>
				PLAYGROUND_CAPABILITY_MAP[
					capability as keyof typeof PLAYGROUND_CAPABILITY_MAP
				],
		)
		.filter(
			(capability): capability is "reasoning" | "prompt-cache" =>
				capability === "reasoning" || capability === "prompt-cache",
		);
	return mapped.length > 0 ? mapped : undefined;
}

function toCustomProviderConfig(
	provider: ProviderConfig,
): CustomProviderConfig | null {
	const providerId = provider.providerId.trim();
	if (!providerId) {
		return null;
	}

	const models = normalizeModels(provider.models);
	if (models.length === 0) {
		return null;
	}

	const defaultModel = provider.defaultModel.trim() || models[0];
	if (!defaultModel) {
		return null;
	}

	const modelEntries = Object.fromEntries(
		models.map((modelId) => {
			const known = provider.knownModels[modelId];
			const modelStatus =
				known?.status && isModelStatus(known.status) ? known.status : undefined;
			return [
				modelId,
				{
					id: modelId,
					name: known?.name || modelId,
					contextWindow: known?.contextWindow,
					maxTokens: known?.maxTokens,
					capabilities: normalizeModelCapabilities(
						known?.capabilities ?? provider.capabilities,
					),
					status: modelStatus,
				},
			];
		}),
	);

	const defaults: NonNullable<CustomProviderConfig["defaults"]> = {};
	if (!provider.useApiKeyEnv && provider.apiKey.trim()) {
		defaults.apiKey = provider.apiKey.trim();
	}
	if (provider.baseUrl.trim()) {
		defaults.baseUrl = provider.baseUrl.trim();
	}
	const headers = normalizeHeaders(provider.headers);
	if (headers) {
		defaults.headers = headers;
	}
	if (provider.timeoutMs != null) {
		defaults.timeoutMs = provider.timeoutMs;
	}
	const providerCapabilities = normalizeCapabilities(provider.capabilities);
	if (providerCapabilities) {
		defaults.capabilities = providerCapabilities;
	}

	return {
		collection: {
			provider: {
				id: providerId,
				name:
					BUILT_IN_PROVIDER_LABELS[providerId] ??
					titleCaseProviderId(providerId),
				baseUrl: provider.baseUrl.trim() || undefined,
				defaultModelId: defaultModel,
				client: "openai-compatible",
				capabilities: normalizeProviderCapabilitiesForCatalog(
					provider.capabilities,
				),
			},
			models: modelEntries,
		},
		defaults: Object.keys(defaults).length > 0 ? defaults : undefined,
	};
}

function toRuntimeProviderConfig(
	provider: ProviderConfig,
): { config: ProviderSelectionConfig; warnings: string[] } | null {
	const providerId = provider.providerId.trim();
	if (!providerId) {
		return null;
	}

	const models = normalizeModels(provider.models);
	if (models.length === 0) {
		return null;
	}

	const defaultModel = provider.defaultModel.trim() || models[0];
	const warnings: string[] = [];

	const config: ProviderSelectionConfig = {
		id: providerId,
		models,
		defaultModel,
		baseUrl: provider.baseUrl.trim() || undefined,
		headers: normalizeHeaders(provider.headers),
		timeoutMs: provider.timeoutMs ?? undefined,
		capabilities: normalizeCapabilities(provider.capabilities),
	};

	if (provider.useApiKeyEnv) {
		warnings.push(
			`${providerId}: env-var auth isn't resolved in the playground runtime; use Direct Key to run live checks.`,
		);
	} else if (provider.apiKey.trim()) {
		config.apiKey = provider.apiKey.trim();
	}

	const settings: NonNullable<ProviderSelectionConfig["settings"]> = {};
	if (provider.providerId === "gemini" && provider.gcpProjectId.trim()) {
		settings.gcp = { projectId: provider.gcpProjectId.trim() };
		if (provider.gcpRegion.trim()) {
			settings.region = provider.gcpRegion.trim();
		}
	}
	if (provider.providerId === "bedrock") {
		settings.aws = {
			authentication: provider.awsAuthentication,
			accessKey: provider.awsAccessKey.trim() || undefined,
			secretKey: provider.awsSecretKey.trim() || undefined,
			sessionToken: provider.awsSessionToken.trim() || undefined,
			profile: provider.awsProfile.trim() || undefined,
		};
		if (provider.awsRegion.trim()) {
			settings.region = provider.awsRegion.trim();
		}
	}

	if (Object.keys(settings).length > 0) {
		config.settings = settings;
	}

	return { config, warnings };
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SectionHeader({
	icon: Icon,
	title,
	description,
}: {
	icon: React.ElementType;
	title: string;
	description?: string;
}) {
	return (
		<div className="flex items-center gap-2.5 pb-3">
			<div className="flex h-7 w-7 items-center justify-center rounded-md bg-chart-5/10">
				<Icon className="h-3.5 w-3.5 text-chart-5" />
			</div>
			<div>
				<h3 className="text-sm font-semibold text-foreground">{title}</h3>
				{description && (
					<p className="text-[11px] text-muted-foreground">{description}</p>
				)}
			</div>
		</div>
	);
}

function FieldRow({
	label,
	children,
	hint,
}: {
	label: string;
	children: React.ReactNode;
	hint?: string;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label className="text-xs text-muted-foreground">{label}</Label>
			{children}
			{hint && <p className="text-[10px] text-muted-foreground/70">{hint}</p>}
		</div>
	);
}

function TagInput({
	values,
	onChange,
	placeholder,
	className,
}: {
	values: string[];
	onChange: (vals: string[]) => void;
	placeholder?: string;
	className?: string;
}) {
	const [inputValue, setInputValue] = useState("");

	function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === "Enter" || e.key === ",") {
			e.preventDefault();
			const val = inputValue.trim().replace(/,/g, "");
			if (val && !values.includes(val)) {
				onChange([...values, val]);
			}
			setInputValue("");
		} else if (e.key === "Backspace" && !inputValue && values.length > 0) {
			onChange(values.slice(0, -1));
		}
	}

	return (
		<div
			className={cn(
				"flex min-h-[36px] flex-wrap content-start gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 focus-within:ring-1 focus-within:ring-chart-5/50",
				className,
			)}
		>
			{values.map((val) => (
				<span
					className="inline-flex items-center gap-1 rounded bg-chart-5/10 px-2 py-0.5 text-[11px] font-medium text-chart-5"
					key={val}
				>
					<span className="font-mono">{val}</span>
					<button
						aria-label={`Remove ${val}`}
						className="text-chart-5/60 transition-colors hover:text-chart-5"
						onClick={() => onChange(values.filter((v) => v !== val))}
						type="button"
					>
						<X className="h-2.5 w-2.5" />
					</button>
				</span>
			))}
			<input
				className="min-w-[100px] flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
				onChange={(e) => setInputValue(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder={values.length === 0 ? placeholder : ""}
				type="text"
				value={inputValue}
			/>
		</div>
	);
}

function HeadersEditor({
	headers,
	onChange,
}: {
	headers: Record<string, string>;
	onChange: (h: Record<string, string>) => void;
}) {
	const entries = Object.entries(headers);

	function addHeader() {
		onChange({ ...headers, "": "" });
	}

	function updateKey(_oldKey: string, newKey: string, idx: number) {
		const newHeaders: Record<string, string> = {};
		entries.forEach(([k, v], i) => {
			newHeaders[i === idx ? newKey : k] = v;
		});
		onChange(newHeaders);
	}

	function updateValue(key: string, value: string) {
		onChange({ ...headers, [key]: value });
	}

	function removeHeader(key: string) {
		const next = { ...headers };
		delete next[key];
		onChange(next);
	}

	return (
		<div className="flex flex-col gap-2">
			{entries.map(([key, value], idx) => (
				<div className="flex items-center gap-2" key={`${key}-${value}`}>
					<Input
						className="h-8 flex-1 border-border bg-background font-mono text-xs text-foreground"
						onChange={(e) => updateKey(key, e.target.value, idx)}
						placeholder="Header name"
						value={key}
					/>
					<Input
						className="h-8 flex-1 border-border bg-background font-mono text-xs text-foreground"
						onChange={(e) => updateValue(key, e.target.value)}
						placeholder="Value"
						value={value}
					/>
					<button
						aria-label="Remove header"
						className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
						onClick={() => removeHeader(key)}
						type="button"
					>
						<Trash2 className="h-3 w-3" />
					</button>
				</div>
			))}
			<Button
				className="h-7 w-fit gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
				onClick={addHeader}
				size="sm"
				variant="ghost"
			>
				<Plus className="h-3 w-3" />
				Add Header
			</Button>
		</div>
	);
}

function CapabilityToggle({
	capabilities,
	onChange,
}: {
	capabilities: string[];
	onChange: (caps: string[]) => void;
}) {
	function toggle(cap: string) {
		if (capabilities.includes(cap)) {
			onChange(capabilities.filter((c) => c !== cap));
		} else {
			onChange([...capabilities, cap]);
		}
	}

	return (
		<div className="flex flex-wrap gap-1.5">
			{CAPABILITY_OPTIONS.map((cap) => (
				<button
					className={cn(
						"rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all",
						capabilities.includes(cap)
							? "border-chart-5/40 bg-chart-5/10 text-chart-5"
							: "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground",
					)}
					key={cap}
					onClick={() => toggle(cap)}
					type="button"
				>
					{cap}
				</button>
			))}
		</div>
	);
}

// ─── Provider Card ──────────────────────────────────────────────────────────

function ProviderCard({
	provider,
	onChange,
	onRemove,
	index,
	takenProviderIds,
}: {
	provider: ProviderConfig;
	onChange: (p: ProviderConfig) => void;
	onRemove: () => void;
	index: number;
	takenProviderIds: string[];
}) {
	const [expanded, setExpanded] = useState(true);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [providerConflictMessage, setProviderConflictMessage] = useState("");

	const builtIn = BUILT_IN_PROVIDERS.find((b) => b.id === provider.providerId);
	const isVertexConfig =
		provider.providerId === "gemini" && provider.gcpProjectId;
	const hasProviderSelected = provider.providerId.trim().length > 0;

	function update(partial: Partial<ProviderConfig>) {
		onChange({ ...provider, ...partial });
	}

	function isProviderTaken(id: string): boolean {
		return takenProviderIds.includes(id.trim());
	}

	function selectBuiltIn(id: string) {
		if (isProviderTaken(id)) {
			setProviderConflictMessage(`Provider "${id}" is already configured.`);
			return;
		}
		const preset = BUILT_IN_PROVIDERS.find((b) => b.id === id);
		setProviderConflictMessage("");
		update({
			providerId: id,
			models: preset ? [...preset.models] : [],
			defaultModel: preset?.defaultModel ?? preset?.models[0] ?? "",
			baseUrl: preset?.baseUrl ?? "",
			capabilities: preset ? [...preset.capabilities] : [],
			apiKeyEnv:
				id === "bedrock"
					? "AWS_BEARER_TOKEN_BEDROCK"
					: `${id.toUpperCase().replace(/-/g, "_")}_API_KEY`,
		});
	}

	return (
		<div className="rounded-xl border border-border bg-card">
			{/* Card header */}
			<div className="flex items-center justify-between gap-2 px-4 py-3">
				<button
					className="flex min-w-0 flex-1 items-center gap-3 text-left"
					onClick={() => setExpanded(!expanded)}
					type="button"
				>
					{expanded ? (
						<ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
					) : (
						<ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
					)}
					<div className="flex items-center gap-2">
						<span className="flex h-5 w-5 items-center justify-center rounded bg-chart-5/10 text-[10px] font-bold text-chart-5">
							{index + 1}
						</span>
						<span className="text-sm font-medium text-foreground">
							{builtIn?.label || provider.providerId || "New Provider"}
						</span>
						{provider.providerId && (
							<span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
								{provider.providerId}
							</span>
						)}
						{isVertexConfig && (
							<span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
								Vertex AI
							</span>
						)}
					</div>
				</button>
				<div className="flex items-center gap-2">
					<span className="text-[10px] text-muted-foreground">
						{provider.models.length} model
						{provider.models.length !== 1 ? "s" : ""}
					</span>
					<button
						aria-label="Remove provider"
						className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
						onClick={(e) => {
							e.stopPropagation();
							onRemove();
						}}
						type="button"
					>
						<Trash2 className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>

			{/* Card body */}
			{expanded && (
				<div className="flex flex-col gap-5 border-t border-border px-4 py-4">
					{/* Provider selection */}
					<div className="flex flex-col gap-3">
						<FieldRow
							hint="Select a pre-defined provider (auto-fills config) or type a custom ID"
							label="Provider"
						>
							<div className="flex flex-col gap-2">
								<div className="flex flex-wrap gap-1.5">
									{BUILT_IN_PROVIDERS.map((bp) => {
										const disabled =
											bp.id !== provider.providerId && isProviderTaken(bp.id);
										return (
											<button
												disabled={disabled}
												className={cn(
													"rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all",
													provider.providerId === bp.id
														? "border-chart-5/40 bg-chart-5/10 text-chart-5"
														: "border-border bg-background text-muted-foreground hover:border-chart-5/20 hover:text-foreground",
													disabled &&
														"cursor-not-allowed opacity-40 hover:border-border hover:text-muted-foreground",
												)}
												key={bp.id}
												onClick={() => selectBuiltIn(bp.id)}
												type="button"
											>
												{bp.label}
											</button>
										);
									})}
								</div>
								<Input
									className="h-8 border-border bg-background font-mono text-xs text-foreground"
									onChange={(e) => {
										const nextProviderId = e.target.value.trim();
										if (nextProviderId && isProviderTaken(nextProviderId)) {
											setProviderConflictMessage(
												`Provider "${nextProviderId}" is already configured.`,
											);
											return;
										}

										setProviderConflictMessage("");
										update({ providerId: e.target.value });
									}}
									placeholder="or enter custom provider ID..."
									value={provider.providerId}
								/>
								{providerConflictMessage && (
									<p className="text-[10px] text-destructive">
										{providerConflictMessage}
									</p>
								)}
							</div>
						</FieldRow>
					</div>

					{!hasProviderSelected && (
						<div className="rounded-md border border-border bg-background/50 px-3 py-2 text-[11px] text-muted-foreground">
							Select a provider to continue with models, auth, and advanced
							settings.
						</div>
					)}

					{hasProviderSelected && (
						<>
							{/* Models */}
							<FieldRow
								hint='Press Enter or comma to add. First model is default if "Default Model" is empty.'
								label="Models"
							>
								<TagInput
									className="h-28 overflow-y-auto"
									onChange={(models) =>
										update({
											models,
											defaultModel: provider.defaultModel || models[0] || "",
										})
									}
									placeholder={
										builtIn
											? "Pre-filled from provider"
											: "e.g. gpt-5-mini, claude-sonnet-4"
									}
									values={provider.models}
								/>
							</FieldRow>

							{/* Default model */}
							<FieldRow
								hint="Falls back to first model if empty."
								label="Default Model"
							>
								<Select
									disabled={provider.models.length === 0}
									onValueChange={(value) => update({ defaultModel: value })}
									value={
										provider.defaultModel &&
										provider.models.includes(provider.defaultModel)
											? provider.defaultModel
											: undefined
									}
								>
									<SelectTrigger className="h-8 border-border bg-background font-mono text-xs text-foreground">
										<SelectValue
											placeholder={
												provider.models.length > 0
													? "Select default model"
													: "Add models first"
											}
										/>
									</SelectTrigger>
									<SelectContent>
										{provider.models.map((model) => (
											<SelectItem
												className="font-mono text-xs"
												key={model}
												value={model}
											>
												{model}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</FieldRow>

							{/* Auth */}
							<div className="flex flex-col gap-3">
								<Label className="text-xs text-muted-foreground">
									Authentication
								</Label>
								<div className="flex items-center gap-2">
									<button
										className={cn(
											"rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all",
											provider.useApiKeyEnv
												? "border-chart-5/40 bg-chart-5/10 text-chart-5"
												: "border-border text-muted-foreground hover:text-foreground",
										)}
										onClick={() => update({ useApiKeyEnv: true })}
										type="button"
									>
										Env Variable
									</button>
									<button
										className={cn(
											"rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all",
											!provider.useApiKeyEnv
												? "border-chart-5/40 bg-chart-5/10 text-chart-5"
												: "border-border text-muted-foreground hover:text-foreground",
										)}
										onClick={() => update({ useApiKeyEnv: false })}
										type="button"
									>
										Direct Key
									</button>
								</div>
								{provider.useApiKeyEnv ? (
									<Input
										className="h-8 border-border bg-background font-mono text-xs text-foreground"
										onChange={(e) => update({ apiKeyEnv: e.target.value })}
										placeholder="ANTHROPIC_API_KEY"
										value={provider.apiKeyEnv}
									/>
								) : (
									<Input
										className="h-8 border-border bg-background font-mono text-xs text-foreground"
										onChange={(e) => update({ apiKey: e.target.value })}
										placeholder="sk-..."
										type="password"
										value={provider.apiKey}
									/>
								)}
							</div>

							{/* Base URL */}
							<FieldRow
								hint="Optional. Override the provider endpoint."
								label="Base URL"
							>
								<Input
									className="h-8 border-border bg-background font-mono text-xs text-foreground"
									onChange={(e) => update({ baseUrl: e.target.value })}
									placeholder="https://api.example.com/v1"
									value={provider.baseUrl}
								/>
							</FieldRow>

							{/* Capabilities */}
							<FieldRow
								hint="Toggle provider capabilities."
								label="Capabilities"
							>
								<CapabilityToggle
									capabilities={provider.capabilities}
									onChange={(capabilities) => update({ capabilities })}
								/>
							</FieldRow>

							{/* Advanced section */}
							<button
								className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
								onClick={() => setShowAdvanced(!showAdvanced)}
								type="button"
							>
								<Settings2 className="h-3 w-3" />
								Advanced Settings
								{showAdvanced ? (
									<ChevronDown className="h-3 w-3" />
								) : (
									<ChevronRight className="h-3 w-3" />
								)}
							</button>

							{showAdvanced && (
								<div className="flex flex-col gap-4 rounded-lg border border-border bg-background/50 p-4">
									{/* Timeout */}
									<FieldRow
										hint="Optional request timeout in milliseconds."
										label="Timeout (ms)"
									>
										<Input
											className="h-8 border-border bg-background font-mono text-xs text-foreground"
											onChange={(e) =>
												update({
													timeoutMs: e.target.value
														? Number(e.target.value)
														: null,
												})
											}
											placeholder="30000"
											type="number"
											value={provider.timeoutMs ?? ""}
										/>
									</FieldRow>

									{/* Custom Headers */}
									<FieldRow label="Custom Headers">
										<HeadersEditor
											headers={provider.headers}
											onChange={(headers) => update({ headers })}
										/>
									</FieldRow>

									{/* GCP / Vertex settings */}
									{provider.providerId === "gemini" && (
										<>
											<div className="rounded-md border border-warning/20 bg-warning/5 p-3">
												<p className="text-[11px] text-warning">
													Set a GCP Project ID to use Vertex AI auth
													(ADC/service account) instead of API key.
												</p>
											</div>
											<FieldRow label="GCP Project ID">
												<Input
													className="h-8 border-border bg-background font-mono text-xs text-foreground"
													onChange={(e) =>
														update({ gcpProjectId: e.target.value })
													}
													placeholder="my-gcp-project"
													value={provider.gcpProjectId}
												/>
											</FieldRow>
											<FieldRow label="Region">
												<Input
													className="h-8 border-border bg-background font-mono text-xs text-foreground"
													onChange={(e) =>
														update({ gcpRegion: e.target.value })
													}
													placeholder="us-central1"
													value={provider.gcpRegion}
												/>
											</FieldRow>
										</>
									)}
									{provider.providerId === "bedrock" && (
										<>
											<div className="rounded-md border border-warning/20 bg-warning/5 p-3">
												<p className="text-[11px] text-warning">
													Bedrock supports IAM/profile auth or bearer token
													auth. Use Direct Key only for bearer token mode.
												</p>
											</div>
											<FieldRow label="AWS Authentication">
												<Select
													onValueChange={(
														value: "iam" | "api-key" | "profile",
													) => update({ awsAuthentication: value })}
													value={provider.awsAuthentication}
												>
													<SelectTrigger className="h-8 border-border bg-background text-xs text-foreground">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="iam">
															IAM / Credential Chain
														</SelectItem>
														<SelectItem value="profile">Profile</SelectItem>
														<SelectItem value="api-key">
															Bearer API Key
														</SelectItem>
													</SelectContent>
												</Select>
											</FieldRow>
											<FieldRow label="AWS Region">
												<Input
													className="h-8 border-border bg-background font-mono text-xs text-foreground"
													onChange={(e) =>
														update({ awsRegion: e.target.value })
													}
													placeholder="us-east-1"
													value={provider.awsRegion}
												/>
											</FieldRow>
											<FieldRow label="AWS Profile">
												<Input
													className="h-8 border-border bg-background font-mono text-xs text-foreground"
													onChange={(e) =>
														update({ awsProfile: e.target.value })
													}
													placeholder="default"
													value={provider.awsProfile}
												/>
											</FieldRow>
											<FieldRow label="AWS Access Key ID">
												<Input
													className="h-8 border-border bg-background font-mono text-xs text-foreground"
													onChange={(e) =>
														update({ awsAccessKey: e.target.value })
													}
													placeholder="AKIA..."
													value={provider.awsAccessKey}
												/>
											</FieldRow>
											<FieldRow label="AWS Secret Access Key">
												<Input
													className="h-8 border-border bg-background font-mono text-xs text-foreground"
													onChange={(e) =>
														update({ awsSecretKey: e.target.value })
													}
													placeholder="..."
													type="password"
													value={provider.awsSecretKey}
												/>
											</FieldRow>
											<FieldRow label="AWS Session Token">
												<Input
													className="h-8 border-border bg-background font-mono text-xs text-foreground"
													onChange={(e) =>
														update({ awsSessionToken: e.target.value })
													}
													placeholder="Optional"
													value={provider.awsSessionToken}
												/>
											</FieldRow>
										</>
									)}
								</div>
							)}
						</>
					)}
				</div>
			)}
		</div>
	);
}

// ─── Config Preview ─────────────────────────────────────────────────────────

function generateConfigCode(providers: ProviderConfig[]): string {
	const configProviders = providers
		.filter((p) => p.providerId)
		.map((p) => {
			const lines: string[] = [];
			lines.push(`    {`);
			lines.push(`      id: "${p.providerId}",`);
			lines.push(
				`      models: [${p.models.map((m) => `"${m}"`).join(", ")}],`,
			);
			if (p.defaultModel) {
				lines.push(`      defaultModel: "${p.defaultModel}",`);
			}
			if (p.useApiKeyEnv && p.apiKeyEnv) {
				lines.push(`      apiKeyEnv: "${p.apiKeyEnv}",`);
			} else if (!p.useApiKeyEnv && p.apiKey) {
				lines.push(`      apiKey: "${p.apiKey.slice(0, 8)}...",`);
			}
			if (p.baseUrl) {
				lines.push(`      baseUrl: "${p.baseUrl}",`);
			}
			if (Object.keys(p.headers).length > 0) {
				lines.push(`      headers: {`);
				Object.entries(p.headers).forEach(([k, v]) => {
					if (k) lines.push(`        "${k}": "${v}",`);
				});
				lines.push(`      },`);
			}
			if (p.timeoutMs) {
				lines.push(`      timeoutMs: ${p.timeoutMs},`);
			}
			if (p.capabilities.length > 0) {
				const capabilities = normalizeCapabilities(p.capabilities) ?? [];
				lines.push(
					`      capabilities: [${capabilities.map((c) => `"${c}"`).join(", ")}],`,
				);
			}
			// GCP settings for Gemini/Vertex
			if (p.providerId === "gemini" && p.gcpProjectId) {
				lines.push(`      settings: {`);
				lines.push(`        gcp: { projectId: "${p.gcpProjectId}" },`);
				if (p.gcpRegion) {
					lines.push(`        region: "${p.gcpRegion}",`);
				}
				lines.push(`      },`);
			}
			lines.push(`    }`);
			return lines.join("\n");
		});

	return `import { createLlmsSdk, defineLlmsConfig } from "@clinebot/llms"

const config = defineLlmsConfig({
  providers: [
${configProviders.join(",\n")}
  ],
})

const llms = createLlmsSdk(config)

// Create a handler for the first provider
${
	providers[0]?.providerId
		? `const handler = llms.createHandler({ providerId: "${providers[0].providerId}" })`
		: "// const handler = llms.createHandler({ providerId: ... })"
}`;
}

function ConfigPreview({ providers }: { providers: ProviderConfig[] }) {
	const [copied, setCopied] = useState(false);
	const code = generateConfigCode(providers);

	function copyToClipboard() {
		navigator.clipboard.writeText(code);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	return (
		<div className="flex flex-col rounded-xl border border-border bg-card">
			<div className="flex items-center justify-between border-b border-border px-4 py-2.5">
				<div className="flex items-center gap-2">
					<Code2 className="h-3.5 w-3.5 text-chart-5" />
					<span className="text-xs font-medium text-foreground">
						Generated Config
					</span>
				</div>
				<Button
					className="h-7 gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
					onClick={copyToClipboard}
					size="sm"
					variant="ghost"
				>
					{copied ? (
						<Check className="h-3 w-3 text-success" />
					) : (
						<Copy className="h-3 w-3" />
					)}
					{copied ? "Copied" : "Copy"}
				</Button>
			</div>
			<div className="overflow-x-auto p-4">
				<pre className="font-mono text-[11px] leading-relaxed text-foreground/80">
					<code>{code}</code>
				</pre>
			</div>
		</div>
	);
}

// ─── Test Panel ─────────────────────────────────────────────────────────────

function TestPanel({
	providers,
	results,
	onTest,
	onRegisterProvider,
	registeredProviderIds,
	registrationMessages,
	testing,
}: {
	providers: ProviderConfig[];
	results: TestResult[];
	onTest: (providerId: string, modelId: string) => void;
	onRegisterProvider: (provider: ProviderConfig) => void;
	registeredProviderIds: Set<string>;
	registrationMessages: Record<string, string>;
	testing: string | null;
}) {
	const configuredProviders = providers.filter(
		(p) => p.providerId && p.models.length > 0,
	);

	return (
		<div className="flex flex-col rounded-xl border border-border bg-card">
			<div className="border-b border-border px-4 py-2.5">
				<SectionHeader
					description="Validate your provider setup"
					icon={Play}
					title="Test Configuration"
				/>
			</div>
			<div className="flex flex-col gap-3 p-4">
				{configuredProviders.length === 0 ? (
					<p className="py-6 text-center text-xs text-muted-foreground">
						Add and configure a provider above to test your setup.
					</p>
				) : (
					configuredProviders.map((provider) => (
						<div
							className="rounded-lg border border-border bg-background/50 p-3"
							key={provider.id}
						>
							<div className="mb-2.5 flex items-center justify-between">
								<div className="flex items-center gap-2">
									<span className="text-xs font-medium text-foreground">
										{provider.providerId}
									</span>
									{registeredProviderIds.has(provider.providerId.trim()) && (
										<span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
											registered
										</span>
									)}
								</div>
								<div className="flex items-center gap-2">
									<span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
										{provider.models.length} model
										{provider.models.length !== 1 ? "s" : ""}
									</span>
									<Button
										className="h-6 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
										onClick={() => onRegisterProvider(provider)}
										size="sm"
										variant="ghost"
									>
										<Plus className="h-3 w-3" />
										{registeredProviderIds.has(provider.providerId.trim())
											? "Re-register"
											: "Register"}
									</Button>
								</div>
							</div>
							<div className="flex flex-col gap-1.5">
								{provider.models.map((model) => {
									const resultKey = `${provider.providerId}:${model}`;
									const result = results.find(
										(r) =>
											r.providerId === provider.providerId &&
											r.modelId === model,
									);
									const isRunning = testing === resultKey;

									return (
										<div
											className="flex items-center justify-between rounded-md border border-border px-3 py-2"
											key={model}
										>
											<div className="flex items-center gap-2">
												{result?.status === "success" && (
													<CheckCircle2 className="h-3.5 w-3.5 text-success" />
												)}
												{result?.status === "error" && (
													<AlertCircle className="h-3.5 w-3.5 text-destructive" />
												)}
												{isRunning && (
													<Loader2 className="h-3.5 w-3.5 animate-spin text-chart-5" />
												)}
												{!result && !isRunning && (
													<div className="h-3.5 w-3.5 rounded-full border border-border" />
												)}
												<span className="font-mono text-[11px] text-foreground">
													{model}
												</span>
											</div>
											<Button
												className="h-6 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
												disabled={isRunning}
												onClick={() => onTest(provider.providerId, model)}
												size="sm"
												variant="ghost"
											>
												{isRunning ? (
													<Loader2 className="h-3 w-3 animate-spin" />
												) : (
													<Play className="h-3 w-3" />
												)}
												Test
											</Button>
										</div>
									);
								})}
							</div>
							{/* Show last test result */}
							{results
								.filter((r) => r.providerId === provider.providerId)
								.slice(-1)
								.map((r) => (
									<div
										className={cn(
											"mt-2.5 rounded-md border p-2.5 text-[11px]",
											r.status === "success"
												? "border-success/20 bg-success/5 text-success"
												: "border-destructive/20 bg-destructive/5 text-destructive",
										)}
										key={r.timestamp}
									>
										{r.message}
									</div>
								))}
							{registrationMessages[provider.providerId.trim()] && (
								<div className="mt-2.5 rounded-md border border-chart-5/20 bg-chart-5/5 p-2.5 text-[11px] text-chart-5">
									{registrationMessages[provider.providerId.trim()]}
								</div>
							)}
						</div>
					))
				)}
			</div>
		</div>
	);
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function SdkPlayground() {
	const [providers, setProviders] = useState<ProviderConfig[]>([
		createEmptyProvider(),
	]);
	const [registeredProviders, setRegisteredProviders] = useState<
		Record<string, CustomProviderConfig>
	>({});
	const [registrationMessages, setRegistrationMessages] = useState<
		Record<string, string>
	>({});
	const [testResults, setTestResults] = useState<TestResult[]>([]);
	const [testing, setTesting] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState<"config" | "preview">("config");
	const [sidebarWidth, setSidebarWidth] = useState(440);
	const scrollRef = useRef<HTMLDivElement>(null);
	const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(
		null,
	);

	const MIN_SIDEBAR_WIDTH = 320;
	const MAX_SIDEBAR_WIDTH = 760;

	const addProvider = useCallback(() => {
		setProviders((prev) => [...prev, createEmptyProvider()]);
		// scroll to bottom after add
		setTimeout(
			() =>
				scrollRef.current?.scrollTo({
					top: scrollRef.current.scrollHeight,
					behavior: "smooth",
				}),
			100,
		);
	}, []);

	const removeProvider = useCallback((id: string) => {
		setProviders((prev) => {
			if (prev.length === 1) {
				return prev;
			}
			const removed = prev.find((p) => p.id === id)?.providerId.trim();
			if (removed) {
				setRegisteredProviders((current) => {
					if (!(removed in current)) {
						return current;
					}
					const next = { ...current };
					delete next[removed];
					return next;
				});
				setRegistrationMessages((current) => {
					if (!(removed in current)) {
						return current;
					}
					const next = { ...current };
					delete next[removed];
					return next;
				});
			}
			return prev.filter((p) => p.id !== id);
		});
	}, []);

	const updateProvider = useCallback((id: string, updated: ProviderConfig) => {
		setProviders((prev) => prev.map((p) => (p.id === id ? updated : p)));
	}, []);

	useEffect(() => {
		const activeProviderIds = new Set(
			providers.map((provider) => provider.providerId.trim()).filter(Boolean),
		);
		setRegisteredProviders((prev) => {
			const next = Object.fromEntries(
				Object.entries(prev).filter(([providerId]) =>
					activeProviderIds.has(providerId),
				),
			);
			return Object.keys(next).length === Object.keys(prev).length
				? prev
				: next;
		});
		setRegistrationMessages((prev) => {
			const next = Object.fromEntries(
				Object.entries(prev).filter(([providerId]) =>
					activeProviderIds.has(providerId),
				),
			);
			return Object.keys(next).length === Object.keys(prev).length
				? prev
				: next;
		});
	}, [providers]);

	const handleRegisterProvider = useCallback((provider: ProviderConfig) => {
		const providerId = provider.providerId.trim();
		try {
			const customProvider = toCustomProviderConfig(provider);
			if (!customProvider) {
				throw new Error(
					"Select a provider ID and add at least one model before registering.",
				);
			}
			setRegisteredProviders((prev) => ({
				...prev,
				[providerId]: customProvider,
			}));
			setRegistrationMessages((prev) => ({
				...prev,
				[providerId]: `Registered "${providerId}" in customProviders for SDK validation.`,
			}));
		} catch (error) {
			const details = error instanceof Error ? error.message : String(error);
			setRegistrationMessages((prev) => ({
				...prev,
				[providerId || provider.id]: `Registration failed. ${details}`,
			}));
		}
	}, []);

	const handleTest = useCallback(
		async (providerId: string, modelId: string) => {
			const key = `${providerId}:${modelId}`;
			setTesting(key);
			try {
				const runtimeProviders: ProviderSelectionConfig[] = [];
				const warnings: string[] = [];

				for (const provider of providers) {
					const runtimeConfig = toRuntimeProviderConfig(provider);
					if (!runtimeConfig) {
						continue;
					}
					runtimeProviders.push(runtimeConfig.config);
					warnings.push(...runtimeConfig.warnings);
				}

				if (runtimeProviders.length === 0) {
					throw new Error(
						"No configured providers found. Add at least one provider with models.",
					);
				}

				const configuredProvider = runtimeProviders.find(
					(provider) => provider.id === providerId,
				);
				if (!configuredProvider) {
					throw new Error(
						`Provider "${providerId}" is not configured in this playground config.`,
					);
				}

				if (!configuredProvider.models.includes(modelId)) {
					throw new Error(
						`Model "${modelId}" is not configured for provider "${providerId}".`,
					);
				}

				const warningSuffix =
					warnings.length > 0 ? ` Warnings: ${warnings.join(" ")}` : "";

				setTestResults((prev) => [
					...prev.filter(
						(r) => !(r.providerId === providerId && r.modelId === modelId),
					),
					{
						providerId,
						modelId,
						status: "success",
						message: `SDK config validation passed for "${providerId}/${modelId}".${warningSuffix}`,
						timestamp: Date.now(),
					},
				]);
			} catch (error) {
				const details = error instanceof Error ? error.message : String(error);
				setTestResults((prev) => [
					...prev.filter(
						(r) => !(r.providerId === providerId && r.modelId === modelId),
					),
					{
						providerId,
						modelId,
						status: "error",
						message: `SDK validation failed. ${details}`,
						timestamp: Date.now(),
					},
				]);
			} finally {
				setTesting(null);
			}
		},
		[providers],
	);

	const handleResizeStart = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			resizeStateRef.current = {
				startX: event.clientX,
				startWidth: sidebarWidth,
			};

			const handlePointerMove = (moveEvent: PointerEvent) => {
				const state = resizeStateRef.current;
				if (!state) {
					return;
				}
				const delta = moveEvent.clientX - state.startX;
				const nextWidth = Math.min(
					MAX_SIDEBAR_WIDTH,
					Math.max(MIN_SIDEBAR_WIDTH, state.startWidth - delta),
				);
				setSidebarWidth(nextWidth);
			};

			const handlePointerUp = () => {
				resizeStateRef.current = null;
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
				window.removeEventListener("pointermove", handlePointerMove);
				window.removeEventListener("pointerup", handlePointerUp);
			};

			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
			window.addEventListener("pointermove", handlePointerMove);
			window.addEventListener("pointerup", handlePointerUp);
		},
		[sidebarWidth],
	);

	return (
		<div className="flex min-h-[100dvh] flex-col bg-background">
			{/* Header */}
			<header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
				<div className="flex items-center gap-3">
					<Link
						aria-label="Back to home"
						className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-chart-5/40 hover:text-foreground sm:h-9 sm:w-9"
						href="/"
					>
						<ChevronLeft className="h-4 w-4" />
					</Link>
					<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-chart-5/10 sm:h-9 sm:w-9">
						<Terminal className="h-4 w-4 text-chart-5 sm:h-5 sm:w-5" />
					</div>
					<div>
						<h1 className="text-base font-semibold text-foreground sm:text-lg">
							SDK Playground
						</h1>
						<p className="text-[10px] text-muted-foreground sm:text-xs">
							Configure and test @clinebot/llms providers
						</p>
					</div>
				</div>
				<UserNav size="sm" />
			</header>

			{/* Tabs for mobile */}
			<div className="flex border-b border-border px-4 sm:px-6 lg:hidden">
				<button
					className={cn(
						"border-b-2 px-4 py-2.5 text-xs font-medium transition-colors",
						activeTab === "config"
							? "border-chart-5 text-chart-5"
							: "border-transparent text-muted-foreground hover:text-foreground",
					)}
					onClick={() => setActiveTab("config")}
					type="button"
				>
					Configuration
				</button>
				<button
					className={cn(
						"border-b-2 px-4 py-2.5 text-xs font-medium transition-colors",
						activeTab === "preview"
							? "border-chart-5 text-chart-5"
							: "border-transparent text-muted-foreground hover:text-foreground",
					)}
					onClick={() => setActiveTab("preview")}
					type="button"
				>
					Preview & Test
				</button>
			</div>

			{/* Main content */}
			<div className="flex flex-1 overflow-hidden">
				{/* Left: Config panel */}
				<div
					className={cn(
						"flex-1 overflow-y-auto p-4 sm:p-6",
						activeTab !== "config" && "hidden lg:block",
					)}
					ref={scrollRef}
				>
					<div className="mx-auto max-w-2xl">
						<SectionHeader
							description="Set up your @clinebot/llms providers, models, and auth"
							icon={Braces}
							title="Provider Configuration"
						/>

						<div className="mt-4 flex flex-col gap-4">
							{providers.map((provider, i) => (
								<ProviderCard
									index={i}
									key={provider.id}
									onChange={(p) => updateProvider(provider.id, p)}
									onRemove={() => removeProvider(provider.id)}
									provider={provider}
									takenProviderIds={providers
										.filter((p) => p.id !== provider.id)
										.map((p) => p.providerId.trim())
										.filter((id) => id.length > 0)}
								/>
							))}

							<Button
								className="gap-2 border-dashed border-border text-muted-foreground hover:border-chart-5/40 hover:text-foreground"
								onClick={addProvider}
								variant="outline"
							>
								<Plus className="h-4 w-4" />
								Add Provider
							</Button>
						</div>
					</div>
				</div>

				<div
					className="group hidden w-2 cursor-col-resize items-stretch justify-center bg-transparent lg:flex"
					onPointerDown={handleResizeStart}
				>
					<div className="w-px bg-border transition-colors group-hover:bg-chart-5/50" />
				</div>

				{/* Right: Preview + Test */}
				<div
					className={cn(
						"flex w-full flex-col gap-4 overflow-y-auto border-l border-border p-4 sm:p-6 lg:w-[var(--sidebar-width)] lg:shrink-0",
						activeTab !== "preview" && "hidden lg:flex",
					)}
					style={
						{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties
					}
				>
					<ConfigPreview providers={providers} />
					<TestPanel
						onRegisterProvider={handleRegisterProvider}
						onTest={handleTest}
						providers={providers}
						registrationMessages={registrationMessages}
						registeredProviderIds={new Set(Object.keys(registeredProviders))}
						results={testResults}
						testing={testing}
					/>
				</div>
			</div>
		</div>
	);
}
