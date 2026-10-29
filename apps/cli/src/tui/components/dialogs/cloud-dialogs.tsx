import type {
	CloudBranchListOptions,
	CloudBranchListResult,
	CloudModel,
	CloudRepositoryOption,
} from "@cline/core/cloud";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import { useEffect, useMemo, useState } from "react";
import { useDialogPalette } from "../../hooks/use-theme";
import { ProviderRow } from "../model-selector/provider-row";
import {
	type SearchableItem,
	SearchableList,
	useSearchableList,
} from "../searchable-list";

export type CloudSetupStage = "sign_in" | "github" | "no_repos";
export type CloudSetupAction = "sign_in" | "connect" | "check" | "local";

const SETUP_OPTIONS: Record<
	CloudSetupStage,
	{ value: CloudSetupAction; label: string }[]
> = {
	sign_in: [
		{ value: "sign_in", label: "Sign in to Cline" },
		{ value: "local", label: "Stay local" },
	],
	github: [
		{ value: "connect", label: "Connect GitHub (opens your browser)" },
		{ value: "check", label: "I've done this, check again" },
		{ value: "local", label: "Stay local" },
	],
	no_repos: [
		{
			value: "connect",
			label: "Manage repository access (opens your browser)",
		},
		{ value: "check", label: "I've done this, check again" },
		{ value: "local", label: "Stay local" },
	],
};

export function CloudSetupContent(
	props: ChoiceContext<CloudSetupAction> & {
		stage: CloudSetupStage;
		connectUrl?: string;
		waiting?: boolean;
	},
) {
	const { resolve, dismiss, dialogId, stage, connectUrl, waiting } = props;
	const palette = useDialogPalette();
	const options = SETUP_OPTIONS[stage];
	const [selected, setSelected] = useState(
		waiting ? options.findIndex((option) => option.value === "check") : 0,
	);

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			const option = options[selected];
			if (option) resolve(option.value);
			return;
		}
		if (key.name === "up" || (key.ctrl && key.name === "p")) {
			setSelected((s) => (s <= 0 ? options.length - 1 : s - 1));
			return;
		}
		if (key.name === "down" || (key.ctrl && key.name === "n")) {
			setSelected((s) => (s >= options.length - 1 ? 0 : s + 1));
		}
	}, dialogId);

	const steps = [
		{
			label: "Sign in to Cline",
			done: stage !== "sign_in",
			current: stage === "sign_in",
		},
		{
			label:
				stage === "no_repos"
					? "Give Cline access to a repository"
					: "Connect GitHub",
			done: false,
			current: stage !== "sign_in",
		},
		{ label: "Pick a repository and branch", done: false, current: false },
	];

	return (
		<box flexDirection="column" paddingX={1} gap={1}>
			<text fg={palette.act}>
				<strong>Run Cline in the cloud</strong>
			</text>
			<text fg="gray">
				Cline works on a GitHub repository in an isolated sandbox and keeps
				going after you close the terminal.
			</text>
			<box flexDirection="column">
				{steps.map((step, index) => (
					<text key={step.label} fg={step.current ? undefined : "gray"}>
						<span
							fg={
								step.done
									? palette.success
									: step.current
										? palette.act
										: "gray"
							}
						>
							{step.done ? "✓" : String(index + 1)}
						</span>{" "}
						{step.current ? <strong>{step.label}</strong> : step.label}
					</text>
				))}
			</box>
			<box flexDirection="column">
				{options.map((option, index) => (
					<box
						key={option.value}
						paddingX={1}
						flexDirection="row"
						gap={1}
						backgroundColor={index === selected ? palette.selection : undefined}
					>
						<text
							fg={index === selected ? palette.textOnSelection : "gray"}
							flexShrink={0}
						>
							{index === selected ? "❯" : " "}
						</text>
						<text fg={index === selected ? palette.textOnSelection : undefined}>
							{option.label}
						</text>
					</box>
				))}
			</box>
			{waiting && connectUrl && (
				<box flexDirection="column">
					<text fg="gray">
						Finish in your browser, then choose "I've done this, check again".
					</text>
					<text fg={palette.act} selectable>
						<a href={connectUrl}>{connectUrl}</a>
					</text>
				</box>
			)}
			<text fg="gray">↑/↓ navigate, Enter to select, Esc to stay local</text>
		</box>
	);
}

export interface CloudRepoSelection {
	repo: CloudRepositoryOption;
	branch: string;
}

function orderBranches(
	branches: string[],
	defaultBranch: string,
	localBranch: string | null | undefined,
): SearchableItem[] {
	const pinned = [defaultBranch, localBranch].filter(
		(name, index, all): name is string =>
			!!name && branches.includes(name) && all.indexOf(name) === index,
	);
	return [...pinned, ...branches.filter((name) => !pinned.includes(name))].map(
		(name) => ({
			key: name,
			label: name,
			detail:
				[
					name === defaultBranch ? "default" : "",
					name === localBranch ? "current here" : "",
				]
					.filter(Boolean)
					.join(" · ") || undefined,
		}),
	);
}

export function CloudRepoPickerContent(
	props: ChoiceContext<CloudRepoSelection> & {
		repositories: CloudRepositoryOption[];
		listBranches: (
			repositoryId: number,
			options?: CloudBranchListOptions,
		) => Promise<CloudBranchListResult>;
		initial?: CloudRepoSelection;
		originFullName?: string;
		localBranch?: string | null;
	},
) {
	const { resolve, dismiss, dialogId, listBranches, initial, localBranch } =
		props;
	const palette = useDialogPalette();
	const repositories = useMemo(() => {
		const isOrigin = (repo: CloudRepositoryOption) =>
			repo.fullName.toLowerCase() === props.originFullName;
		return [
			...props.repositories.filter(isOrigin),
			...props.repositories.filter((repo) => !isOrigin(repo)),
		];
	}, [props.repositories, props.originFullName]);
	const [repo, setRepo] = useState<CloudRepositoryOption | undefined>(
		() =>
			repositories.find((r) => r.id === initial?.repo.id) ??
			(repositories[0]?.fullName.toLowerCase() === props.originFullName
				? repositories[0]
				: undefined),
	);
	const [mode, setMode] = useState<"branches" | "repos">(
		repo ? "branches" : "repos",
	);
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState(0);
	const [branches, setBranches] = useState<string[]>([]);
	const [loadingBranches, setLoadingBranches] = useState(false);
	const [branchError, setBranchError] = useState("");
	const branchQuery = mode === "branches" ? search.trim() : "";

	useEffect(() => {
		if (!repo) return;
		let cancelled = false;
		setLoadingBranches(true);
		setBranchError("");
		const timer = setTimeout(
			() => {
				listBranches(repo.id, branchQuery ? { query: branchQuery } : undefined)
					.then((result) => {
						if (!cancelled) setBranches(result.branches);
					})
					.catch((error: unknown) => {
						if (cancelled) return;
						setBranches([]);
						setBranchError(
							error instanceof Error ? error.message : String(error),
						);
					})
					.finally(() => {
						if (!cancelled) setLoadingBranches(false);
					});
			},
			branchQuery ? 250 : 0,
		);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [listBranches, repo, branchQuery]);

	const branchItems = useMemo(
		() =>
			repo ? orderBranches(branches, repo.defaultBranch, localBranch) : [],
		[branches, repo, localBranch],
	);

	useEffect(() => {
		if (branchQuery || !repo) return;
		const preferred =
			(initial?.repo.id === repo.id ? initial.branch : undefined) ??
			(localBranch && branches.includes(localBranch)
				? localBranch
				: repo.defaultBranch);
		setSelected(
			Math.max(
				0,
				branchItems.findIndex((item) => item.key === preferred),
			),
		);
	}, [branchItems, branchQuery, branches, initial, localBranch, repo]);

	const repoItems = useMemo<SearchableItem[]>(() => {
		const query = search.trim().toLowerCase();
		return repositories
			.filter((r) => !query || r.fullName.toLowerCase().includes(query))
			.map((r) => ({
				key: String(r.id),
				label: r.fullName,
				detail:
					r.fullName.toLowerCase() === props.originFullName
						? "this folder's origin"
						: undefined,
			}));
	}, [repositories, search, props.originFullName]);

	const items = mode === "repos" ? repoItems : branchItems;
	const safeSelected = Math.min(selected, Math.max(0, items.length - 1));

	const switchMode = (next: "branches" | "repos") => {
		setMode(next);
		setSearch("");
		setSelected(0);
	};

	const choose = (item: SearchableItem | undefined) => {
		if (mode === "repos") {
			const next = repositories.find((r) => String(r.id) === item?.key);
			if (!next) return;
			if (next.id !== repo?.id) setBranches([]);
			setRepo(next);
			switchMode("branches");
			return;
		}
		// Only a finished result for the current search can be confirmed.
		if (repo && item && !loadingBranches) resolve({ repo, branch: item.key });
	};

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			choose(items[safeSelected]);
			return;
		}
		if (key.name === "tab") {
			if (mode === "branches") switchMode("repos");
			else if (repo) switchMode("branches");
			return;
		}
		if (key.name === "up" || (key.ctrl && key.name === "p")) {
			setSelected((s) => (s <= 0 ? Math.max(0, items.length - 1) : s - 1));
			return;
		}
		if (key.name === "down" || (key.ctrl && key.name === "n")) {
			setSelected((s) => (s >= items.length - 1 ? 0 : s + 1));
		}
	}, dialogId);

	return (
		<box flexDirection="column" gap={1}>
			<text>Run in Cline Cloud</text>
			<box paddingX={1}>
				{mode === "branches" && repo ? (
					<text>
						<span fg={palette.act}>Repository:</span> {repo.fullName}
						<span fg="gray"> (tab to change repository)</span>
					</text>
				) : (
					<text>
						<span fg={palette.act}>Choose a repository</span>
						{repo && <span fg="gray"> (tab to go back to branches)</span>}
					</text>
				)}
			</box>
			<SearchableList
				key={mode}
				items={items}
				selected={safeSelected}
				placeholder={
					mode === "repos" ? "Search repositories..." : "Search branches..."
				}
				onSearchChange={(value) => {
					setSearch(value);
					setSelected(0);
				}}
				onItemSelect={choose}
				emptyText={
					mode === "repos"
						? "No repositories match"
						: loadingBranches
							? "Loading branches..."
							: branchError || "No branches found"
				}
			/>
			<text fg="gray">
				{mode === "repos"
					? `GitHub connected · ${repositories.length} ${repositories.length === 1 ? "repository" : "repositories"} accessible`
					: "Cline works on a new branch made from this one."}
			</text>
			<text fg="gray">
				Type to search, ↑/↓ navigate, Enter to select, Tab to{" "}
				{mode === "repos" ? "pick a branch" : "change repository"}, Esc to close
			</text>
		</box>
	);
}

/** The same billing catalogs and names as the desktop app's cloud model picker. */
export const CLOUD_MODEL_PROVIDERS: {
	id: CloudModel["catalogId"];
	name: string;
}[] = [
	{ id: "cline-pass", name: "ClinePass" },
	{ id: "cline", name: "Cline Usage-Billing" },
	{ id: "cline-cloud", name: "ClineFree" },
];

/** ClinePass/ClineFree names are raw `cline-pass/...` ids; drop the catalog prefix. */
export function cloudModelLabel(model: CloudModel): string {
	return model.name.replace(/^cline-(pass|cloud)\//, "");
}

/** Status bar form, matching the local "ClinePass: model" display. */
export function cloudModelStatusName(model: CloudModel): string {
	if (model.catalogId === "cline") return model.name;
	const provider = CLOUD_MODEL_PROVIDERS.find((p) => p.id === model.catalogId);
	return `${provider?.name ?? "Cline"}: ${cloudModelLabel(model)}`;
}

export function CloudModelPickerContent(
	props: ChoiceContext<CloudModel> & {
		models: CloudModel[];
		currentModelId?: string;
	},
) {
	const { resolve, dismiss, dialogId, models, currentModelId } = props;
	const palette = useDialogPalette();
	const providers = useMemo(
		() =>
			CLOUD_MODEL_PROVIDERS.filter((provider) =>
				models.some((model) => model.catalogId === provider.id),
			),
		[models],
	);
	const currentProviderId = models.find(
		(model) => model.id === currentModelId,
	)?.catalogId;
	const [providerId, setProviderId] = useState(
		() => currentProviderId ?? providers[0]?.id,
	);
	const [choosingProvider, setChoosingProvider] = useState(false);
	const [providerSelected, setProviderSelected] = useState(0);
	const items = useMemo<SearchableItem[]>(
		() =>
			models
				.filter((model) => model.catalogId === providerId)
				.map((model) => ({
					key: model.id,
					label: cloudModelLabel(model),
					detail: model.id === currentModelId ? "(current)" : undefined,
					searchText: model.id,
				})),
		[models, providerId, currentModelId],
	);
	const list = useSearchableList(items);
	const { setSelected } = list;

	useEffect(() => {
		setSelected(
			Math.max(
				0,
				items.findIndex((item) => item.key === currentModelId),
			),
		);
	}, [items, currentModelId, setSelected]);

	const choose = (item: SearchableItem | undefined) => {
		const model = models.find((candidate) => candidate.id === item?.key);
		if (model) resolve(model);
	};

	const openProviders = () => {
		setProviderSelected(
			Math.max(
				0,
				providers.findIndex((provider) => provider.id === providerId),
			),
		);
		setChoosingProvider(true);
	};

	// The search input is recreated when the model list returns, so clear its filter too.
	const closeProviders = () => {
		list.setSearch("");
		setChoosingProvider(false);
	};

	const chooseProvider = (index: number) => {
		const provider = providers[index];
		if (!provider) return;
		setProviderId(provider.id);
		closeProviders();
	};

	useDialogKeyboard((key) => {
		if (choosingProvider) {
			if (key.name === "escape" || key.name === "tab") {
				closeProviders();
				return;
			}
			if (key.name === "return" || key.name === "enter") {
				chooseProvider(providerSelected);
				return;
			}
			if (key.name === "up" || (key.ctrl && key.name === "p")) {
				setProviderSelected((s) => (s <= 0 ? providers.length - 1 : s - 1));
				return;
			}
			if (key.name === "down" || (key.ctrl && key.name === "n")) {
				setProviderSelected((s) => (s >= providers.length - 1 ? 0 : s + 1));
			}
			return;
		}
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "tab" && providers.length > 1) {
			openProviders();
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			choose(list.selectedItem);
			return;
		}
		if (key.name === "up" || (key.ctrl && key.name === "p")) {
			list.moveUp();
			return;
		}
		if (key.name === "down" || (key.ctrl && key.name === "n")) {
			list.moveDown();
		}
	}, dialogId);

	if (choosingProvider) {
		return (
			<box flexDirection="column" gap={1}>
				<text>Select Cloud Provider</text>
				<box flexDirection="column">
					{providers.map((provider, index) => {
						const isSel = index === providerSelected;
						const count = models.filter(
							(model) => model.catalogId === provider.id,
						).length;
						return (
							<box
								key={provider.id}
								paddingX={1}
								flexDirection="row"
								gap={1}
								backgroundColor={isSel ? palette.selection : undefined}
								onMouseDown={() => chooseProvider(index)}
							>
								<text
									fg={isSel ? palette.textOnSelection : "gray"}
									flexShrink={0}
								>
									{isSel ? "❯" : " "}
								</text>
								<text fg={isSel ? palette.textOnSelection : undefined}>
									{provider.name}
								</text>
								<text fg={isSel ? palette.textOnSelection : "gray"}>
									{count} {count === 1 ? "model" : "models"}
								</text>
								{provider.id === currentProviderId && (
									<text fg={isSel ? palette.textOnSelection : palette.success}>
										(current)
									</text>
								)}
							</box>
						);
					})}
				</box>
				<text fg="gray">↑/↓ navigate, Enter to select, Esc to go back</text>
			</box>
		);
	}

	return (
		<box flexDirection="column" gap={1}>
			<text>Select Cloud Model</text>
			<ProviderRow
				providerName={
					providers.find((provider) => provider.id === providerId)?.name ??
					"Cline"
				}
				focused={false}
			/>
			<SearchableList
				key={providerId}
				items={list.filtered}
				selected={list.safeSelected}
				placeholder="Search models..."
				onSearchChange={list.setSearch}
				onItemSelect={choose}
				emptyText="No models match"
			/>
			<text fg="gray">
				Type to search, ↑/↓ navigate, Enter to select, Tab to change provider,
				Esc to close
			</text>
		</box>
	);
}
