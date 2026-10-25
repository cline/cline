import { readCloudModelIdGlobally } from "@cline/core";
import { c, emitJsonLine, writeErr, writeln } from "../utils/output";
import {
	parseGitHubRepoArg,
	parseGitHubRepoFullName,
	readGitOriginUrl,
	readRepoStatus,
} from "../utils/repo-status";
import {
	cloudSessionUrl,
	createCliCloudSessions,
	resolveCloudModel,
} from "./interactive/cloud-sessions";

/** The Hub wraps cloud failures as `CLOUD_SESSION_ERROR:{"code","message"}`. */
function cloudErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const json = message.match(/CLOUD_SESSION_ERROR:(\{.*\})/)?.[1];
	if (!json) return message;
	try {
		return (JSON.parse(json) as { message?: string }).message ?? message;
	} catch {
		return message;
	}
}

/**
 * Cloud mode: start a new Cline Cloud session for this folder's GitHub repo
 * (or `--repo`), send the prompt, and exit once the sandbox accepts it. The
 * task keeps running in the cloud; the printed link follows it.
 */
export async function runCloud(input: {
	prompt: string;
	cwd: string;
	workspaceRoot: string;
	repo?: string;
	branch?: string;
	providerId: string;
	modelId?: string;
	outputMode: "text" | "json";
}): Promise<number> {
	const json = input.outputMode === "json";
	const fail = (message: string) => {
		writeErr(`--cloud: ${message}`);
		return 1;
	};
	let wanted: string | undefined;
	if (input.repo !== undefined) {
		wanted = parseGitHubRepoArg(input.repo);
		if (!wanted) {
			return fail(
				`--repo expects owner/name or a GitHub URL, got "${input.repo}".`,
			);
		}
	}
	const { client, dispose } = createCliCloudSessions(input.workspaceRoot);
	try {
		const origin = parseGitHubRepoFullName(await readGitOriginUrl(input.cwd));
		wanted ??= origin;
		if (!wanted) {
			return fail(
				"run it in a folder whose git origin is a GitHub repository, or pass --repo owner/name.",
			);
		}
		const listed = await client.listRepositories();
		if (!listed.connected) {
			return fail(`connect GitHub to Cline first: ${listed.connectUrl}`);
		}
		const repo = listed.repositories.find(
			(candidate) => candidate.fullName.toLowerCase() === wanted,
		);
		if (!repo) {
			return fail(
				`Cline Cloud can't access ${wanted}. Give it access: ${listed.connectUrl}`,
			);
		}
		const hasBranch = async (name: string) => {
			let cursor: string | undefined;
			do {
				const page = await client.listBranches(repo.id, {
					query: name,
					cursor,
				});
				if (page.branches.includes(name)) return true;
				cursor = page.nextToken || undefined;
			} while (cursor);
			return false;
		};
		let branch = repo.defaultBranch;
		if (input.branch !== undefined) {
			branch = input.branch.trim();
			if (!(await hasBranch(branch))) {
				return fail(`branch "${branch}" doesn't exist in ${repo.fullName}.`);
			}
		} else if (wanted === origin) {
			// Same default as the TUI picker: the local branch if GitHub has it.
			const localBranch = (await readRepoStatus(input.cwd)).branch;
			if (
				localBranch &&
				localBranch !== "HEAD" &&
				(await hasBranch(localBranch))
			) {
				branch = localBranch;
			}
		}
		const model = resolveCloudModel(await client.listModels(), {
			explicitModelId: readCloudModelIdGlobally(),
			localModelId: input.modelId,
			localProviderId: input.providerId,
		});
		if (!model) return fail("no cloud models are available for this account.");

		if (!json) {
			writeln(
				`${c.dim}[cloud]${c.reset} starting ${repo.fullName} · ${branch} on ${model.name}…`,
			);
		}
		const { sessionId } = await client.create({
			repoUrl: repo.url,
			branch,
			modelId: model.id,
			initialPrompt: input.prompt,
			mode: "act",
			autoApproveTools: true,
		});
		let unsubscribe: () => unknown = () => {};
		const accepted = new Promise<void>((resolve) => {
			unsubscribe = client.subscribe((event) => {
				if (event.sessionId === sessionId && event.type === "prompt_accepted") {
					resolve();
				}
			});
		});
		// `send` resolves only when the turn ends; acceptance is enough to exit.
		const sending = client.send(sessionId, input.prompt, undefined, model.id);
		sending.catch(() => {});
		try {
			await Promise.race([accepted, sending]);
		} finally {
			unsubscribe();
		}

		const url = cloudSessionUrl(sessionId);
		if (json) {
			emitJsonLine("stdout", {
				type: "cloud_dispatched",
				sessionId,
				url,
				repository: repo.fullName,
				branch,
				model: model.id,
			});
		} else {
			writeln(
				`${c.dim}[cloud]${c.reset} the task is running in Cline Cloud; you can close this terminal.`,
			);
			writeln(`${c.dim}[cloud]${c.reset} follow along: ${url}`);
		}
		return 0;
	} catch (error) {
		return fail(cloudErrorMessage(error));
	} finally {
		await dispose().catch(() => {});
	}
}
