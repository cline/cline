import type {
	CloudBranchListResult,
	CloudRepositoryListResult,
	CloudRepositoryOption,
} from "@cline/core/cloud";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { CliCloudRuntime } from "../../runtime/cloud/runtime";

export type CloudDraft = {
	repository?: CloudRepositoryOption;
	branch: string;
	modelId: string;
	autoApproveTools: boolean;
	prompt: string;
};
export const emptyCloudDraft = (): CloudDraft => ({
	branch: "",
	modelId: "",
	autoApproveTools: false,
	prompt: "",
});
type Choose = (
	title: string,
	items: Array<{ id: string; label: string }>,
	initial?: string,
	detail?: string,
) => Promise<string | undefined>;

/** One composer, with editable selectors, matching the desktop cloud launch flow. */
export function CloudComposer(props: {
	runtime: CliCloudRuntime;
	draft: CloudDraft;
	onChange: (draft: CloudDraft) => void;
	choose: Choose;
	chooseBranch: (
		repositoryId: number,
		initial: CloudBranchListResult,
		selected: string,
	) => Promise<string | undefined>;
	dialogOpen: boolean;
	initialBranch?: string | null;
	onClose: () => void;
}) {
	const { runtime, draft, onChange } = props;
	const [repositories, setRepositories] = useState<CloudRepositoryListResult>();
	const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
	const [branchPage, setBranchPage] = useState<CloudBranchListResult>({
		available: true,
		branches: [],
	});
	const [loading, setLoading] = useState(true);
	const [branchLoading, setBranchLoading] = useState(false);
	const [error, setError] = useState<string>();
	const [focus, setFocus] = useState(0);
	const [reload, setReload] = useState(0);
	const mounted = useRef(true);
	const latest = useRef(draft);
	latest.current = draft;
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const actionPending = useRef(false);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	useEffect(() => {
		void reload;
		let cancelled = false;
		setLoading(true);
		setError(undefined);
		void (async () => {
			const repos = await runtime.listRepositories();
			if (cancelled) return undefined;
			const choices = await runtime.models();
			return { repos, choices };
		})()
			.then((result) => {
				if (cancelled || !result) return;
				const { repos, choices } = result;
				setRepositories(repos);
				setModels(choices);
				const previous = latest.current;
				const repository = repos.repositories.find(
					(repo) => repo.url === previous.repository?.url,
				);
				onChangeRef.current({
					...previous,
					repository,
					branch: repository ? previous.branch : "",
					modelId: choices.some((model) => model.id === previous.modelId)
						? previous.modelId
						: (choices[0]?.id ?? ""),
				});
			})
			.catch((failure) => {
				if (!cancelled) setError(String(failure));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [runtime, reload]);
	const repositoryId = draft.repository?.id;
	useEffect(() => {
		void reload;
		let cancelled = false;
		setBranchPage({ available: true, branches: [] });
		if (!repositoryId || loading) {
			setBranchLoading(false);
			return;
		}
		setBranchLoading(true);
		void (async () => {
			const result = await runtime.listBranches(repositoryId);
			if (cancelled) return;
			if (!result.available || !result.branches.length)
				throw new Error("Could not load branches. Ctrl+R to retry.");
			setBranchPage(result);
			const previous = latest.current;
			const preferred = [
				previous.branch,
				props.initialBranch,
				previous.repository?.defaultBranch,
			].find(
				(branch) =>
					branch &&
					(Boolean(result.nextToken) || result.branches.includes(branch)),
			);
			onChangeRef.current({
				...previous,
				branch: preferred ?? result.branches[0],
			});
		})()
			.catch((failure) => {
				if (!cancelled) setError(String(failure));
			})
			.finally(() => {
				if (!cancelled) setBranchLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [runtime, repositoryId, props.initialBranch, reload, loading]);

	const act = async (field: number) => {
		if (actionPending.current || props.dialogOpen) return;
		if (loading) return;
		actionPending.current = true;
		setError(undefined);
		try {
			if (field === 1 && repositories?.connected === false) {
				const { default: open } = await import("../../utils/open");
				await open(repositories.connectUrl);
				return;
			}
			if (field === 2) {
				if (!draft.repository) {
					setError("Choose a repository first.");
					return;
				}
				if (branchLoading) {
					setError(
						"Branches are still loading. You can start with the default branch or choose another repository.",
					);
					return;
				}
				const selected = await props.chooseBranch(
					draft.repository.id,
					branchPage,
					draft.branch,
				);
				if (mounted.current && selected) {
					onChange({ ...latest.current, branch: selected });
					setFocus(0);
				}
				return;
			}
			if (field === 1 || field === 3) {
				const selected = await props.choose(
					field === 1 ? "Cloud repository" : "Cloud model",
					field === 1
						? (repositories?.repositories ?? []).map((repo) => ({
								id: repo.url,
								label: repo.fullName,
							}))
						: models.map((model) => ({ id: model.id, label: model.name })),
					field === 1 ? draft.repository?.url : draft.modelId,
				);
				if (!mounted.current || !selected) return;
				onChange({
					...latest.current,
					...(field === 1
						? {
								repository: repositories?.repositories.find(
									(repo) => repo.url === selected,
								),
								branch:
									repositories?.repositories.find(
										(repo) => repo.url === selected,
									)?.defaultBranch ?? "",
							}
						: { modelId: selected }),
				});
				setFocus(0);
				return;
			}
			if (field === 4) {
				onChange({ ...draft, autoApproveTools: !draft.autoApproveTools });
				return;
			}
			if (!draft.repository) {
				setError("Choose a repository to start.");
				setFocus(1);
				return;
			}
			if (!draft.branch || !draft.modelId || !draft.prompt.trim()) {
				setError("Choose a branch and model, then describe your task.");
				setFocus(0);
				return;
			}
			// Enter/Start is the submission. The runtime validates the current account and rollout.
			void runtime
				.create({
					repoUrl: draft.repository.url,
					branch: draft.branch,
					modelId: draft.modelId,
					prompt: draft.prompt,
					autoApproveTools: draft.autoApproveTools,
				})
				.catch((failure) => {
					if (mounted.current) setError(String(failure));
				});
		} catch (failure) {
			if (mounted.current) setError(String(failure));
		} finally {
			actionPending.current = false;
		}
	};
	useKeyboard((key) => {
		if (props.dialogOpen) return;
		if (key.name === "escape") {
			key.preventDefault();
			props.onClose();
			return;
		}
		if (key.ctrl && key.name === "r") {
			key.preventDefault();
			setReload((value) => value + 1);
			return;
		}
		if (key.name === "tab") {
			key.preventDefault();
			setFocus((value) => (value + (key.shift ? 5 : 1)) % 6);
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			key.preventDefault();
			void act(focus);
		}
	});
	const labels = [
		`Repository: ${repositories?.connected === false ? "Connect GitHub" : (draft.repository?.fullName ?? "Select repository…")}`,
		`Branch: ${draft.branch || (branchLoading ? "Loading…" : draft.repository ? "Choose a branch" : "Select a repository first")}`,
		`Model: ${models.find((model) => model.id === draft.modelId)?.name ?? "Loading…"}`,
		`Tools: ${draft.autoApproveTools ? "Auto-approve" : "Manual approval"}`,
		"Start cloud task",
	];
	return (
		<box flexDirection="column" flexGrow={1} gap={1}>
			<text fg="cyan">New cloud task</text>
			<text>What would you like to build?</text>
			<box
				border
				borderColor={focus === 0 ? "cyan" : "gray"}
				paddingX={1}
				height={3}
			>
				<input
					focused={focus === 0 && !props.dialogOpen}
					value={draft.prompt}
					onInput={(prompt) => onChange({ ...draft, prompt })}
					placeholder="Describe your cloud task…"
				/>
			</box>
			{labels.map((label, index) => (
				// biome-ignore lint/a11y/noStaticElementInteractions: Terminal controls support Tab/Enter and mouse.
				<text
					key={["repository", "branch", "model", "policy", "start"][index]}
					fg={focus === index + 1 ? "cyan" : undefined}
					onMouseDown={() => {
						setFocus(index + 1);
						void act(index + 1);
					}}
				>
					{focus === index + 1 ? "› " : "  "}
					{label}
				</text>
			))}
			{loading && <text fg="gray">Loading cloud setup…</text>}
			{repositories?.connected === false && (
				<text>
					Connect GitHub using the repository control, then Ctrl+R to refresh.
				</text>
			)}
			{repositories?.connected && !repositories.repositories.length && (
				<text>
					No accessible repositories. Update GitHub access, then Ctrl+R to
					refresh.
				</text>
			)}
			{error && <text fg="yellow">{error}</text>}
			<text fg="gray">
				Tab select control · Enter choose / start · Esc tasks
			</text>
			<text fg="gray">
				Runs in the cloud from your repository. Local uncommitted files are not
				uploaded.
			</text>
		</box>
	);
}
