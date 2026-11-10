"use client";

import {
	DEFAULT_FACTORY_AGENTS,
	type FactoryAgent,
	type FactoryTaskConfig,
} from "@cline/shared/browser";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFactoryPresets } from "@/hooks/use-factory-presets";
import { desktopClient } from "@/lib/desktop-client";
import {
	type FactoryPreset,
	factoryPresetConfigSchema,
} from "@/lib/factory-presets";
import { ModelSelector } from "../chat/chat-input-bar";

const noop = () => {};
function applyPreset(
	config: FactoryTaskConfig,
	preset: FactoryPreset["config"],
): FactoryTaskConfig {
	const copied = structuredClone(preset);
	return {
		...config,
		...copied,
		agents: copied.agents,
		maxCostUsd: copied.maxCostUsd,
		maxRuntimeRetries: copied.maxRuntimeRetries,
	};
}
export function FactoryWorkflowEditor({
	config,
	disabled,
	onChange,
	standalone = false,
}: {
	config: FactoryTaskConfig;
	disabled: boolean;
	onChange: (config: FactoryTaskConfig) => void;
	standalone?: boolean;
}) {
	const agents = config.agents ?? DEFAULT_FACTORY_AGENTS;
	const id = useId();
	const {
		presets,
		setPresets,
		defaultPreset,
		setDefaultPreset,
		loading,
		error: loadError,
		reload,
	} = useFactoryPresets();
	const [name, setName] = useState("");
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);
	const [useByDefault, setUseByDefault] = useState(false);
	const hydrated = useRef(false);
	useEffect(() => {
		if (loading) {
			hydrated.current = false;
			return;
		}
		if (hydrated.current || loadError) return;
		hydrated.current = true;
		if (!standalone || name || !defaultPreset) return;
		const preset = presets.find((item) => item.name === defaultPreset);
		if (preset) {
			onChange(applyPreset(config, preset.config));
			setName(preset.name);
			setUseByDefault(true);
		} else
			setError(
				`Default workflow “${defaultPreset}” is missing or invalid. Apply another preset or save a replacement.`,
			);
	}, [
		loading,
		loadError,
		standalone,
		name,
		defaultPreset,
		presets,
		config,
		onChange,
	]);
	return (
		<details className="rounded-lg border p-4" open={standalone || undefined}>
			<summary className="cursor-pointer text-sm font-semibold">
				Workflow · {agents.implementers.length} implementers ·{" "}
				{agents.planReviewers.length} plan reviewers · {agents.reviewers.length}{" "}
				final reviewers
				{agents.verifier ? " · agent verification" : ""}
			</summary>
			<fieldset className="mt-4 space-y-4" disabled={standalone && loading}>
				<div className="flex flex-wrap gap-2">
					<select
						aria-label="Apply workflow preset"
						className="h-9 rounded-md border bg-background px-3 text-sm"
						value=""
						disabled={disabled || loading || saving}
						onChange={(event) => {
							const preset = presets.find(
								(item) => item.name === event.target.value,
							);
							if (preset) {
								onChange(applyPreset(config, preset.config));
								setName(preset.name);
								setError("");
								setUseByDefault(preset.name === defaultPreset);
							}
						}}
					>
						<option value="">Apply local preset…</option>
						{presets.map((preset) => (
							<option key={preset.name} value={preset.name}>
								{preset.name}
								{preset.name === defaultPreset ? " (default)" : ""}
							</option>
						))}
					</select>
					<Input
						aria-label="Preset name"
						placeholder="Preset name"
						className="w-44"
						value={name}
						disabled={disabled || saving || loading}
						onChange={(event) => {
							setName(event.target.value);
							setUseByDefault(event.target.value.trim() === defaultPreset);
						}}
					/>
					<Button
						variant="outline"
						size="sm"
						disabled={disabled || saving || loading || !name.trim()}
						onClick={() => {
							setSaving(true);
							setError("");
							void Promise.resolve()
								.then(() =>
									desktopClient.invoke<FactoryPreset[]>("factory_save_preset", {
										name,
										config: factoryPresetConfigSchema.parse(config),
										useByDefault,
									}),
								)
								.then((items) => {
									setPresets(items);
									if (useByDefault) setDefaultPreset(name.trim());
									else if (defaultPreset === name.trim())
										setDefaultPreset(undefined);
								})
								.catch((cause: unknown) =>
									setError(
										cause instanceof Error
											? cause.message
											: "Unable to save preset.",
									),
								)
								.finally(() => setSaving(false));
						}}
					>
						Save preset
					</Button>
				</div>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={useByDefault}
						disabled={disabled || loading || saving}
						onChange={(event) => setUseByDefault(event.target.checked)}
					/>
					Use this preset by default for new work (when saved)
				</label>
				{loading ? (
					<p className="text-xs text-muted-foreground">Loading workflows…</p>
				) : null}
				<p className="text-xs text-muted-foreground">
					Presets copy participants, repair limits, and approval policy into new
					work. Checks, reference docs, source issues, execution, and PR
					settings stay with each feature.
					{standalone
						? " Saving a preset does not change existing work."
						: " Save and approve the updated brief before execution."}
				</p>
				{!standalone && agents.planReviewers.length > 0 ? (
					<p className="text-xs text-muted-foreground">
						After editing this brief, rerun the design interview and plan
						reviews before approval. The designer may propose a revised brief.
					</p>
				) : null}
				{error || loadError ? (
					<p role="alert" className="text-xs text-destructive">
						{error || loadError}
						<Button
							variant="ghost"
							size="sm"
							disabled={loading || saving}
							onClick={() => {
								setError("");
								reload();
							}}
						>
							Reload workflows
						</Button>
					</p>
				) : null}
				<div className="grid gap-3 sm:grid-cols-2">
					<label htmlFor={`${id}-repairs`} className="space-y-1 text-xs">
						<span>Repair rounds</span>
						<Input
							id={`${id}-repairs`}
							type="number"
							min={0}
							max={10}
							value={config.maxRepairRounds}
							disabled={disabled}
							onChange={(event) =>
								onChange({
									...config,
									maxRepairRounds: Math.max(
										0,
										Math.min(10, Number(event.target.value)),
									),
								})
							}
						/>
					</label>
					<label htmlFor={`${id}-approval`} className="space-y-1 text-xs">
						<span>Plan approval</span>
						<select
							id={`${id}-approval`}
							className="h-9 w-full rounded-md border bg-background px-3 text-sm"
							value={config.approval}
							disabled={disabled}
							onChange={(event) =>
								onChange({
									...config,
									approval:
										event.target.value === "automatic"
											? "automatic"
											: "required",
								})
							}
						>
							<option value="required">Require my approval</option>
							<option value="automatic">Run after plan reviews pass</option>
						</select>
					</label>
					<label htmlFor={`${id}-retries`} className="space-y-1 text-xs">
						<span>Runtime retries per stage</span>
						<Input
							id={`${id}-retries`}
							type="number"
							min={0}
							max={5}
							value={config.maxRuntimeRetries ?? 2}
							disabled={disabled}
							onChange={(event) =>
								onChange({
									...config,
									maxRuntimeRetries: Number(event.target.value),
								})
							}
						/>
					</label>
					<label htmlFor={`${id}-cost`} className="space-y-1 text-xs">
						<span>Pause new work after recorded cost ($)</span>
						<Input
							id={`${id}-cost`}
							type="number"
							min={0.01}
							step={0.01}
							placeholder="No threshold"
							value={config.maxCostUsd ?? ""}
							disabled={disabled}
							onChange={(event) =>
								onChange({
									...config,
									maxCostUsd: event.target.value
										? Number(event.target.value)
										: undefined,
								})
							}
						/>
					</label>
				</div>
				<p className="text-xs text-muted-foreground">
					Runtime retries cover failed sessions and malformed output; code
					repairs use the separate repair limit. The cost threshold pauses new
					execution sessions after recorded usage reaches it. In-flight work can
					exceed it.
				</p>
				<AgentEditor
					label="Designer"
					agent={agents.designer}
					disabled={disabled}
					onChange={(designer) =>
						onChange({ ...config, agents: { ...agents, designer } })
					}
				/>
				{(["planReviewers", "implementers", "reviewers"] as const).map(
					(role) => (
						<div key={role} className="space-y-2">
							{agents[role].map((agent, index) => (
								<div key={index} className="flex items-start gap-2">
									<div className="min-w-0 flex-1">
										<AgentEditor
											label={`${role === "planReviewers" ? "Plan reviewer" : role === "implementers" ? "Implementer" : "Final reviewer"} ${index + 1}`}
											agent={agent}
											disabled={disabled}
											onChange={(next) =>
												onChange({
													...config,
													agents: {
														...agents,
														[role]: agents[role].map((item, i) =>
															i === index ? next : item,
														),
													},
												})
											}
										/>
									</div>
									<Button
										variant="ghost"
										size="sm"
										aria-label={`Remove ${role === "planReviewers" ? "plan reviewer" : role === "implementers" ? "implementer" : "final reviewer"} ${index + 1}`}
										disabled={
											disabled ||
											(role !== "planReviewers" && agents[role].length === 1)
										}
										onClick={() =>
											onChange({
												...config,
												agents: {
													...agents,
													[role]: agents[role].filter((_, i) => i !== index),
												},
											})
										}
									>
										Remove
									</Button>
								</div>
							))}
							<Button
								variant="outline"
								size="sm"
								disabled={disabled || agents[role].length >= 4}
								onClick={() =>
									onChange({
										...config,
										agents: { ...agents, [role]: [...agents[role], {}] },
									})
								}
							>
								Add{" "}
								{role === "planReviewers"
									? "plan reviewer"
									: role === "implementers"
										? "implementer"
										: "final reviewer"}
							</Button>
						</div>
					),
				)}
				<p className="text-xs text-muted-foreground">
					Independent approved units rotate through implementers in their listed
					order. The first implementer handles a single build, integration, and
					repairs. Started units keep their assigned implementer when resumed.
				</p>
				<label className="flex gap-2 text-sm">
					<input
						type="checkbox"
						checked={!!agents.verifier}
						disabled={disabled}
						onChange={(event) =>
							onChange({
								...config,
								agents: {
									...agents,
									verifier: event.target.checked ? {} : undefined,
								},
							})
						}
					/>
					Agent verification
				</label>
				{agents.verifier ? (
					<>
						<AgentEditor
							label="Verifier"
							agent={agents.verifier}
							disabled={disabled}
							onChange={(verifier) =>
								onChange({
									...config,
									agents: {
										...agents,
										verifier: { ...agents.verifier, ...verifier },
									},
								})
							}
						/>
						<Input
							aria-label="Verifier evidence paths"
							placeholder="Evidence paths, separated by commas"
							value={agents.verifier.artifacts?.join(", ") ?? ""}
							disabled={disabled}
							onChange={(event) =>
								onChange({
									...config,
									agents: {
										...agents,
										verifier: {
											...agents.verifier,
											artifacts: event.target.value
												.split(",")
												.map((path) => path.trim())
												.filter(Boolean),
										},
									},
								})
							}
						/>
					</>
				) : null}
			</fieldset>
		</details>
	);
}
function AgentEditor({
	label,
	agent,
	disabled,
	onChange,
}: {
	label: string;
	agent: FactoryAgent;
	disabled: boolean;
	onChange: (agent: FactoryAgent) => void;
}) {
	const [chooseModel, setChooseModel] = useState(false);
	const id = useId();
	return (
		<details className="rounded border p-3">
			<summary className="cursor-pointer text-sm">
				{label} ·{" "}
				{agent.modelSelection
					? `${agent.modelSelection.providerId}/${agent.modelSelection.modelId}`
					: agent.profile
						? "Profile or feature model"
						: "Feature model"}
			</summary>
			<div className="mt-3 space-y-3">
				<div className="flex flex-wrap items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={disabled}
						onClick={() => setChooseModel(!chooseModel)}
					>
						Choose model
					</Button>
					{agent.modelSelection ? (
						<Button
							variant="ghost"
							size="sm"
							disabled={disabled}
							onClick={() => onChange({ ...agent, modelSelection: undefined })}
						>
							{agent.profile
								? "Use profile or feature model"
								: "Use feature model"}
						</Button>
					) : null}
				</div>
				{chooseModel ? (
					<ModelSelector
						provider={agent.modelSelection?.providerId ?? ""}
						model={agent.modelSelection?.modelId ?? ""}
						isBusy={disabled}
						autoCorrectModel={false}
						persistSelection={false}
						onProviderChange={noop}
						onModelChange={noop}
						onSelectionChange={(modelSelection) =>
							onChange({ ...agent, modelSelection })
						}
						onModelReadyChange={noop}
						onModelSupportsReasoningChange={noop}
						onModelSupportsImagesChange={noop}
					/>
				) : null}
				<label htmlFor={`${id}-profile`} className="block space-y-1 text-xs">
					<span>Configured agent profile</span>
					<Input
						id={`${id}-profile`}
						aria-label={`${label} profile`}
						value={agent.profile ?? ""}
						disabled={disabled}
						placeholder="Name from .cline/agents"
						onChange={(event) =>
							onChange({
								...agent,
								profile: event.target.value || undefined,
								resolvedProfile: undefined,
							})
						}
					/>
				</label>
				<label htmlFor={`${id}-skills`} className="block space-y-1 text-xs">
					<span>Skills override</span>
					<Input
						id={`${id}-skills`}
						aria-label={`${label} skills`}
						value={agent.skills?.join(", ") ?? ""}
						disabled={disabled}
						placeholder="Comma-separated skill names"
						onChange={(event) =>
							onChange({
								...agent,
								skills: event.target.value.trim()
									? event.target.value
											.split(",")
											.map((name) => name.trim())
											.filter(Boolean)
									: undefined,
							})
						}
					/>
				</label>
				<Textarea
					aria-label={`${label} instructions`}
					placeholder="Additional instructions"
					value={agent.instructions ?? ""}
					disabled={disabled}
					rows={3}
					onChange={(event) =>
						onChange({ ...agent, instructions: event.target.value })
					}
				/>
				<div className="grid grid-cols-2 gap-3">
					{(["maxIterations", "timeoutSeconds"] as const).map((field) => (
						<label
							key={field}
							htmlFor={`${id}-${field}`}
							className="space-y-1 text-xs"
						>
							{field === "maxIterations"
								? "Host iterations"
								: "Timeout (seconds)"}
							<Input
								id={`${id}-${field}`}
								aria-label={`${label} ${field}`}
								type="number"
								min={1}
								max={field === "maxIterations" ? 1000 : 7200}
								placeholder="Default"
								value={agent[field] ?? ""}
								disabled={disabled}
								onChange={(event) =>
									onChange({
										...agent,
										[field]:
											event.target.value === ""
												? undefined
												: Number(event.target.value),
									})
								}
							/>
						</label>
					))}
				</div>
			</div>
		</details>
	);
}
