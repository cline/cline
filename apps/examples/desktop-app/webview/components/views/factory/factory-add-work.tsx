"use client";

import type { FactoryTaskConfig } from "@cline/shared";
import {
	DEFAULT_FACTORY_AGENTS,
	type FactoryAgent,
} from "@cline/shared/browser";
import { FolderOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFactoryPresets } from "@/hooks/use-factory-presets";
import { desktopClient } from "@/lib/desktop-client";
import type { FactoryPreset } from "@/lib/factory-presets";
import { DEFAULT_FACTORY } from "./factory-detail";

const labelClass = "block space-y-2 text-sm font-medium";

export function AddWork({
	workspacePaths,
	onCreate,
	onExisting,
}: {
	workspacePaths: string[];
	onExisting: (taskId: string) => void;
	onCreate: (input: {
		title: string;
		request: string;
		workspaceRoot: string;
		sourceIssue?: FactoryTaskConfig["sourceIssue"];
		startScoping: boolean;
		workflow: FactoryPreset["config"];
	}) => Promise<void>;
}) {
	const [source, setSource] = useState("describe");
	const [startScoping, setStartScoping] = useState(true);
	const active = useRef(true);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	const [title, setTitle] = useState("");
	const [request, setRequest] = useState("");
	const [workspaceRoot, setWorkspaceRoot] = useState(workspacePaths[0] || "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [issueUrl, setIssueUrl] = useState("");
	const [sourceIssue, setSourceIssue] =
		useState<FactoryTaskConfig["sourceIssue"]>();
	const {
		presets,
		defaultPreset,
		loading: workflowsLoading,
		error: workflowsError,
		reload: reloadWorkflows,
	} = useFactoryPresets();
	const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
	const missingDefault =
		defaultPreset && !presets.some((preset) => preset.name === defaultPreset);
	const presetName =
		selectedPreset ??
		(defaultPreset ? (missingDefault ? null : defaultPreset) : "");
	const workflow =
		presetName === ""
			? DEFAULT_FACTORY
			: presets.find((preset) => preset.name === presetName)?.config;
	const agents = workflow?.agents ?? DEFAULT_FACTORY_AGENTS;
	return (
		<form
			className="space-y-5"
			onSubmit={(event) => {
				event.preventDefault();
				if (
					busy ||
					workflowsLoading ||
					workflowsError ||
					!workflow ||
					(source === "issue" && !sourceIssue)
				)
					return;
				setBusy(true);
				setError(null);
				void onCreate({
					title: title.trim(),
					request: request.trim(),
					workspaceRoot: workspaceRoot.trim(),
					sourceIssue: source === "issue" ? sourceIssue : undefined,
					startScoping,
					workflow,
				})
					.catch((cause: unknown) =>
						setError(
							cause instanceof Error ? cause.message : "Unable to add work.",
						),
					)
					.finally(() => setBusy(false));
			}}
		>
			<label className={labelClass} htmlFor="feature-repository">
				Repository
				<div className="flex gap-2">
					<Input
						required
						id="feature-repository"
						list="factory-workspaces"
						value={workspaceRoot}
						disabled={busy}
						onChange={(event) => {
							setWorkspaceRoot(event.target.value);
							setSourceIssue(undefined);
						}}
						placeholder="/path/to/repository"
					/>
					<Button
						type="button"
						variant="outline"
						aria-label="Choose repository"
						disabled={busy}
						onClick={() => {
							setBusy(true);
							void desktopClient
								.invoke<string | null>("pick_workspace_directory", {
									initialPath: workspaceRoot,
								})
								.then((path) => {
									if (path && active.current) {
										setWorkspaceRoot(path);
										setSourceIssue(undefined);
									}
								})
								.catch((cause: unknown) =>
									setError(
										cause instanceof Error
											? cause.message
											: "Unable to open picker. Enter a path.",
									),
								)
								.finally(() => setBusy(false));
						}}
					>
						<FolderOpen className="size-4" />
					</Button>
				</div>
				<datalist id="factory-workspaces">
					{workspacePaths.map((path) => (
						<option key={path} value={path} />
					))}
				</datalist>
			</label>
			<Tabs
				value={source}
				onValueChange={(value) => {
					setSource(value);
					setSourceIssue(undefined);
					setError(null);
				}}
			>
				<TabsList aria-label="Work source">
					<TabsTrigger value="describe" disabled={busy}>
						Describe work
					</TabsTrigger>
					<TabsTrigger value="issue" disabled={busy}>
						GitHub / Linear issue
					</TabsTrigger>
				</TabsList>
				<TabsContent value="describe" className="text-xs text-muted-foreground">
					Add a feature request, bug report, or investigation.
				</TabsContent>
				<TabsContent value="issue">
					<div className="space-y-2 rounded-lg border p-3">
						<label className={labelClass} htmlFor="feature-issue">
							Issue URL
						</label>
						<div className="flex gap-2">
							<Input
								id="feature-issue"
								type="url"
								placeholder="Paste issue URL"
								value={issueUrl}
								disabled={busy}
								onChange={(event) => {
									setIssueUrl(event.target.value);
									setSourceIssue(undefined);
								}}
							/>
							<Button
								type="button"
								variant="outline"
								disabled={busy || !issueUrl.trim() || !workspaceRoot.trim()}
								onClick={() => {
									setBusy(true);
									setError(null);
									void desktopClient
										.invoke<{
											title: string;
											description: string;
											source: NonNullable<FactoryTaskConfig["sourceIssue"]>;
											existingTaskId?: string;
										}>("factory_import_issue", {
											url: issueUrl.trim(),
											cwd: workspaceRoot.trim(),
										})
										.then((issue) => {
											if (!active.current) return;
											if (issue.existingTaskId) {
												onExisting(issue.existingTaskId);
												return;
											}
											setTitle(issue.title);
											setRequest(issue.description);
											setSourceIssue(issue.source);
										})
										.catch((cause: unknown) =>
											setError(
												cause instanceof Error
													? cause.message
													: "Unable to import issue.",
											),
										)
										.finally(() => setBusy(false));
								}}
							>
								Import
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">
							Import an issue once using your existing GitHub or Linear access.
							You can edit the request before adding it; this does not subscribe
							to future updates.
						</p>
						{sourceIssue ? (
							<output className="block text-xs text-emerald-600">
								Issue imported. Its source link will stay with this work.
							</output>
						) : null}
					</div>
				</TabsContent>
			</Tabs>
			<label className={labelClass} htmlFor="feature-name">
				Title
				<Input
					id="feature-name"
					required
					maxLength={200}
					value={title}
					disabled={busy}
					onChange={(event) => setTitle(event.target.value)}
					placeholder="Fix a bug, investigate a problem, or build something"
				/>
			</label>
			<label className={labelClass} htmlFor="feature-request">
				What needs to be done?
				<Textarea
					id="feature-request"
					required
					rows={5}
					value={request}
					disabled={busy}
					onChange={(event) => setRequest(event.target.value)}
					placeholder="Describe the problem or desired outcome. The agent can help clarify scope and checks."
				/>
			</label>

			<div className="space-y-2 rounded-lg border p-3">
				<label className={labelClass} htmlFor="feature-workflow">
					Workflow
					<select
						id="feature-workflow"
						className="h-9 w-full rounded-md border bg-background px-3 text-sm"
						disabled={busy || workflowsLoading || Boolean(workflowsError)}
						value={presetName ?? "__choose__"}
						onChange={(event) => setSelectedPreset(event.target.value)}
					>
						{presetName === null ? (
							<option value="__choose__" disabled>
								Choose a workflow…
							</option>
						) : null}
						<option value="">Basic · use feature model</option>
						{presets.map((preset) => (
							<option key={preset.name} value={preset.name}>
								{preset.name}
								{preset.name === defaultPreset ? " (default)" : ""}
							</option>
						))}
					</select>
				</label>
				{workflowsLoading ? (
					<p className="text-xs text-muted-foreground">Loading workflows…</p>
				) : workflowsError ? (
					<div role="alert" className="text-xs text-destructive">
						Unable to load workflows: {workflowsError}
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={reloadWorkflows}
						>
							Retry workflows
						</Button>
					</div>
				) : missingDefault && presetName === null ? (
					<p role="alert" className="text-xs text-destructive">
						Default workflow “{defaultPreset}” is missing or invalid. Choose a
						saved workflow or Basic before adding work.
					</p>
				) : null}
				{workflow && !workflowsLoading && !workflowsError ? (
					<dl className="space-y-1 text-xs text-muted-foreground">
						{(
							[
								["Designer", [agents.designer]],
								["Plan reviewers", agents.planReviewers],
								["Implementers", agents.implementers],
								["Verifier", agents.verifier ? [agents.verifier] : []],
								["Final reviewers", agents.reviewers],
							] satisfies [string, FactoryAgent[]][]
						).map(([label, participants]) => (
							<div key={label} className="flex gap-2">
								<dt className="font-medium">{label}:</dt>
								<dd>
									{participants.length
										? participants
												.map((agent) =>
													agent.modelSelection
														? `${agent.modelSelection.providerId} / ${agent.modelSelection.modelId}`
														: agent.profile
															? `Profile: ${agent.profile}`
															: "Feature model",
												)
												.join(" · ")
										: "None"}
								</dd>
							</div>
						))}
						<div className="flex gap-2">
							<dt className="font-medium">Plan approval:</dt>
							<dd>
								{workflow.approval === "automatic"
									? "Automatic"
									: "Required before implementation"}
							</dd>
						</div>
					</dl>
				) : null}
				<p className="text-xs text-muted-foreground">
					Manage saved presets and the default from Factory → Workflows. This
					choice is copied into this work.
				</p>
			</div>
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={startScoping}
					disabled={busy}
					onChange={(event) => setStartScoping(event.target.checked)}
				/>
				Start scoping after adding
			</label>
			<p className="text-xs text-muted-foreground">
				{startScoping
					? workflow?.approval === "automatic"
						? "An agent will scope the request. Automatic approval allows implementation once the plan and required checks are ready."
						: "An agent will read the request and ask any missing questions. Implementation waits for your plan approval."
					: "Save to Queued without starting an agent."}
			</p>
			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}
			<Button
				disabled={
					busy ||
					workflowsLoading ||
					Boolean(workflowsError) ||
					!workflow ||
					!title.trim() ||
					!request.trim() ||
					!workspaceRoot.trim() ||
					(source === "issue" && !sourceIssue)
				}
				type="submit"
				className="w-full"
			>
				{busy ? "Working…" : startScoping ? "Add and scope" : "Add to queue"}
			</Button>
		</form>
	);
}
