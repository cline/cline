import { realpath } from "node:fs/promises";
import { z } from "zod";
import { FactoryDecisionError } from "./factory-errors";
import { runFactoryCommand } from "./factory-local";

/*
 * Engine-verified facts about a pull request Factory is asked to review.
 * Everything read from GitHub about the PR (title, refs, file paths, logins)
 * is untrusted: it is bounded, stripped of control characters and only ever
 * passed to commands as argument array entries. Nothing here checks out or
 * runs code from the PR; CODEOWNERS is read from the BASE commit's object
 * database, never from the working tree or the PR head.
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

/** Associations whose PRs may ever be executed (with a user click). */
export const FACTORY_REVIEW_TRUSTED_ASSOCIATIONS: readonly FactoryReviewAuthorAssociation[] =
	["OWNER", "MEMBER", "COLLABORATOR"];

export const FACTORY_REVIEW_VIEWER_PERMISSIONS = [
	"ADMIN",
	"MAINTAIN",
	"WRITE",
	"TRIAGE",
	"READ",
	"NONE",
] as const;
export type FactoryReviewViewerPermission =
	(typeof FACTORY_REVIEW_VIEWER_PERMISSIONS)[number];

export interface FactoryReviewFile {
	path: string;
	additions: number;
	deletions: number;
}

export interface FactoryReviewCodeOwners {
	/** Touched files whose effective owners include the signed-in user. */
	matchedFiles: string[];
	/** Touched files examined (the PR's file list, bounded). */
	total: number;
	/** The CODEOWNERS path at the base commit, when one exists. */
	source?: string;
	/** Touched files owned by a team or e-mail owner: team owners, membership unknown. */
	teamOwnedFiles: string[];
	/** Why ownership could not be fully determined, when it could not. */
	limitation?: string;
}

export interface FactoryReviewInput {
	repository: {
		/** GitHub host, `github.com` unless the origin is an Enterprise server. */
		host: string;
		owner: string;
		name: string;
		viewerPermission: FactoryReviewViewerPermission;
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
	/** The signed-in GitHub user the ownership was computed for. */
	viewerLogin: string;
	codeOwners: FactoryReviewCodeOwners;
}

export interface FactoryReviewTrust {
	authorTrusted: boolean;
	reason: string;
	executable: "never" | "with_user_click";
	suggestion?: string;
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
const MAX_CODEOWNERS_BYTES = 512 * 1024;
const MAX_CODEOWNERS_RULES = 5000;
/** Standard CODEOWNERS locations, in GitHub's lookup order. */
export const FACTORY_CODEOWNERS_PATHS = [
	".github/CODEOWNERS",
	"CODEOWNERS",
	"docs/CODEOWNERS",
] as const;

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/** Untrusted single-line text: control and bidi characters removed, bounded. */
export function factoryReviewUntrustedText(value: string, max: number): string {
	const flat = value.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A repository path from the PR: control characters removed, bounded. */
function untrustedPath(value: string): string {
	const clean = value.replace(CONTROL, "");
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

function parsePullRequestReference(pullRequest: number | string): {
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
		const match =
			/^https:\/\/([\w.-]+)\/([^/\s]+)\/([^/\s]+)\/pull\/([1-9]\d{0,9})(?:[/?#]\S*)?$/.exec(
				text,
			);
		const repository = identity(match?.[1], match?.[2], match?.[3]);
		if (match && repository) return { number: Number(match[4]), repository };
	}
	throw new FactoryReviewInputError(
		"Give the pull request as a number or a pull request URL.",
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

const repoViewSchema = z.object({
	nameWithOwner: z.string(),
	viewerPermission: z.string().nullable().optional(),
});
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
 * has neither), the viewer's permission from `gh repo view`, the signed-in
 * login, and CODEOWNERS at the base commit. Refuses with a
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
	const reference = parsePullRequestReference(input.pullRequest);
	let cwd: string;
	try {
		cwd = await realpath(input.workspaceRoot);
	} catch {
		throw new FactoryReviewInputError(
			"The project folder for this review does not exist; choose an existing checkout of the repository.",
		);
	}
	const remote = await git(run, cwd, ["remote", "get-url", "origin"], signal);
	const origin =
		remote.exitCode === 0 && !remote.timedOut
			? parseFactoryGitHubRemote(remote.output)
			: undefined;
	if (!origin)
		throw new FactoryReviewInputError(
			"This project has no GitHub origin remote; review the pull request from a checkout whose origin is its repository.",
		);
	if (reference.repository && !sameRepository(reference.repository, origin))
		throw new FactoryReviewInputError(
			`Pull request #${reference.number} belongs to ${repositoryLabel(reference.repository)}, but this checkout's origin is ${repositoryLabel(origin)}; review it from a checkout of ${repositoryLabel(reference.repository)}.`,
		);
	const repoArg = repositoryLabel(origin);
	const hostArgs =
		origin.host === "github.com" ? [] : ["--hostname", origin.host];

	const repoView = await ghJson(
		run,
		cwd,
		["repo", "view", repoArg, "--json", "nameWithOwner,viewerPermission"],
		repoViewSchema,
		"repository",
		signal,
	);
	const [canonicalOwner, canonicalName] = repoView.nameWithOwner.split("/");
	const repository = identity(origin.host, canonicalOwner, canonicalName);
	if (!repository)
		throw new Error("GitHub returned an unexpected repository name.");
	const viewerPermission = (
		FACTORY_REVIEW_VIEWER_PERMISSIONS as readonly string[]
	).includes(repoView.viewerPermission ?? "")
		? (repoView.viewerPermission as FactoryReviewViewerPermission)
		: "NONE";

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
	const codeOwners = await readCodeOwnersAtBase({
		run,
		cwd,
		baseSha,
		baseRefName: pr.baseRefName,
		paths: files.map((file) => file.path),
		viewerLogin,
		signal,
	});
	const truncatedFiles = Math.max(pr.changedFiles, files.length) > files.length;
	if (truncatedFiles && !codeOwners.limitation)
		codeOwners.limitation = `GitHub listed ${files.length} of ${pr.changedFiles} changed files; ownership covers only those.`;
	return {
		repository: { ...repository, viewerPermission },
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
		codeOwners,
	};
}

/** A base branch name safe to pass to `git fetch` as a refspec source. */
const SAFE_REF =
	/^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)(?!.*\.lock$)[A-Za-z0-9._/-]{1,255}(?<![/.])$/;

async function readCodeOwnersAtBase(input: {
	run: Command;
	cwd: string;
	baseSha: string;
	baseRefName: string;
	paths: string[];
	viewerLogin: string;
	signal?: AbortSignal;
}): Promise<FactoryReviewCodeOwners> {
	const { run, cwd, baseSha, signal } = input;
	const empty = (limitation?: string): FactoryReviewCodeOwners => ({
		matchedFiles: [],
		total: input.paths.length,
		teamOwnedFiles: [],
		...(limitation ? { limitation } : {}),
	});
	const present = async () =>
		(await git(run, cwd, ["cat-file", "-e", `${baseSha}^{commit}`], signal))
			.exitCode === 0;
	if (!(await present())) {
		if (SAFE_REF.test(input.baseRefName))
			await git(
				run,
				cwd,
				[
					"fetch",
					"--no-tags",
					"--quiet",
					"origin",
					`refs/heads/${input.baseRefName}`,
				],
				signal,
			);
		if (!(await present()))
			return empty(
				"The base commit is not available locally, so CODEOWNERS could not be read.",
			);
	}
	for (const source of FACTORY_CODEOWNERS_PATHS) {
		const shown = await git(
			run,
			cwd,
			["show", `${baseSha}:${source}`],
			signal,
			MAX_CODEOWNERS_BYTES,
		);
		if (shown.exitCode !== 0 || shown.timedOut) continue;
		if (shown.truncated)
			return {
				...empty(
					`${source} at the base commit is larger than Factory reads; ownership is unknown.`,
				),
				source,
			};
		return {
			...factoryCodeOwnership(
				parseCodeOwners(shown.output),
				input.paths,
				input.viewerLogin,
			),
			source,
		};
	}
	return empty();
}

export interface FactoryCodeOwnersRule {
	/** The pattern as written. */
	pattern: string;
	/** `@user`, `@org/team` or e-mail owners; empty makes matches unowned. */
	owners: string[];
	/** 1-based line in the file. */
	line: number;
	/** The compiled matcher (gitignore-style, as GitHub applies it). */
	matcher: RegExp;
}

/**
 * Parses CODEOWNERS text into rules in file order. Comments (`#`, unless
 * escaped as `\#`) and blank lines are skipped, as are lines GitHub treats as
 * errors (`!` negation, `[ ]` ranges). Bounded to 5000 rules.
 */
export function parseCodeOwners(text: string): FactoryCodeOwnersRule[] {
	const rules: FactoryCodeOwnersRule[] = [];
	const lines = text.split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		if (rules.length >= MAX_CODEOWNERS_RULES) break;
		const raw = lines[index] ?? "";
		let content = "";
		for (let i = 0; i < raw.length; i++) {
			const char = raw[i];
			if (char === "\\" && raw[i + 1] === "#") {
				content += "#";
				i++;
				continue;
			}
			if (char === "#") break;
			content += char;
		}
		const tokens = content.trim().split(/\s+/).filter(Boolean);
		const [pattern, ...owners] = tokens;
		if (!pattern || pattern.startsWith("!") || /[[\]]/.test(pattern)) continue;
		const matcher = codeOwnersMatcher(pattern);
		if (!matcher) continue;
		rules.push({
			pattern,
			owners: owners.filter((owner) =>
				/^(?:@[\w.-]+(?:\/[\w.-]+)?|[^@\s]+@[^@\s]+)$/.test(owner),
			),
			line: index + 1,
			matcher,
		});
	}
	return rules;
}

function escapeRegex(text: string): string {
	return text.replace(/[.+^${}()|\\]/g, "\\$&");
}

function globSegment(segment: string): string {
	let out = "";
	for (const char of segment) {
		if (char === "*") out += "[^/]*";
		else if (char === "?") out += "[^/]";
		else out += escapeRegex(char);
	}
	return out;
}

/**
 * GitHub's CODEOWNERS pattern semantics (gitignore rules, minus negation
 * and ranges): a leading or middle slash anchors to the root, otherwise
 * the pattern matches at any depth; a trailing slash matches a directory's
 * contents; `**` spans directories; a pattern naming a directory covers
 * everything below it, except `dir/*`, which covers only direct children.
 */
function codeOwnersMatcher(pattern: string): RegExp | undefined {
	let body = pattern;
	const directoryOnly = body.endsWith("/");
	body = body.replace(/\/+$/, "");
	const leadingSlash = body.startsWith("/");
	body = body.replace(/^\/+/, "");
	if (!body) return leadingSlash ? /^.+$/ : undefined;
	const anchored = leadingSlash || body.includes("/");
	const segments = body.split("/");
	let regex = "";
	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i] ?? "";
		const last = i === segments.length - 1;
		if (segment === "**") {
			regex += last ? ".*" : "(?:[^/]+/)*";
			continue;
		}
		regex += globSegment(segment) + (last ? "" : "/");
	}
	const prefix = anchored ? "" : "(?:[^/]+/)*";
	const directChildrenOnly = !directoryOnly && segments.at(-1) === "*";
	const endsWithDoubleStar = segments.at(-1) === "**";
	const suffix = directoryOnly
		? "/.+"
		: directChildrenOnly || endsWithDoubleStar
			? ""
			: "(?:/.+)?";
	return new RegExp(`^${prefix}${regex}${suffix}$`);
}

/** The last rule matching `path` (last match wins), or undefined. */
export function codeOwnersFor(
	path: string,
	rules: readonly FactoryCodeOwnersRule[],
): FactoryCodeOwnersRule | undefined {
	const normalized = path.replace(/^\/+/, "");
	for (let index = rules.length - 1; index >= 0; index--) {
		const rule = rules[index];
		if (rule?.matcher.test(normalized)) return rule;
	}
	return undefined;
}

/**
 * Which `paths` the user owns under `rules`. Team (`@org/team`) and e-mail
 * owners cannot be resolved offline: files they own are listed as
 * team-owned (membership unknown) and never counted as the user's.
 */
export function factoryCodeOwnership(
	rules: readonly FactoryCodeOwnersRule[],
	paths: readonly string[],
	login: string,
): Omit<FactoryReviewCodeOwners, "source"> {
	const user = `@${login}`.toLowerCase();
	const matchedFiles: string[] = [];
	const teamOwnedFiles: string[] = [];
	for (const path of paths) {
		const owners = codeOwnersFor(path, rules)?.owners ?? [];
		if (owners.some((owner) => owner.toLowerCase() === user))
			matchedFiles.push(path);
		else if (
			owners.some((owner) => owner.includes("/") || !owner.startsWith("@"))
		)
			teamOwnedFiles.push(path);
	}
	return { matchedFiles, total: paths.length, teamOwnedFiles };
}

const ASSOCIATION_PHRASE: Record<string, string> = {
	OWNER: "the author owns the repository",
	MEMBER: "the author is an organization member",
	COLLABORATOR: "the author is a collaborator",
};

/**
 * Whether code from this PR could ever run, per the routing design: forks
 * and authors outside OWNER/MEMBER/COLLABORATOR never (until a sandbox
 * exists); same-repository trusted authors only after a user click, with a
 * suggestion saying how much of the change the user owns.
 */
export function factoryReviewTrust(
	input: Pick<
		FactoryReviewInput,
		"isCrossRepository" | "author" | "codeOwners"
	>,
): FactoryReviewTrust {
	const authorTrusted = FACTORY_REVIEW_TRUSTED_ASSOCIATIONS.includes(
		input.author.association,
	);
	if (input.isCrossRepository)
		return {
			authorTrusted,
			executable: "never",
			reason:
				"The pull request comes from a fork, so Factory never runs its code.",
		};
	if (!authorTrusted)
		return {
			authorTrusted,
			executable: "never",
			reason:
				"The author is not an owner, member or collaborator of the repository, so Factory never runs the pull request's code.",
		};
	const phrase =
		ASSOCIATION_PHRASE[input.author.association] ?? "the author is trusted";
	const { matchedFiles, total, source, teamOwnedFiles } = input.codeOwners;
	const teams = teamOwnedFiles.length
		? ` (${teamOwnedFiles.length} owned by teams whose membership is unknown)`
		: "";
	const ownership = source
		? `You own ${matchedFiles.length} of ${total} touched ${total === 1 ? "file" : "files"}${teams}`
		: "There is no CODEOWNERS file at the base commit";
	return {
		authorTrusted,
		executable: "with_user_click",
		reason:
			"The pull request comes from this repository and its author is trusted; running its code still needs your click.",
		suggestion: `${ownership} and ${phrase}.`,
	};
}
