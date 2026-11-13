"use client";

import type {
	FactoryAgent,
	FactoryAppEnvironment,
} from "@cline/shared/browser";
import { Plus, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FS_ROLES, type FsRoleKey } from "@/lib/factory-settings-copy/roles";
import { cn } from "@/lib/utils";
import {
	ActionButton,
	DisclosureRow,
	OptionalNumber,
	rowLabels,
	SettingRow,
	StatusPill,
} from "../../../factory-settings-rows";
import { AppEnvironmentEditor } from "../../../factory-workflow-editor";
import {
	type Agents,
	isListRole,
	ROLE_BOUNDS,
	roleAgents,
	withAgent,
} from "./agents";
import { ModelPicker } from "./model-picker";

type Verifier = NonNullable<Agents["verifier"]>;

export type RoleDetailProps = {
	role: FsRoleKey;
	agents: Agents;
	/** The selected agent (tab). */
	index: number;
	onSelect: (index: number) => void;
	disabled: boolean;
	/** Saves the agents; `row` is where an error shows. */
	onChange: (agents: Agents, row: string) => void;
	onAdd: () => void;
	onRemove: (index: number) => void;
	errorFor: (row: string) => string | undefined;
	/** Opens Guidance at this role. */
	onOpenGuidance: () => void;
};

/**
 * A role opened under its row: one tab per agent (with Add and Remove), then
 * the selected agent's model, extra instructions, skills, profile, limits
 * and tools. Fields save on change, free text on Save.
 */
export function RoleDetail(props: RoleDetailProps) {
	const { role, agents, index, disabled, errorFor } = props;
	const copy = FS_ROLES.roles[role];
	const list = roleAgents(agents, role);
	const agent = list[index];
	const bounds = ROLE_BOUNDS[role];
	const tabbed = isListRole(role);
	const agentName = tabbed ? `${copy.tab} ${index + 1}` : copy.tab;
	const panelId = `role-${role}-panel`;
	const set = (next: FactoryAgent, row: string) =>
		props.onChange(withAgent(agents, role, index, next), row);
	const tabs = useRef<(HTMLButtonElement | null)[]>([]);
	const onTabKey = (event: KeyboardEvent) => {
		const step =
			event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
		if (!step || !list.length) return;
		event.preventDefault();
		const next = (index + step + list.length) % list.length;
		props.onSelect(next);
		tabs.current[next]?.focus();
	};
	return (
		<div
			id={`role-${role}-detail`}
			data-role-detail={role}
			className="mt-3 mb-4 rounded-lg border bg-card/40 px-3.5 pt-2.5 pb-1"
		>
			{tabbed ? (
				<div className="flex flex-wrap items-center gap-1 border-b pb-2.5">
					<div
						role="tablist"
						aria-label={FS_ROLES.agentTabs(copy.title)}
						className="flex flex-wrap items-center gap-1"
					>
						{list.map((_, i) => (
							<button
								// biome-ignore lint/suspicious/noArrayIndexKey: agents have no id; a role's list is its order.
								key={i}
								ref={(element) => {
									tabs.current[i] = element;
								}}
								type="button"
								role="tab"
								id={`role-${role}-tab-${i}`}
								aria-selected={i === index}
								aria-controls={panelId}
								tabIndex={i === index ? 0 : -1}
								onKeyDown={onTabKey}
								onClick={() => props.onSelect(i)}
								className={cn(
									"h-[26px] rounded-md px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									i === index
										? "bg-surface-hover font-medium text-foreground"
										: "text-muted-foreground hover:bg-surface-hover-lighter hover:text-foreground",
								)}
							>
								{`${copy.tab} ${i + 1}`}
							</button>
						))}
					</div>
					{list.length < bounds.max ? (
						<Button
							variant="ghost"
							size="xs"
							className="h-[26px] gap-1 px-2 text-xs text-muted-foreground"
							disabled={disabled}
							onClick={props.onAdd}
						>
							<Plus aria-hidden className="size-3.5" />
							{FS_ROLES.add(copy.one)}
						</Button>
					) : null}
					{agent && list.length > bounds.min ? (
						<div className="ml-auto">
							<ActionButton
								disabled={disabled}
								onClick={() => props.onRemove(index)}
							>
								{FS_ROLES.remove(agentName)}
							</ActionButton>
						</div>
					) : null}
				</div>
			) : null}
			{agent ? (
				<div
					id={panelId}
					{...(tabbed
						? {
								role: "tabpanel",
								"aria-labelledby": `role-${role}-tab-${index}`,
							}
						: {})}
					className="[&>[data-setting]:last-of-type]:border-b-0"
				>
					<AgentFields
						// A new agent starts with its own text fields.
						key={`${role}-${index}`}
						role={role}
						agent={agent}
						agentName={agentName}
						disabled={disabled}
						errorFor={errorFor}
						set={set}
						onOpenGuidance={props.onOpenGuidance}
					/>
					{role === "verifier" && agents.verifier ? (
						<TestSetup
							verifier={agents.verifier}
							disabled={disabled}
							error={errorFor("verifier-testSetup")}
							onSave={(verifier) =>
								props.onChange({ ...agents, verifier }, "verifier-testSetup")
							}
						/>
					) : null}
				</div>
			) : (
				<p className="py-3 text-xs text-muted-foreground">
					{role === "verifier" ? FS_ROLES.testerOff : FS_ROLES.noPlanCheckers}
				</p>
			)}
		</div>
	);
}

function AgentFields({
	role,
	agent,
	agentName,
	disabled,
	errorFor,
	set,
	onOpenGuidance,
}: {
	role: FsRoleKey;
	agent: FactoryAgent;
	agentName: string;
	disabled: boolean;
	errorFor: (row: string) => string | undefined;
	set: (agent: FactoryAgent, row: string) => void;
	onOpenGuidance: () => void;
}) {
	const copy = FS_ROLES.roles[role];
	const row = (field: string) => `${role}-${field}`;
	return (
		<>
			<SettingRow
				id={row("model")}
				title={FS_ROLES.model}
				error={errorFor(row("model"))}
				wrap
			>
				<ModelPicker
					label={FS_ROLES.modelLabel(agentName)}
					selection={agent.modelSelection}
					disabled={disabled}
					onChange={(modelSelection) =>
						set({ ...agent, modelSelection }, row("model"))
					}
				/>
			</SettingRow>
			<Instructions
				id={row("instructions")}
				guidance={copy.guidance}
				value={agent.instructions ?? ""}
				disabled={disabled}
				error={errorFor(row("instructions"))}
				onOpenGuidance={onOpenGuidance}
				onSave={(text) => {
					const { instructions: _previous, ...rest } = agent;
					set(
						text.trim() ? { ...rest, instructions: text } : rest,
						row("instructions"),
					);
				}}
			/>
			<Skills
				id={row("skills")}
				one={copy.one}
				skills={agent.skills ?? []}
				disabled={disabled}
				error={errorFor(row("skills"))}
				onChange={(skills) => {
					const { skills: _previous, ...rest } = agent;
					set(skills.length ? { ...rest, skills } : rest, row("skills"));
				}}
			/>
			<SettingRow
				id={row("profile")}
				title={FS_ROLES.profile}
				description={FS_ROLES.profileHint}
				error={errorFor(row("profile"))}
			>
				<ProfileField
					id={row("profile")}
					value={agent.profile ?? ""}
					disabled={disabled}
					onCommit={(profile) => {
						const { profile: _p, resolvedProfile: _r, ...rest } = agent;
						set(profile ? { ...rest, profile } : rest, row("profile"));
					}}
				/>
			</SettingRow>
			<SettingRow
				id={row("limits")}
				title={FS_ROLES.limits}
				description={FS_ROLES.limitsHint}
				error={errorFor(row("limits"))}
				top
			>
				<OptionalNumber
					id={row("limits")}
					label={FS_ROLES.stepsLabel(agentName)}
					value={agent.maxIterations ?? null}
					min={1}
					max={1000}
					placeholder={FS_ROLES.noStepLimit}
					disabled={disabled}
					onCommit={(maxIterations) => {
						const { maxIterations: _previous, ...rest } = agent;
						set(
							maxIterations === null ? rest : { ...rest, maxIterations },
							row("limits"),
						);
					}}
				/>
				<span className="text-xs text-muted-foreground">{FS_ROLES.steps}</span>
				<OptionalNumber
					id={row("limits")}
					label={FS_ROLES.minutesLabel(agentName)}
					value={
						agent.timeoutSeconds === undefined
							? null
							: Math.max(1, Math.round(agent.timeoutSeconds / 60))
					}
					min={1}
					max={120}
					placeholder="30"
					disabled={disabled}
					onCommit={(minutes) => {
						const { timeoutSeconds: _previous, ...rest } = agent;
						set(
							minutes === null
								? rest
								: { ...rest, timeoutSeconds: minutes * 60 },
							row("limits"),
						);
					}}
				/>
				<span className="text-xs text-muted-foreground">
					{FS_ROLES.minutes}
				</span>
			</SettingRow>
			<div className="border-b py-3" data-role-tools={role}>
				<p className="text-sm font-medium">{FS_ROLES.tools}</p>
				<p className="mt-0.5 max-w-[490px] text-xs text-muted-foreground">
					{role === "implementers"
						? FS_ROLES.toolsByRole.builder
						: role === "verifier"
							? FS_ROLES.toolsByRole.tester
							: FS_ROLES.toolsByRole.readOnly}
				</p>
			</div>
		</>
	);
}

/** Extra instructions: a text area that saves with Save, beside Cancel. */
function Instructions({
	id,
	guidance,
	value,
	disabled,
	error,
	onOpenGuidance,
	onSave,
}: {
	id: string;
	guidance: string;
	value: string;
	disabled: boolean;
	error?: string;
	onOpenGuidance: () => void;
	onSave: (text: string) => void;
}) {
	const [text, setText] = useState(value);
	// A saved value or a rollback replaces the text.
	useEffect(() => setText(value), [value]);
	const dirty = text !== value;
	return (
		<SettingRow
			id={id}
			title={FS_ROLES.instructions}
			description={
				<>
					{FS_ROLES.instructionsHintBefore(guidance)}{" "}
					<button
						type="button"
						className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onClick={onOpenGuidance}
					>
						{FS_ROLES.instructionsLink}
					</button>
					.
				</>
			}
			error={error}
			top
			wrap
		>
			<div className="flex w-[330px] max-w-full flex-col items-end gap-1.5 @max-[560px]/settings:w-full">
				<Textarea
					data-setting-control={id}
					rows={3}
					value={text}
					placeholder={FS_ROLES.instructionsPlaceholder}
					disabled={disabled}
					className="min-h-[52px] text-[13px]"
					{...rowLabels(id)}
					onChange={(event) => setText(event.target.value)}
				/>
				{dirty ? (
					<div className="flex gap-1.5">
						<ActionButton disabled={disabled} onClick={() => setText(value)}>
							{FS_ROLES.instructionsCancel}
						</ActionButton>
						<ActionButton
							primary
							disabled={disabled}
							onClick={() => onSave(text)}
						>
							{FS_ROLES.instructionsSave}
						</ActionButton>
					</div>
				) : null}
			</div>
		</SettingRow>
	);
}

/** Skills as chips: × removes one, Add opens a field (Enter adds). */
function Skills({
	id,
	one,
	skills,
	disabled,
	error,
	onChange,
}: {
	id: string;
	one: string;
	skills: readonly string[];
	disabled: boolean;
	error?: string;
	onChange: (skills: string[]) => void;
}) {
	const [adding, setAdding] = useState(false);
	const [name, setName] = useState("");
	const add = () => {
		const skill = name.trim();
		setAdding(false);
		setName("");
		if (skill && !skills.includes(skill)) onChange([...skills, skill]);
	};
	return (
		<SettingRow
			id={id}
			title={FS_ROLES.skills}
			description={FS_ROLES.skillsHint(one)}
			error={error}
			wrap
		>
			{skills.map((skill) => (
				<span
					key={skill}
					className="flex h-[26px] items-center gap-1 rounded-md border pr-1 pl-2 text-xs"
				>
					{skill}
					<button
						type="button"
						aria-label={FS_ROLES.removeSkill(skill)}
						disabled={disabled}
						className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onClick={() => onChange(skills.filter((item) => item !== skill))}
					>
						<X aria-hidden className="size-3" />
					</button>
				</span>
			))}
			{adding ? (
				<Input
					autoFocus
					aria-label={FS_ROLES.addSkillLabel}
					className="h-[26px] w-32 text-xs"
					value={name}
					disabled={disabled}
					onChange={(event) => setName(event.target.value)}
					onBlur={add}
					onKeyDown={(event) => {
						if (event.key === "Enter") add();
						if (event.key === "Escape") {
							setName("");
							setAdding(false);
						}
					}}
				/>
			) : (
				<Button
					variant="ghost"
					size="xs"
					data-setting-control={id}
					className="h-[26px] gap-1 px-2 text-xs text-muted-foreground"
					aria-describedby={`${id}-title`}
					disabled={disabled}
					onClick={() => setAdding(true)}
				>
					<Plus aria-hidden className="size-3.5" />
					{FS_ROLES.addSkill}
				</Button>
			)}
		</SettingRow>
	);
}

/** A profile name from .cline/agents; empty is none. Saves on blur or Enter. */
function ProfileField({
	id,
	value,
	disabled,
	onCommit,
}: {
	id: string;
	value: string;
	disabled: boolean;
	onCommit: (profile: string | undefined) => void;
}) {
	const [text, setText] = useState(value);
	useEffect(() => setText(value), [value]);
	const commit = () => {
		const next = text.trim();
		if (next !== value) onCommit(next || undefined);
	};
	return (
		<Input
			data-setting-control={id}
			className="h-[30px] w-44 text-[13px]"
			placeholder={FS_ROLES.profilePlaceholder}
			value={text}
			disabled={disabled}
			{...rowLabels(id)}
			onChange={(event) => setText(event.target.value)}
			onBlur={commit}
			onKeyDown={(event) => {
				if (event.key === "Enter") commit();
			}}
		/>
	);
}

/**
 * The tester's own test setup for this workflow (used instead of a
 * project's): the app environment and evidence paths, saved with Save.
 */
function TestSetup({
	verifier,
	disabled,
	error,
	onSave,
}: {
	verifier: Verifier;
	disabled: boolean;
	error?: string;
	onSave: (verifier: Verifier) => void;
}) {
	const [environment, setEnvironment] = useState<
		FactoryAppEnvironment | undefined
	>(verifier.environment);
	const [evidence, setEvidence] = useState(
		verifier.artifacts?.join(", ") ?? "",
	);
	useEffect(() => setEnvironment(verifier.environment), [verifier.environment]);
	useEffect(
		() => setEvidence(verifier.artifacts?.join(", ") ?? ""),
		[verifier.artifacts],
	);
	const artifacts = evidence
		.split(",")
		.map((path) => path.trim())
		.filter(Boolean);
	const dirty =
		JSON.stringify(environment ?? null) !==
			JSON.stringify(verifier.environment ?? null) ||
		artifacts.join(",") !== (verifier.artifacts ?? []).join(",");
	const set = Boolean(verifier.environment || verifier.artifacts?.length);
	return (
		<DisclosureRow
			id="verifier-testSetup"
			title={FS_ROLES.testSetup}
			description={FS_ROLES.testSetupHint}
			pill={
				set ? (
					<StatusPill tone="success">{FS_ROLES.testSetupSet}</StatusPill>
				) : null
			}
		>
			<div className="space-y-2.5">
				<AppEnvironmentEditor
					environment={environment}
					disabled={disabled}
					onChange={setEnvironment}
				/>
				<label htmlFor="verifier-evidence" className="block space-y-1 text-xs">
					<span>{FS_ROLES.evidence}</span>
					<Input
						id="verifier-evidence"
						value={evidence}
						placeholder={FS_ROLES.evidencePlaceholder}
						disabled={disabled}
						onChange={(event) => setEvidence(event.target.value)}
					/>
				</label>
				{error ? (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				) : null}
				{dirty ? (
					<div className="flex justify-end gap-1.5">
						<ActionButton
							disabled={disabled}
							onClick={() => {
								setEnvironment(verifier.environment);
								setEvidence(verifier.artifacts?.join(", ") ?? "");
							}}
						>
							{FS_ROLES.instructionsCancel}
						</ActionButton>
						<ActionButton
							primary
							disabled={disabled}
							onClick={() => {
								const { environment: _e, artifacts: _a, ...rest } = verifier;
								onSave({
									...rest,
									...(environment ? { environment } : {}),
									...(artifacts.length ? { artifacts } : {}),
								});
							}}
						>
							{FS_ROLES.testSetupSave}
						</ActionButton>
					</div>
				) : null}
			</div>
		</DisclosureRow>
	);
}
