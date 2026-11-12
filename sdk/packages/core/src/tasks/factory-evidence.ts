import {
	type AgendaTaskRecord,
	FACTORY_VERIFICATION_PROFILE_PATH,
	type FactoryCandidate,
	type FactoryRunState,
	type FactoryTaskConfig,
	factoryRepositoryRelative,
	factorySensitivePaths,
	formatFactoryId,
} from "@cline/shared";

export const FACTORY_EVIDENCE_START = "<!-- cline-factory-evidence:start -->";
export const FACTORY_EVIDENCE_END = "<!-- cline-factory-evidence:end -->";

/** The card's short id (`F42`), when it has a number. */
function factoryCardId(task: { factoryNumber?: number }): string | undefined {
	return task.factoryNumber ? formatFactoryId(task.factoryNumber) : undefined;
}

/** A Factory PR's title: the card title, prefixed `F<n>: ` when numbered. */
export function factoryPullRequestTitle(task: {
	title: string;
	factoryNumber?: number;
}): string {
	const id = factoryCardId(task);
	return id ? `${id}: ${task.title}` : task.title;
}

/** Marks the builder's own summary of the change in its final message. */
export const FACTORY_BUILDER_SUMMARY_LABEL = "PR SUMMARY:";
/** Appended to the builder's instructions; the PR description reuses the answer. */
export const FACTORY_BUILDER_SUMMARY_INSTRUCTION = `End your final message with "${FACTORY_BUILDER_SUMMARY_LABEL}" followed by 2-4 plain sentences for the pull request description: what changed and why, covering the whole change on this branch rather than only the latest repair. No file lists, check results, links or @mentions.`;

/** A file the PR changes, from `git diff --numstat`; counts are absent for binary files. */
export type FactoryChangedFile = {
	path: string;
	added?: number;
	removed?: number;
};

/** What Factory reads from the repository to describe a PR; every part is best effort. */
export type FactoryPullRequestContext = {
	/** `owner/name` of origin's GitHub repository, where the PR opens. */
	repository?: string;
	/** The repository's PR template at the card's base commit. */
	template?: string;
	changedFiles?: FactoryChangedFile[];
	/** The file list was cut short. */
	changedFilesIncomplete?: boolean;
};

/** GitHub's body limit is 65,536 characters; this leaves room for text a person adds. */
const MAX_BODY_CHARS = 60_000;
const MAX_CHANGED_FILES = 10;
const MAX_COMMANDS = 10;
/** A command longer than this is named rather than pasted. */
const MAX_COMMAND_CHARS = 300;

/**
 * Paths under common machine-local roots, replaced in prose and commands.
 * Narrow enough that URL paths such as `/api/health` survive.
 */
const PRIVATE_PATH =
	/(?<![\w.-])(?:~\/|\/(?:Users|home|private|tmp|var|opt|root|Volumes)\/|[A-Za-z]:[\\/])[^\s,;:`'"]*/g;

/**
 * One Markdown table cell. Text can come from approved plans or models, so it
 * can neither break the table or the markers, embed links or images, nor
 * notify people or reference issues on GitHub.
 */
export function factoryEvidenceCell(
	value: string | undefined,
	max = 500,
): string {
	return inline(value, max) || "—";
}

/** Untrusted text as one line of Markdown (see factoryEvidenceCell). */
function inline(value: string | undefined, max: number): string {
	const flat = (value ?? "")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/!\[[^\]]*\]\[[^\]]*\]/g, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
	const short = flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
	return (
		short
			.replaceAll("\\", "\\\\")
			.replaceAll("|", "\\|")
			.replaceAll("<", "&lt;")
			// A zero-width space stops @mentions and #references from linking.
			.replace(/[@#]/g, (mark) => `${mark}&#8203;`)
	);
}

/** Prose a person or model wrote, with machine-local paths removed. */
function prose(value: string | undefined, max: number): string {
	const text = inline(
		factoryRepositoryRelative(value ?? "").replace(
			PRIVATE_PATH,
			"(local path)",
		),
		max,
	);
	// An unpaired backtick would swallow the text Factory writes after it.
	return (text.match(/`/g)?.length ?? 0) % 2
		? text.replaceAll("`", "\\`")
		: text;
}

/** Inline code that cannot forge or close a marker. */
function code(value: string, max = 300): string {
	let text = value
		.replace(PRIVATE_PATH, "(local path)")
		.replace(/\s*[\r\n]\s*/g, " ")
		.trim()
		.replaceAll("<!--", "<!-​-");
	if (text.length > max) text = `${text.slice(0, max - 1)}…`;
	const longest = Math.max(
		0,
		...[...text.matchAll(/`+/g)].map((run) => run[0].length),
	);
	const fence = "`".repeat(longest + 1);
	const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
	return `${fence}${pad}${text}${pad}${fence}`;
}

/** Text cut to `max` characters, at a sentence end when one is near. */
function clip(text: string, max: number): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const end = cut.lastIndexOf(". ");
	return end > max / 2 ? cut.slice(0, end + 1) : `${cut.slice(0, max - 1)}…`;
}

/** The builder's own summary of the change, from its latest finished session. */
export function factoryBuilderSummary(
	attempts: FactoryRunState["attempts"],
): string | undefined {
	const last = [...(attempts ?? [])]
		.reverse()
		.find((attempt) => attempt.role === "builder");
	if (last?.status !== "completed") return undefined;
	const index = last.summary.lastIndexOf(FACTORY_BUILDER_SUMMARY_LABEL);
	if (index === -1) return undefined;
	return (
		last.summary.slice(index + FACTORY_BUILDER_SUMMARY_LABEL.length).trim() ||
		undefined
	);
}

/** The opening of a brief: its first paragraph that is not a heading. */
function briefOpening(brief: string | undefined): string | undefined {
	return brief
		?.split(/\n\s*\n/)
		.map((paragraph) =>
			paragraph
				.split("\n")
				.filter((line) => !/^\s*#/.test(line))
				.map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ""))
				.join(" ")
				.trim(),
		)
		.find(Boolean);
}

export type FactoryPullRequestBodyInput = {
	/** The card's short id (`F42`). */
	factoryId?: string;
	candidate: Pick<FactoryCandidate, "checks" | "stages">;
	/** What the card asked for: its description, else the brief's opening, else its title. */
	request?: { title?: string; description?: string; brief?: string };
	/** The builder's own summary of the change (factoryBuilderSummary). */
	builderSummary?: string;
	sourceIssue?: FactoryTaskConfig["sourceIssue"];
	/** The plan's affected paths, naming sensitive files when the diff is unknown. */
	affectedPaths?: readonly string[];
	/** Task config `verificationProfile.origin`; `proposed` changes the setup file. */
	verificationProfileOrigin?: NonNullable<
		FactoryTaskConfig["verificationProfile"]
	>["origin"];
	context?: FactoryPullRequestContext;
};

type SectionKey = "issue" | "description" | "testing" | "notes";

/** Template headings matched to Factory's content; first match wins. */
const TEMPLATE_HEADINGS: [RegExp, SectionKey | undefined][] = [
	[
		/type of change|check ?list|pre-?flight|screenshot|recording|demo/,
		undefined,
	],
	[
		/\b(?:related|linked)\b.*\b(?:issues?|tickets?)\b|^(?:issues?|fixes|closes|tickets?)$/,
		"issue",
	],
	[
		/\b(?:description|summary|overview|what|why|motivation|context|changes)\b/,
		"description",
	],
	[/\b(?:test|tests|testing|tested|verification|verify|qa)\b/, "testing"],
	[/\b(?:notes?|additional|other|reviewers?)\b/, "notes"],
];

/** The template's top-level headings, each matched to Factory content or dropped. */
function templateHeadings(
	template: string | undefined,
): { heading: string; key?: SectionKey }[] | undefined {
	if (!template) return undefined;
	const lines = template
		.replace(/<!--[\s\S]*?(?:-->|$)/g, "")
		.split("\n")
		.map((line) => /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line))
		.filter((match) => match !== null);
	const level = Math.min(...lines.map((match) => match[1]?.length ?? 6));
	const used = new Set<SectionKey>();
	const headings = lines
		.filter((match) => match[1]?.length === level)
		.map((match) => {
			const text = match[2] ?? "";
			const name = text
				.toLowerCase()
				.replace(/[^a-z0-9 -]/g, " ")
				.replace(/\s+/g, " ")
				.trim();
			let key = TEMPLATE_HEADINGS.find(([pattern]) => pattern.test(name))?.[1];
			if (key && used.has(key)) key = undefined;
			if (key) used.add(key);
			return { heading: `${"#".repeat(level)} ${inline(text, 100)}`, key };
		});
	return used.has("description") ? headings : undefined;
}

/**
 * The generated description of a Factory PR, written as a careful author
 * would: what changed and why, the linked issue, the files touched, the
 * commands run to test it and pointers for reviewers. How Factory verified
 * and reviewed the work stays in Factory (the card's proof receipt): the
 * body never states check, review or tester outcomes, models or findings.
 * Everything sits between the evidence markers so follow-up can replace it
 * while keeping what people wrote around it. Mapped onto the repository's
 * PR template headings when they match common ones.
 */
export function factoryPullRequestBody(
	input: FactoryPullRequestBodyInput,
): string {
	const { candidate, context } = input;

	// Description: the builder's summary, else what the card asked for.
	const summary = prose(input.builderSummary, 900);
	const request = prose(
		clip(
			(input.request?.description?.trim() ||
				briefOpening(input.request?.brief) ||
				input.request?.title) ??
				"",
			500,
		),
		520,
	);
	const description = [summary || request].filter(Boolean);

	// The source issue: closed by this PR only when it is in the PR's repository.
	const issue = input.sourceIssue;
	let issueLine: string | undefined;
	if (issue && /^https:\/\/[^\s<>()]+$/.test(issue.url)) {
		const match =
			/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/([1-9]\d*)\/?$/i.exec(
				issue.url,
			);
		issueLine =
			issue.provider === "github" &&
			match &&
			context?.repository &&
			`${match[1]}/${match[2]}`.toLowerCase() ===
				context.repository.toLowerCase()
				? `Fixes #${match[3]}`
				: `Related: ${issue.url}`;
	}

	// Changes.
	const files = context?.changedFiles ?? [];
	const changes = files.slice(0, MAX_CHANGED_FILES).map((file) => {
		const counts =
			file.added === undefined || file.removed === undefined
				? " (binary)"
				: ` (+${file.added} −${file.removed})`;
		return `- ${code(file.path, 200)}${counts}`;
	});
	const moreFiles = files.length - changes.length;
	if (moreFiles > 0)
		changes.push(`- +${moreFiles} more ${moreFiles === 1 ? "file" : "files"}`);
	else if (context?.changedFilesIncomplete) changes.push("- and more files");

	// Testing: the commands run, plainly; no claim about how they turned out.
	// A repository command stage that passed is one more command run. A long
	// or multi-line script is named instead of pasted: cut mid-code it is
	// noise, not something a reviewer can rerun.
	const ran = [
		...candidate.checks.map((check) => ({
			name: check.name,
			command: check.command.trim(),
		})),
		...(candidate.stages ?? []).flatMap((stage) =>
			stage.status === "passed" && stage.command
				? [{ name: stage.name, command: stage.command.trim() }]
				: [],
		),
	].filter((entry) => entry.command);
	const commands = [
		...new Set(
			ran.map(({ name, command }) =>
				command.length <= MAX_COMMAND_CHARS && !command.includes("\n")
					? code(command)
					: `${code(name, 80)} (a scripted check)`,
			),
		),
	];
	const testing = commands.slice(0, MAX_COMMANDS).map((line) => `- ${line}`);
	if (commands.length > MAX_COMMANDS)
		testing.push(`- +${commands.length - MAX_COMMANDS} more`);
	if (testing.length) testing.unshift("Ran:", "");

	// Notes for reviewers: pointers a careful author would add.
	const notes: string[] = [];
	const sensitive = factorySensitivePaths(
		files.length ? files.map((file) => file.path) : (input.affectedPaths ?? []),
	);
	if (sensitive.length)
		notes.push(
			`- Touches ${sensitive
				.slice(0, 3)
				.map((path) => code(path, 100))
				.join(
					", ",
				)}${sensitive.length > 3 ? ` and ${sensitive.length - 3} more sensitive files` : ""}.`,
		);
	if (input.verificationProfileOrigin === "proposed")
		notes.push(
			`- Adds or changes the app setup Factory uses for testing, ${code(FACTORY_VERIFICATION_PROFILE_PATH)}.`,
		);

	// Layout.
	const content: Record<SectionKey, string[]> = {
		issue: issueLine ? [issueLine] : [],
		description: [...description],
		testing,
		notes,
	};
	const blocks: string[][] = [];
	const push = (heading: string, lines: string[]) => {
		if (lines.length) blocks.push([heading, "", ...lines]);
	};
	const headings = templateHeadings(context?.template);
	if (headings) {
		const level = headings[0]?.heading.match(/^#+/)?.[0] ?? "##";
		if (changes.length)
			content.description.push("", "**Changes**", "", ...changes);
		const placed = new Set<SectionKey>();
		for (const { heading, key } of headings)
			if (key) {
				placed.add(key);
				push(heading, content[key]);
			}
		if (!placed.has("issue") && issueLine) blocks.unshift([issueLine]);
		if (!placed.has("testing")) push(`${level} Testing`, testing);
		if (!placed.has("notes")) push(`${level} Notes for reviewers`, notes);
	} else {
		if (description.length) blocks.push(description);
		if (issueLine) blocks.push([issueLine]);
		push("## Changes", changes);
		push("## Testing", testing);
		push("## Notes for reviewers", notes);
	}
	const footer = `Opened by Cline Factory${input.factoryId ? ` · card ${factoryEvidenceCell(input.factoryId, 20)}` : ""}`;
	const assemble = (inner: string) =>
		[
			FACTORY_EVIDENCE_START,
			"<!-- Cline Factory rewrites this block when it updates the PR. Add your own notes above or below it. -->",
			"",
			inner,
			"",
			"---",
			"",
			footer,
			"",
			FACTORY_EVIDENCE_END,
		].join("\n");
	let inner = blocks.map((part) => part.join("\n")).join("\n\n");
	if (assemble(inner).length > MAX_BODY_CHARS) {
		const cut = inner.slice(0, MAX_BODY_CHARS - 1_000);
		inner = `${cut.slice(0, cut.lastIndexOf("\n"))}\n\n_Truncated._`;
	}
	return assemble(inner);
}

/** What `factoryPullRequestDescription` reads from the card. */
type DescribedTask = Pick<
	AgendaTaskRecord,
	"title" | "description" | "instructions" | "factoryNumber"
> & { factory?: FactoryTaskConfig };

/**
 * The PR description for a card's `candidate`, from the card, its run state
 * and what was read from the repository (readFactoryPullRequestContext).
 */
export function factoryPullRequestDescription(input: {
	task: DescribedTask;
	state: Pick<FactoryRunState, "attempts" | "reviewSelection">;
	candidate: Pick<FactoryCandidate, "checks" | "stages">;
	context?: FactoryPullRequestContext;
}): string {
	const { task, state } = input;
	return factoryPullRequestBody({
		factoryId: factoryCardId(task),
		candidate: input.candidate,
		request: {
			title: task.title,
			description: task.description,
			brief: task.instructions,
		},
		builderSummary: factoryBuilderSummary(state.attempts),
		sourceIssue: task.factory?.sourceIssue,
		affectedPaths: state.reviewSelection?.affectedPaths,
		verificationProfileOrigin: task.factory?.verificationProfile?.origin,
		context: input.context,
	});
}

/**
 * Replaces the marked evidence section of a PR description, keeping
 * everything a human wrote around it, or appends the section when the
 * markers are gone.
 */
export function replaceFactoryEvidenceSection(
	body: string,
	section: string,
): string {
	const start = body.indexOf(FACTORY_EVIDENCE_START);
	const end = start === -1 ? -1 : body.indexOf(FACTORY_EVIDENCE_END, start);
	if (start === -1 || end === -1)
		return body.trim() ? `${body.trimEnd()}\n\n${section}` : section;
	return `${body.slice(0, start)}${section}${body.slice(end + FACTORY_EVIDENCE_END.length)}`;
}
