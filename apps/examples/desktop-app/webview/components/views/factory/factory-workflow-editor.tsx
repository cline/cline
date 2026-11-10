"use client";

import {
	DEFAULT_FACTORY_AGENTS,
	type FactoryAgent,
	type FactoryTaskConfig,
} from "@cline/shared/browser";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { desktopClient } from "@/lib/desktop-client";
import {
	type FactoryPreset,
	factoryPresetConfigSchema,
} from "@/lib/factory-presets";
import { ModelSelector } from "../chat/chat-input-bar";

const noop = () => {};
export function FactoryWorkflowEditor({
	config,
	disabled,
	onChange,
}: {
	config: FactoryTaskConfig;
	disabled: boolean;
	onChange: (config: FactoryTaskConfig) => void;
}) {
	const agents = config.agents ?? DEFAULT_FACTORY_AGENTS;
	const id = useId();
	const [presets, setPresets] = useState<FactoryPreset[]>([]);
	const [name, setName] = useState("");
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);
	useEffect(() => {
		let active = true;
		void desktopClient
			.invoke<FactoryPreset[]>("factory_list_presets")
			.then((items) => {
				if (active) setPresets(items);
			})
			.catch((cause: unknown) => {
				if (active)
					setError(
						cause instanceof Error ? cause.message : "Unable to load presets.",
					);
			});
		return () => {
			active = false;
		};
	}, []);
	return (
		<details className="rounded-lg border p-4">
			<summary className="cursor-pointer text-sm font-semibold">
				Workflow · {agents.planReviewers.length} plan reviewers ·{" "}
				{agents.reviewers.length} final reviewers
				{agents.verifier ? " · agent verification" : ""}
			</summary>
			<div className="mt-4 space-y-4">
				<div className="flex flex-wrap gap-2">
					<select
						aria-label="Apply workflow preset"
						className="h-9 rounded-md border bg-background px-3 text-sm"
						value=""
						disabled={disabled}
						onChange={(event) => {
							const preset = presets.find(
								(item) => item.name === event.target.value,
							);
							if (preset) {
								onChange({
									...config,
									...structuredClone(preset.config),
									agents: structuredClone(preset.config.agents),
								});
								setName(preset.name);
							}
						}}
					>
						<option value="">Apply local preset…</option>
						{presets.map((preset) => (
							<option key={preset.name} value={preset.name}>
								{preset.name}
							</option>
						))}
					</select>
					<Input
						aria-label="Preset name"
						placeholder="Preset name"
						className="w-44"
						value={name}
						disabled={disabled || saving}
						onChange={(event) => setName(event.target.value)}
					/>
					<Button
						variant="outline"
						size="sm"
						disabled={disabled || saving || !name.trim()}
						onClick={() => {
							setSaving(true);
							setError("");
							void Promise.resolve()
								.then(() =>
									desktopClient.invoke<FactoryPreset[]>("factory_save_preset", {
										name,
										config: factoryPresetConfigSchema.parse(config),
									}),
								)
								.then(setPresets)
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
				<p className="text-xs text-muted-foreground">
					Presets copy participants, repair limits, and approval policy into
					this draft. Checks, reference docs, source issues, execution, and PR
					settings stay with this feature. Save and approve the updated brief
					before execution.
				</p>
				{agents.planReviewers.length > 0 ? (
					<p className="text-xs text-muted-foreground">
						After editing this brief, rerun the design interview and plan
						reviews before approval. The designer may propose a revised brief.
					</p>
				) : null}
				{error ? (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				) : null}
				<div className="grid gap-3 sm:grid-cols-2">
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
				{(["planReviewers", "reviewers"] as const).map((role) => (
					<div key={role} className="space-y-2">
						{agents[role].map((agent, index) => (
							<div key={index} className="flex items-start gap-2">
								<div className="min-w-0 flex-1">
									<AgentEditor
										label={`${role === "planReviewers" ? "Plan reviewer" : "Final reviewer"} ${index + 1}`}
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
									disabled={
										disabled ||
										(role === "reviewers" && agents[role].length === 1)
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
							Add {role === "planReviewers" ? "plan" : "final"} reviewer
						</Button>
					</div>
				))}
				<AgentEditor
					label="Implementer"
					agent={agents.implementer}
					disabled={disabled}
					onChange={(implementer) =>
						onChange({ ...config, agents: { ...agents, implementer } })
					}
				/>
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
			</div>
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
							Use feature model
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
