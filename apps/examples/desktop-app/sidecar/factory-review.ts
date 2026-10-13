import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parsePatchFiles } from "@pierre/diffs";
import { z } from "zod";
import type { SessionFileDiff } from "../webview/lib/session-diff";

const execFileAsync = promisify(execFile);
const commitSchema = z.string().regex(/^(?:[\da-f]{40}|[\da-f]{64})$/i);
const diffReplySchema = z.object({
	runs: z.array(
		z.object({
			runId: z.string(),
			factory: z
				.object({
					workspace: z.object({
						path: z.string().min(1),
						baseCommit: commitSchema,
					}),
					candidateCommit: commitSchema.optional(),
				})
				.optional(),
		}),
	),
});

export async function readFactoryDiff(
	reply: unknown,
	runId: string,
): Promise<SessionFileDiff[]> {
	const run = diffReplySchema
		.parse(reply)
		.runs.find((item) => item.runId === runId);
	if (!run?.factory?.candidateCommit) {
		throw new Error(
			"This feature run has no recorded candidate commit to review.",
		);
	}
	const { workspace, candidateCommit } = run.factory;
	const git = async (...args: string[]) =>
		(
			await execFileAsync("git", args, {
				cwd: workspace.path,
				encoding: "utf8",
				timeout: 15_000,
				maxBuffer: 8 * 1024 * 1024,
			})
		).stdout;
	await Promise.all(
		[workspace.baseCommit, candidateCommit].map((commit) =>
			git("rev-parse", "--verify", `${commit}^{commit}`),
		),
	);
	const patch = await git(
		"diff",
		"--no-ext-diff",
		"--no-textconv",
		"--no-renames",
		"--no-color",
		"--src-prefix=a/",
		"--dst-prefix=b/",
		workspace.baseCommit,
		candidateCommit,
		"--",
	);
	return parsePatchFiles(patch, undefined, true).flatMap(({ files }) =>
		files.map((file) => ({
			path: file.name,
			additions: file.hunks.reduce(
				(total, hunk) => total + hunk.additionLines,
				0,
			),
			deletions: file.hunks.reduce(
				(total, hunk) => total + hunk.deletionLines,
				0,
			),
			hunks: file.hunks.map((hunk) => ({
				oldStart: hunk.deletionStart,
				newStart: hunk.additionStart,
				old: file.deletionLines
					.slice(
						hunk.deletionLineIndex,
						hunk.deletionLineIndex + hunk.deletionCount,
					)
					.join(""),
				new: file.additionLines
					.slice(
						hunk.additionLineIndex,
						hunk.additionLineIndex + hunk.additionCount,
					)
					.join(""),
			})),
		})),
	);
}
