"use client";

import type { FactoryCheck, FactoryTaskConfig } from "@cline/shared";
import type { Dispatch, SetStateAction } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { serializeAttachments } from "@/hooks/chat-session/attachments";
import { FactoryWorkflowEditor } from "./factory-workflow-editor";

const labelClass = "block space-y-2 text-sm font-medium";
const selectClass =
	"h-9 rounded-md border border-input bg-background px-3 text-sm";

export function FactoryDetailConfiguration({
	config,
	disabled,
	setConfig,
	perform,
}: {
	config: FactoryTaskConfig;
	disabled: boolean;
	setConfig: Dispatch<SetStateAction<FactoryTaskConfig>>;
	perform: (action: () => Promise<void>) => Promise<void>;
}) {
	return (
		<details className="space-y-4 rounded-lg border p-4">
			<summary className="cursor-pointer text-sm font-medium">
				Configuration
			</summary>

			<label className={labelClass} htmlFor="feature-documents">
				Reference docs
				<Input
					id="feature-documents"
					type="file"
					accept=".md,.markdown,.txt,text/plain,text/markdown"
					multiple
					disabled={disabled}
					onChange={(event) => {
						const files = Array.from(event.target.files ?? []);
						event.target.value = "";
						void perform(async () => {
							if (
								files.some(
									(file) =>
										!/\.(md|markdown|txt)$/i.test(file.name) ||
										file.size > 100_000,
								)
							)
								throw new Error(
									"Use Markdown or text files up to 100 KB each.",
								);
							if ((config.documents?.length ?? 0) + files.length > 10)
								throw new Error("Attach up to 10 reference docs.");
							const attachments = await serializeAttachments(files);
							setConfig((current) => ({
								...current,
								documents: [
									...(current.documents ?? []),
									...attachments.userFiles,
								],
							}));
						});
					}}
				/>
			</label>
			{config.documents?.map((doc, index) => (
				<div
					key={`${doc.name}-${index}`}
					className="flex items-center justify-between rounded border px-3 py-1 text-xs"
				>
					<span>{doc.name}</span>
					<Button
						size="icon"
						variant="ghost"
						aria-label={`Remove ${doc.name}`}
						disabled={disabled}
						onClick={() =>
							setConfig({
								...config,
								documents: config.documents?.filter((_, i) => i !== index),
							})
						}
					>
						<X className="size-3" />
					</Button>
				</div>
			))}
			<FactoryWorkflowEditor
				config={config}
				disabled={disabled}
				onChange={setConfig}
			/>
			<section className="space-y-3">
				<div className="flex items-center justify-between">
					<h3 className="text-sm font-semibold">
						Required checks and evidence
					</h3>
					<Button
						variant="ghost"
						size="sm"
						disabled={disabled}
						onClick={() =>
							setConfig({
								...config,
								checks: [
									...config.checks,
									{ name: "", command: "", kind: "test", artifacts: [] },
								],
							})
						}
					>
						<Plus className="mr-1 size-3" />
						Add check
					</Button>
				</div>
				<p className="text-xs leading-5 text-muted-foreground">
					Commands run in the feature worktree. For UI changes, require
					screenshots or recordings; for backend changes, include route/API or
					end-to-end tests. Artifact paths are relative to the worktree.
				</p>
				{config.checks.map((check, index) => (
					<CheckEditor
						key={index}
						check={check}
						disabled={disabled}
						onChange={(next) =>
							setConfig({
								...config,
								checks: config.checks.map((item, i) =>
									i === index ? next : item,
								),
							})
						}
						onRemove={() =>
							setConfig({
								...config,
								checks: config.checks.filter((_, i) => i !== index),
							})
						}
					/>
				))}
				{config.checks.length === 0 ? (
					<p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
						Add at least one concrete verification command before approval.
					</p>
				) : null}
			</section>
			<div className={labelClass}>
				Execution<p className="pt-2 text-sm font-normal">Local</p>
				<p className="text-xs font-normal text-muted-foreground">
					Cloud runner not connected yet.
				</p>
			</div>
			<label className="flex items-start gap-2 text-sm">
				<input
					type="checkbox"
					className="mt-1"
					disabled={disabled}
					checked={config.publishPullRequest}
					onChange={(event) =>
						setConfig({
							...config,
							publishPullRequest: event.target.checked,
						})
					}
				/>
				<span>
					Publish a draft PR after deterministic checks pass
					<span className="mt-1 block text-xs text-muted-foreground">
						Independent reviews and verification may continue after the draft is
						created. Off: retain changes on the local feature branch for
						inspection.
					</span>
				</span>
			</label>
			{config.publishPullRequest ? (
				<label className="flex items-start gap-2 text-sm">
					<input
						type="checkbox"
						className="mt-1"
						disabled={disabled}
						checked={config.watchPullRequest ?? false}
						onChange={(event) =>
							setConfig({
								...config,
								watchPullRequest: event.target.checked,
							})
						}
					/>
					<span>
						Babysit the PR after publishing
						<span className="mt-1 block text-xs text-muted-foreground">
							Watch CI and review comments, repair within the round limit, and
							reply after verification. You decide when to merge.
						</span>
					</span>
				</label>
			) : null}
		</details>
	);
}

function CheckEditor({
	check,
	disabled,
	onChange,
	onRemove,
}: {
	check: FactoryCheck;
	disabled: boolean;
	onChange: (check: FactoryCheck) => void;
	onRemove: () => void;
}) {
	return (
		<div className="space-y-2 rounded-lg border p-3">
			<div className="flex gap-2">
				<Input
					aria-label="Check name"
					placeholder="API integration tests"
					value={check.name}
					disabled={disabled}
					onChange={(event) => onChange({ ...check, name: event.target.value })}
				/>
				<select
					aria-label="Check type"
					className={selectClass}
					value={check.kind}
					disabled={disabled}
					onChange={(event) => {
						const kind = event.target.value;
						if (kind === "test" || kind === "api" || kind === "ui")
							onChange({ ...check, kind });
					}}
				>
					<option value="test">Tests</option>
					<option value="api">API / E2E</option>
					<option value="ui">UI</option>
				</select>
				<Button
					size="icon"
					variant="ghost"
					aria-label="Remove check"
					disabled={disabled}
					onClick={onRemove}
				>
					<X className="size-4" />
				</Button>
			</div>
			<Input
				aria-label="Check command"
				className="font-mono text-xs"
				placeholder="bun run test:api"
				value={check.command}
				disabled={disabled}
				onChange={(event) =>
					onChange({ ...check, command: event.target.value })
				}
			/>
			<Input
				aria-label="Required evidence paths"
				className="text-xs"
				placeholder="Required artifacts, separated by commas: evidence/export.png"
				value={check.artifacts.join(", ")}
				disabled={disabled}
				onChange={(event) =>
					onChange({
						...check,
						artifacts: event.target.value
							.split(",")
							.map((path) => path.trim())
							.filter(Boolean),
					})
				}
			/>
		</div>
	);
}
