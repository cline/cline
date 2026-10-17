import type { SourceEnv } from "../context/source";
import type { RunCommand } from "../run";

export type Call = { file: string; args: readonly string[] };

export function fakeRun(
	handler: (call: Call) => string,
): RunCommand & { calls: Call[] } {
	const calls: Call[] = [];
	const run: RunCommand = async (file, args) => {
		const call = { file, args };
		calls.push(call);
		return handler(call);
	};
	return Object.assign(run, { calls });
}

export function failure(code: number | string, stderr = ""): Error {
	return Object.assign(new Error("failed"), { code, stderr });
}

export const repoEnv: SourceEnv = {
	client: "cline-desktop",
	providerId: "anthropic",
	workspaceRoot: "/repo",
	git: { branch: "fix/405", remotes: ["git@github.com:cline/router.git"] },
	tools: ["read_file"],
};
