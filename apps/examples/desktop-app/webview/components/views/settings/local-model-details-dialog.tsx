"use client";

import { ChevronRight, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import {
	formatGb,
	isPinnedLoaded,
	LOCAL_RUNTIMES,
	type LocalModelDetails,
	type LocalModelsStatus,
	type LocalRuntime,
} from "@/lib/local-models";

const MODELFILE_DOCS_URL =
	"https://github.com/ollama/ollama/blob/main/docs/modelfile.md";

/** Sampling options from Ollama's Modelfile reference, with its documented defaults. */
const SAMPLING_OPTIONS: { key: string; label: string; fallback: string }[] = [
	{ key: "temperature", label: "Temperature", fallback: "0.8" },
	{ key: "top_p", label: "Top P", fallback: "0.9" },
	{ key: "top_k", label: "Top K", fallback: "40" },
	{ key: "min_p", label: "Min P", fallback: "0.0" },
	{ key: "repeat_penalty", label: "Repeat penalty", fallback: "1.1" },
	{ key: "repeat_last_n", label: "Repeat last N", fallback: "64" },
	{ key: "num_predict", label: "Max output tokens", fallback: "-1 (no limit)" },
	{ key: "seed", label: "Seed", fallback: "0 (random)" },
];

/** The LM Studio load settings worth showing, by their REST API name. */
const LOAD_CONFIG_LABELS: Record<string, string> = {
	context_length: "Context length",
	flash_attention: "Flash attention",
	offload_kv_cache_to_gpu: "KV cache on GPU",
	eval_batch_size: "Evaluation batch size",
	parallel: "Parallel requests",
	num_experts: "Active experts",
	speculative_draft_model: "Draft model",
};

const formatConfigValue = (value: string | number | boolean) =>
	typeof value === "boolean" ? (value ? "On" : "Off") : value.toLocaleString();

const CAPABILITY_LABELS: Record<string, string> = {
	completion: "Chat",
	tools: "Tool use",
	thinking: "Thinking",
	vision: "Vision",
	insert: "Fill-in-the-middle",
	embedding: "Embeddings",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-3">
			<h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{title}
			</h3>
			{children}
		</section>
	);
}

function ReadOnlyField({
	label,
	option,
	value,
	hint,
}: {
	label: string;
	option?: string;
	value: string;
	hint?: string;
}) {
	return (
		<div className="flex flex-col gap-1">
			<span className="flex items-baseline justify-between gap-2 text-xs text-foreground">
				{label}
				{option ? (
					<code className="text-[11px] text-muted-foreground">{option}</code>
				) : null}
			</span>
			<Input
				aria-label={label}
				className="h-8 text-sm"
				disabled
				value={value}
			/>
			{hint ? (
				<span className="text-[11px] text-muted-foreground">{hint}</span>
			) : null}
		</div>
	);
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="flex flex-col">
			<span className="text-[11px] text-muted-foreground">{label}</span>
			<span className="text-sm text-foreground">{value || "-"}</span>
		</div>
	);
}

function TextBlock({ title, text }: { title: string; text: string }) {
	return (
		<Collapsible>
			<CollapsibleTrigger className="group flex items-center gap-1 text-sm text-foreground hover:underline">
				<ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
				{title}
			</CollapsibleTrigger>
			<CollapsibleContent>
				<Textarea
					aria-label={title}
					className="mt-2 h-48 resize-y font-mono text-xs"
					readOnly
					value={text.trim()}
				/>
			</CollapsibleContent>
		</Collapsible>
	);
}

const formatTokens = (tokens: number) =>
	tokens > 0 ? `${tokens.toLocaleString()} tokens` : "";

export function LocalModelDetailsDialog({
	runtime,
	model,
	sizeBytes,
	contextWindow,
	running,
	onOpenChange,
}: {
	runtime: LocalRuntime;
	/** Opens the dialog when set. */
	model: string | undefined;
	sizeBytes: number;
	contextWindow: number;
	running: LocalModelsStatus["running"][number] | undefined;
	onOpenChange: (open: boolean) => void;
}) {
	const [details, setDetails] = useState<LocalModelDetails>();
	const [error, setError] = useState<string>();
	const isOllama = runtime === "ollama";

	useEffect(() => {
		if (!model) {
			return;
		}
		let cancelled = false;
		setDetails(undefined);
		setError(undefined);
		desktopClient
			.invoke<LocalModelDetails>("show_local_model", { runtime, model })
			.then((next) => {
				if (!cancelled) setDetails(next);
			})
			.catch((reason) => {
				if (!cancelled) {
					setError(reason instanceof Error ? reason.message : String(reason));
				}
			});
		return () => {
			cancelled = true;
		};
	}, [runtime, model]);

	const parameters = details?.parameters ?? {};
	const knownKeys = new Set([
		...SAMPLING_OPTIONS.map((option) => option.key),
		"stop",
		"num_ctx",
	]);
	const extraParameters = Object.entries(parameters).filter(
		([key]) => !knownKeys.has(key),
	);
	const supportsThinking = details?.capabilities.includes("thinking");

	return (
		<Dialog onOpenChange={onOpenChange} open={!!model}>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="font-mono text-base">{model}</DialogTitle>
					<DialogDescription>
						The settings {LOCAL_RUNTIMES[runtime].name} runs this model with.
						They're read-only for now.
					</DialogDescription>
				</DialogHeader>

				{error ? (
					<p className="text-sm text-destructive" role="alert">
						{error}
					</p>
				) : !details ? (
					<div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						Reading model details…
					</div>
				) : (
					<div className="flex flex-col gap-6">
						<Section title="Model">
							<div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
								<Fact label="Architecture" value={details.architecture} />
								<Fact label="Parameters" value={details.parameterSize} />
								<Fact label="Quantization" value={details.quantization} />
								<Fact label="Size on disk" value={formatGb(sizeBytes)} />
								<Fact
									label="Max context"
									value={formatTokens(details.contextLength)}
								/>
								{isOllama ? (
									<>
										<Fact
											label="Embedding size"
											value={details.embeddingLength || ""}
										/>
										<Fact label="Layers" value={details.layers || ""} />
									</>
								) : null}
								<Fact label="Format" value={details.format.toUpperCase()} />
							</div>
							{details.capabilities.length > 0 ? (
								<div className="flex flex-wrap gap-1.5">
									{details.capabilities.map((capability) => (
										<Badge key={capability} variant="muted">
											{CAPABILITY_LABELS[capability] ?? capability}
										</Badge>
									))}
								</div>
							) : null}
						</Section>

						<Section title="How Cline runs it">
							<div className="grid gap-3 sm:grid-cols-2">
								<ReadOnlyField
									hint={
										details.contextLength > 0
											? `The model supports up to ${details.contextLength.toLocaleString()}. Larger windows need more memory.`
											: undefined
									}
									label="Context window"
									option={isOllama ? "num_ctx" : "context_length"}
									value={formatTokens(contextWindow)}
								/>
								{isOllama ? (
									<ReadOnlyField
										hint="Set with OLLAMA_KEEP_ALIVE on the Ollama server."
										label="Keep loaded"
										option="keep_alive"
										value={
											running?.expiresAtMs &&
											isPinnedLoaded(running.expiresAtMs)
												? "Until unloaded"
												: "5 minutes after last use (Ollama default)"
										}
									/>
								) : (
									<ReadOnlyField
										hint="Models LM Studio loads on its own unload after an hour idle."
										label="Keep loaded"
										value="Until unloaded, when loaded from Cline"
									/>
								)}
								<ReadOnlyField
									label="Thinking"
									option={isOllama ? "think" : undefined}
									value={
										supportsThinking
											? "Follows the composer's Thinking level"
											: "Not supported by this model"
									}
								/>
								{isOllama ? (
									<ReadOnlyField
										hint="Includes loading the model, so large models on slow hardware can hit it."
										label="Response timeout"
										value="5 minutes to start responding (default)"
									/>
								) : null}
							</div>
						</Section>

						{isOllama ? null : (
							<Section title="Load settings">
								{details.loadConfig ? (
									<div className="grid gap-3 sm:grid-cols-2">
										{Object.entries(LOAD_CONFIG_LABELS).map(([key, label]) => {
											const value = details.loadConfig?.[key];
											return value === undefined || value === "" ? null : (
												<ReadOnlyField
													key={key}
													label={label}
													option={key}
													value={formatConfigValue(value)}
												/>
											);
										})}
									</div>
								) : (
									<p className="text-sm text-muted-foreground">
										Load the model to see the settings LM Studio loads it with.
									</p>
								)}
								<p className="text-xs text-muted-foreground">
									Defaults for sampling and loading are set per model in LM
									Studio's My Models.
								</p>
							</Section>
						)}

						{isOllama ? (
							<>
								<Section title="Sampling">
									<div className="grid gap-3 sm:grid-cols-2">
										{SAMPLING_OPTIONS.map((option) => {
											const value = parameters[option.key]?.join(", ");
											return (
												<ReadOnlyField
													hint={value ? "Set by the model" : "Ollama default"}
													key={option.key}
													label={option.label}
													option={option.key}
													value={value ?? option.fallback}
												/>
											);
										})}
										{extraParameters.map(([key, values]) => (
											<ReadOnlyField
												hint="Set by the model"
												key={key}
												label={key}
												value={values.join(", ")}
											/>
										))}
									</div>
									{parameters.stop?.length ? (
										<div className="flex flex-col gap-1">
											<span className="flex items-baseline justify-between text-xs text-foreground">
												Stop sequences
												<code className="text-[11px] text-muted-foreground">
													stop
												</code>
											</span>
											<div className="flex flex-wrap gap-1.5">
												{parameters.stop.map((stop) => (
													<code
														className="rounded border bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground"
														key={stop}
													>
														{stop}
													</code>
												))}
											</div>
										</div>
									) : null}
								</Section>

								<Section title="Advanced">
									<div className="flex flex-col gap-2">
										{details.template ? (
											<TextBlock
												text={details.template}
												title="Prompt template"
											/>
										) : null}
										{details.system ? (
											<TextBlock text={details.system} title="System prompt" />
										) : null}
										{details.modelfile ? (
											<TextBlock text={details.modelfile} title="Modelfile" />
										) : null}
										{details.license ? (
											<TextBlock text={details.license} title="License" />
										) : null}
									</div>
									<p className="text-xs text-muted-foreground">
										To change these, build your own variant of the model from a{" "}
										<button
											className="text-primary underline-offset-4 hover:underline"
											onClick={() => void openExternalUrl(MODELFILE_DOCS_URL)}
											type="button"
										>
											Modelfile
										</button>{" "}
										with <code>ollama create</code>. It then shows up under
										Downloaded models.
									</p>
								</Section>
							</>
						) : null}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
