import { realpath } from "node:fs/promises";
import {
	FACTORY_REVIEW_HIDDEN_CHARACTERS,
	type FactoryPullRequestReference,
} from "@cline/shared";
import { z } from "zod";
import { FactoryDecisionError } from "./factory-errors";
import { runFactoryCommand } from "./factory-local";

/*
 * Engine-verified facts about a pull request Factory is asked to review.
 * Everything read from GitHub about the PR (title, refs, file paths, logins)
 * is untrusted: it is bounded, stripped of control characters and only ever
 * passed to commands as argument array entries. Nothing here checks out or
 * runs code from the PR.
 *
 * The route contract does not exist in @cline/shared yet, so the types below
 * are local; move them there with the route schema.
 */

type Command = typeof runFactoryCommand;

/** GitHub's author association values; anything else is read as `NONE`. */
export const FACTORY_REVIEW_AUTHOR_ASSOCIATIONS = [
	"OWNER",
	"MEMBER",
	"COLLABORATOR",
	"CONTRIBUTOR",
	"FIRST_TIME_CONTRIBUTOR",
	"FIRST_TIMER",
	"MANNEQUIN",
	"NONE",
] as const;
export type FactoryReviewAuthorAssociation =
	(typeof FACTORY_REVIEW_AUTHOR_ASSOCIATIONS)[number];

export interface FactoryReviewFile {
	path: string;
	additions: number;
	deletions: number;
}

export interface FactoryReviewInput {
	repository: {
		/** GitHub host, `github.com` unless the origin is an Enterprise server. */
		host: string;
		owner: string;
		name: string;
	};
	number: number;
	url: string;
	title: string;
	state: "OPEN" | "CLOSED" | "MERGED";
	author: { login: string; association: FactoryReviewAuthorAssociation };
	isCrossRepository: boolean;
	isDraft: boolean;
	baseRefName: string;
	baseSha: string;
	headRefName: string;
	headSha: string;
	files: FactoryReviewFile[];
	additions: number;
	deletions: number;
	changedFiles: number;
	/** The signed-in GitHub user. */
	viewerLogin: string;
}

/**
 * The PR cannot be reviewed from this checkout for a reason only a person
 * can fix (wrong repository, gh missing or signed out, PR not found). The
 * message is one sentence. Transient failures stay plain errors.
 */
export class FactoryReviewInputError extends FactoryDecisionError {
	override name = "FactoryReviewInputError";
}

const MAX_TITLE = 300;
const MAX_REF = 255;
const MAX_PATH = 1024;
const MAX_FILES = 3000;

/** Untrusted single-line text: hidden characters removed, bounded. */
export function factoryReviewUntrustedText(value: string, max: number): string {
	const flat = value
		.replace(FACTORY_REVIEW_HIDDEN_CHARACTERS, " ")
		.replace(/\s+/g, " ")
		.trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A repository path from the PR: hidden characters removed, bounded. */
function untrustedPath(value: string): string {
	const clean = value
		.replace(FACTORY_REVIEW_HIDDEN_CHARACTERS, "")
		.replace(/[\t\n]/g, "");
	return clean.length > MAX_PATH ? clean.slice(0, MAX_PATH) : clean;
}

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;
const SEGMENT = /^[\w.-]{1,100}$/;
const HOST = /^[A-Za-z0-9.-]{1,253}(?::\d{1,5})?$/;

interface RepositoryIdentity {
	host: string;
	owner: string;
	name: string;
}

const sameRepository = (a: RepositoryIdentity, b: RepositoryIdentity) =>
	a.host.toLowerCase() === b.host.toLowerCase() &&
	a.owner.toLowerCase() === b.owner.toLowerCase() &&
	a.name.toLowerCase() === b.name.toLowerCase();

/** `gh`'s arguments selecting `host`: none for github.com. */
export const factoryGhHostArgs = (host: string) =>
	host === "github.com" ? [] : ["--hostname", host];

const repositoryLabel = (repo: RepositoryIdentity) =>
	`${repo.host === "github.com" ? "" : `${repo.host}/`}${repo.owner}/${repo.name}`;

function identity(
	host: string | undefined,
	owner: string | undefined,
	name: string | undefined,
): RepositoryIdentity | undefined {
	const repo = name?.replace(/\.git$/i, "");
	if (!host || !owner || !repo) return undefined;
	if (!HOST.test(host) || !SEGMENT.test(owner) || !SEGMENT.test(repo))
		return undefined;
	if (repo === "." || repo === "..") return undefined;
	return { host: host.toLowerCase(), owner, name: repo };
}

/**
 * The GitHub repository a remote URL points at: https (with or without
 * credentials), scp-like `git@host:owner/name`, or `ssh://`. Undefined for
 * anything else. The URL itself is never echoed, since it may hold a token.
 */
export function parseFactoryGitHubRemote(
	url: string,
): RepositoryIdentity | undefined {
	const text = url.trim();
	const scp = /^[\w.-]+@([\w.-]+):\/?([^/\s]+)\/([^/\s]+?)\/?$/.exec(text);
	if (scp) return identity(scp[1], scp[2], scp[3]);
	const full =
		/^(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?([\w.-]+)(?::\d+)?\/([^/\s]+)\/([^/\s]+?)\/?$/.exec(
			text,
		);
	if (full) return identity(full[1], full[2], full[3]);
	return undefined;
}

/**
 * A pull request as a number, `#n`, `owner/name#n` (on github.com) or a
 * pull request URL. Throws a {@link FactoryReviewInputError} otherwise.
 */
export function parseFactoryPullRequestReference(
	pullRequest: number | string,
): {
	number: number;
	repository?: RepositoryIdentity;
} {
	if (typeof pullRequest === "number") {
		if (Number.isSafeInteger(pullRequest) && pullRequest > 0)
			return { number: pullRequest };
	} else {
		const text = pullRequest.trim();
		if (/^#?[1-9]\d{0,9}$/.test(text))
			return { number: Number(text.replace("#", "")) };
		const short = /^([^/\s#]+)\/([^/\s#]+)#([1-9]\d{0,9})$/.exec(text);
		const named = identity("github.com", short?.[1], short?.[2]);
		if (short && named) return { number: Number(short[3]), repository: named };
		const match =
			/^https:\/\/([\w.-]+)\/([^/\s]+)\/([^/\s]+)\/pull\/([1-9]\d{0,9})(?:[/?#]\S*)?$/.exec(
				text,
			);
		const repository = identity(match?.[1], match?.[2], match?.[3]);
		if (match && repository) return { number: Number(match[4]), repository };
	}
	throw new FactoryReviewInputError(
		"Give the pull request as a number, owner/repo#number or a pull request URL.",
	);
}

/** One sentence of a command's output, safe to show. */
function firstLine(output: string): string {
	return factoryReviewUntrustedText(
		output.split("\n").find((line) => line.trim()) ?? "no output",
		200,
	);
}

async function invoke(
	run: Command,
	input: Parameters<Command>[0],
): Promise<Awaited<ReturnType<Command>>> {
	try {
		return await run(input);
	} catch (error) {
		input.signal?.throwIfAborted();
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			throw new FactoryReviewInputError(
				input.file === "gh"
					? "The GitHub CLI (gh) is not installed; install it from https://cli.github.com, then try again."
					: "Git is not installed or not on PATH; install it, then try again.",
			);
		throw error;
	}
}

const SIGNED_OUT = /auth login|not logged in|authentication required|HTTP 401/i;
const NOT_FOUND = /could not resolve to a pullrequest|not found|HTTP 404/i;

async function ghJson<T extends z.ZodType>(
	run: Command,
	cwd: string,
	args: string[],
	schema: T,
	what: string,
	signal: AbortSignal | undefined,
): Promise<z.infer<T>> {
	const result = await invoke(run, {
		cwd,
		file: "gh",
		args,
		signal,
		maxBytes: 4 * 1024 * 1024,
		captureStdout: true,
	});
	if (result.exitCode !== 0 || result.timedOut) {
		if (SIGNED_OUT.test(result.output))
			throw new FactoryReviewInputError(
				"The GitHub CLI is not signed in; run gh auth login, then try again.",
			);
		if (NOT_FOUND.test(result.output))
			throw new FactoryReviewInputError(
				`GitHub could not find the ${what}; check the number and that you can see the repository.`,
			);
		throw new Error(
			`Could not read the ${what}: ${result.timedOut ? "gh timed out" : firstLine(result.output)}`,
		);
	}
	if (result.truncated)
		throw new FactoryReviewInputError(
			`The ${what} is too large for Factory to review; review it manually.`,
		);
	const text = (result.stdout ?? result.output).trim();
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		parsed = text;
	}
	const checked = schema.safeParse(parsed);
	if (!checked.success)
		throw new Error(`GitHub returned an unexpected ${what} response.`);
	return checked.data;
}

async function git(
	run: Command,
	cwd: string,
	args: string[],
	signal: AbortSignal | undefined,
	maxBytes?: number,
) {
	return invoke(run, { cwd, file: "git", args, signal, maxBytes });
}

const repoViewSchema = z.object({ nameWithOwner: z.string() });
const prViewSchema = z.object({
	number: z.number().int().positive(),
	url: z.string(),
	title: z.string(),
	state: z.enum(["OPEN", "CLOSED", "MERGED"]),
	author: z.object({ login: z.string() }).nullable(),
	isCrossRepository: z.boolean(),
	isDraft: z.boolean(),
	baseRefName: z.string(),
	baseRefOid: z.string(),
	headRefName: z.string(),
	headRefOid: z.string(),
	files: z
		.array(
			z.object({
				path: z.string(),
				additions: z.number().int().nonnegative(),
				deletions: z.number().int().nonnegative(),
			}),
		)
		.nullable(),
	additions: z.number().int().nonnegative(),
	deletions: z.number().int().nonnegative(),
	changedFiles: z.number().int().nonnegative(),
});
const prRestSchema = z.object({
	author_association: z.string(),
	base_repo: z.string().nullable(),
	head_sha: z.string(),
});
const PR_FIELDS = [
	"number",
	"url",
	"title",
	"state",
	"author",
	"isCrossRepository",
	"isDraft",
	"baseRefName",
	"baseRefOid",
	"headRefName",
	"headRefOid",
	"files",
	"additions",
	"deletions",
	"changedFiles",
].join(",");

/**
 * Reads and verifies the facts Factory needs before reviewing a pull
 * request: the PR's refs and files from `gh pr view`, the author's
 * association and the PR's base repository from the REST API (gh pr view
 * has neither), the repository's name from `gh repo view` and the
 * signed-in login. Refuses with a
 * {@link FactoryReviewInputError} when the PR's base repository is not the
 * checkout's `origin`. Never checks out or runs anything from the PR.
 */
export async function readFactoryReviewInput(input: {
	workspaceRoot: string;
	pullRequest: number | string;
	signal?: AbortSignal;
	run?: Command;
}): Promise<FactoryReviewInput> {
	const run = input.run ?? runFactoryCommand;
	const { signal } = input;
	const reference = parseFactoryPullRequestReference(input.pullRequest);
	let cwd: string;
	try {
		cwd = await realpath(input.workspaceRoot);
	} catch {
		throw new FactoryReviewInputError(
			"The project folder for this review does not exist; choose an existing checkout of the repository.",
		);
	}
	const origin = await readOrigin(run, cwd, signal);
	if (!origin)
		throw new FactoryReviewInputError(
			"This project has no GitHub origin remote; review the pull request from a checkout whose origin is its repository.",
		);
	if (reference.repository && !sameRepository(reference.repository, origin))
		throw new FactoryReviewInputError(
			`Pull request #${reference.number} belongs to ${repositoryLabel(reference.repository)}, but this checkout's origin is ${repositoryLabel(origin)}; review it from a checkout of ${repositoryLabel(reference.repository)}.`,
		);
	const repoArg = repositoryLabel(origin);
	const hostArgs = factoryGhHostArgs(origin.host);

	const repoView = await ghJson(
		run,
		cwd,
		["repo", "view", repoArg, "--json", "nameWithOwner"],
		repoViewSchema,
		"repository",
		signal,
	);
	const [canonicalOwner, canonicalName] = repoView.nameWithOwner.split("/");
	const repository = identity(origin.host, canonicalOwner, canonicalName);
	if (!repository)
		throw new Error("GitHub returned an unexpected repository name.");

	const pr = await ghJson(
		run,
		cwd,
		[
			"pr",
			"view",
			String(reference.number),
			"--repo",
			repositoryLabel(repository),
			"--json",
			PR_FIELDS,
		],
		prViewSchema,
		"pull request",
		signal,
	);
	const rest = await ghJson(
		run,
		cwd,
		[
			"api",
			...hostArgs,
			`repos/${repository.owner}/${repository.name}/pulls/${reference.number}`,
			"--jq",
			"{author_association: .author_association, base_repo: .base.repo.full_name, head_sha: .head.sha}",
		],
		prRestSchema,
		"pull request",
		signal,
	);

	// The PR must target this repository: by its URL, and by the REST base.
	const urlMatch =
		/^https:\/\/([\w.-]+)\/([^/\s]+)\/([^/\s]+)\/pull\/([1-9]\d*)$/.exec(
			pr.url,
		);
	const prRepository = identity(urlMatch?.[1], urlMatch?.[2], urlMatch?.[3]);
	const [baseOwner, baseName] = (rest.base_repo ?? "").split("/");
	const baseRepository = identity(origin.host, baseOwner, baseName);
	for (const target of [prRepository, baseRepository])
		if (!target || !sameRepository(target, repository))
			throw new FactoryReviewInputError(
				`Pull request #${reference.number} targets ${target ? repositoryLabel(target) : "an unknown repository"}, not this checkout's origin ${repositoryLabel(repository)}; review it from a checkout of its base repository.`,
			);
	if (pr.number !== reference.number || Number(urlMatch?.[4]) !== pr.number)
		throw new Error("GitHub returned a different pull request than asked.");
	const baseSha = pr.baseRefOid.toLowerCase();
	const headSha = pr.headRefOid.toLowerCase();
	if (!SHA.test(baseSha) || !SHA.test(headSha))
		throw new Error("GitHub returned an invalid commit for the pull request.");
	if (rest.head_sha.toLowerCase() !== headSha)
		throw new FactoryReviewInputError(
			"The pull request changed while Factory was reading it; try again.",
		);

	const login = await invoke(run, {
		cwd,
		file: "gh",
		args: ["api", ...hostArgs, "user", "--jq", ".login"],
		signal,
		captureStdout: true,
	});
	const viewerLogin = (login.stdout ?? login.output).trim();
	if (login.exitCode !== 0 || login.timedOut) {
		if (SIGNED_OUT.test(login.output))
			throw new FactoryReviewInputError(
				"The GitHub CLI is not signed in; run gh auth login, then try again.",
			);
		throw new Error(
			`Could not read the signed-in GitHub user: ${firstLine(login.output)}`,
		);
	}
	if (!LOGIN.test(viewerLogin))
		throw new Error("GitHub returned an unexpected signed-in user.");

	const files = (pr.files ?? []).slice(0, MAX_FILES).map((file) => ({
		path: untrustedPath(file.path),
		additions: file.additions,
		deletions: file.deletions,
	}));
	const association = (
		FACTORY_REVIEW_AUTHOR_ASSOCIATIONS as readonly string[]
	).includes(rest.author_association)
		? (rest.author_association as FactoryReviewAuthorAssociation)
		: "NONE";
	const authorLogin = pr.author?.login ?? "";
	return {
		repository,
		number: pr.number,
		url: pr.url,
		title: factoryReviewUntrustedText(pr.title, MAX_TITLE),
		state: pr.state,
		author: {
			login: LOGIN.test(authorLogin) ? authorLogin : "ghost",
			association,
		},
		isCrossRepository: pr.isCrossRepository,
		isDraft: pr.isDraft,
		baseRefName: factoryReviewUntrustedText(pr.baseRefName, MAX_REF),
		baseSha,
		headRefName: factoryReviewUntrustedText(pr.headRefName, MAX_REF),
		headSha,
		files,
		additions: pr.additions,
		deletions: pr.deletions,
		changedFiles: pr.changedFiles,
		viewerLogin,
	};
}

/**
 * The GitHub repository `origin` points at: its URL with `insteadOf`
 * rewrites applied, else as configured. Undefined when it is not one.
 */
async function readOrigin(
	run: Command,
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<RepositoryIdentity | undefined> {
	for (const args of [
		["remote", "get-url", "origin"],
		["config", "--get", "remote.origin.url"],
	]) {
		const remote = await git(run, cwd, args, signal);
		const origin =
			remote.exitCode === 0 && !remote.timedOut
				? parseFactoryGitHubRemote(remote.output)
				: undefined;
		if (origin) return origin;
	}
	return undefined;
}

/**
 * The pull request a review card names, from a number, `owner/repo#n` or a
 * URL, in the repository of `workspaceRoot`'s origin. Refuses with a
 * {@link FactoryReviewInputError} naming the PR's repository when it is not
 * that origin. Reads only the checkout's git configuration.
 */
export async function resolveFactoryPullRequestReference(input: {
	workspaceRoot: string;
	pullRequest: number | string;
	signal?: AbortSignal;
	run?: Command;
}): Promise<FactoryPullRequestReference> {
	const reference = parseFactoryPullRequestReference(input.pullRequest);
	const origin = await readOrigin(
		input.run ?? runFactoryCommand,
		input.workspaceRoot,
		input.signal,
	);
	if (!origin)
		throw new FactoryReviewInputError(
			"This project has no GitHub origin remote; review the pull request from a checkout whose origin is its repository.",
		);
	if (reference.repository && !sameRepository(reference.repository, origin))
		throw new FactoryReviewInputError(
			`That pull request belongs to ${repositoryLabel(reference.repository)}, but this project's origin is ${repositoryLabel(origin)}; review it from a project whose origin is ${repositoryLabel(reference.repository)}.`,
		);
	return {
		...origin,
		number: reference.number,
		url: `https://${origin.host}/${origin.owner}/${origin.name}/pull/${reference.number}`,
	};
}

const MAX_BODY = 8_000;
const MAX_COMMITS = 50;
const MAX_COMMIT_SUBJECT = 200;

/**
 * The pull request's description and commit subjects for the reviewers'
 * prompt: untrusted text, flattened, stripped of control characters and
 * bounded (8,000 characters; 50 subjects of 200).
 */
export async function readFactoryReviewContext(input: {
	workspaceRoot: string;
	pullRequest: FactoryPullRequestReference;
	signal?: AbortSignal;
	run?: Command;
}): Promise<{ body: string; commits: string[] }> {
	const { pullRequest } = input;
	const view = await ghJson(
		input.run ?? runFactoryCommand,
		input.workspaceRoot,
		[
			"pr",
			"view",
			String(pullRequest.number),
			"--repo",
			repositoryLabel(pullRequest),
			"--json",
			"body,commits",
		],
		z.object({
			body: z.string().nullable().optional(),
			commits: z
				.array(z.object({ messageHeadline: z.string().nullable().optional() }))
				.nullable()
				.optional(),
		}),
		"pull request",
		input.signal,
	);
	return {
		body: factoryReviewUntrustedText(view.body ?? "", MAX_BODY),
		commits: (view.commits ?? [])
			.slice(-MAX_COMMITS)
			.map((commit) =>
				factoryReviewUntrustedText(
					commit.messageHeadline ?? "",
					MAX_COMMIT_SUBJECT,
				),
			),
	};
}

/**
 * A pull request's state and head now, and the signed-in user: what posting
 * and re-reviewing check before acting.
 */
export async function readFactoryPullRequestHead(input: {
	workspaceRoot: string;
	pullRequest: FactoryPullRequestReference;
	signal?: AbortSignal;
	run?: Command;
}): Promise<{
	open: boolean;
	headSha: string;
	authorLogin: string;
	viewerLogin: string;
}> {
	const run = input.run ?? runFactoryCommand;
	const { pullRequest } = input;
	const hostArgs = factoryGhHostArgs(pullRequest.host);
	const pull = await ghJson(
		run,
		input.workspaceRoot,
		[
			"api",
			...hostArgs,
			`repos/${pullRequest.owner}/${pullRequest.name}/pulls/${pullRequest.number}`,
			"--jq",
			"{state: .state, head: .head.sha, author: .user.login}",
		],
		z.object({
			state: z.string(),
			head: z.string(),
			author: z.string().nullable(),
		}),
		"pull request",
		input.signal,
	);
	const viewer = await ghJson(
		run,
		input.workspaceRoot,
		["api", ...hostArgs, "user", "--jq", "{login: .login}"],
		z.object({ login: z.string().regex(LOGIN) }),
		"signed-in GitHub user",
		input.signal,
	);
	const headSha = pull.head.toLowerCase();
	if (!SHA.test(headSha))
		throw new Error("GitHub returned an invalid commit for the pull request.");
	return {
		open: pull.state === "open",
		headSha,
		authorLogin: pull.author ?? "",
		viewerLogin: viewer.login,
	};
}
