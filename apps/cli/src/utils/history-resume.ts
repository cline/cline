import { resolveCliLaunchSpec } from "./internal-launch";

export interface HistoryResumeCommand {
	launcher: string;
	childArgs: string[];
}

export interface BuildHistoryResumeArgsInput {
	sessionId: string;
	/** Full normalized CLI args (process.argv.slice(2) after normalization). */
	normalizedArgs: string[];
	/**
	 * Commander's `program.args` after parsing: the `history` subcommand token
	 * and everything following it. Must be a suffix of `normalizedArgs`.
	 */
	remainingArgs: string[];
	/**
	 * Config dir resolved from the full argv. Forwarded explicitly because
	 * `--config` may have been passed as a `history` subcommand option, which
	 * would otherwise be dropped with the rest of the subcommand args.
	 */
	configDir?: string;
}

/**
 * Builds argv for relaunching the CLI as `cline <globalFlags> --id <sessionId>`
 * after a session is picked in `cline history`. Returns undefined when the
 * global-flag prefix cannot be derived safely (caller falls back to resuming
 * in-process).
 */
export function buildHistoryResumeArgs(
	input: BuildHistoryResumeArgsInput,
): string[] | undefined {
	const { sessionId, normalizedArgs, remainingArgs, configDir } = input;
	const splitIndex = normalizedArgs.length - remainingArgs.length;
	if (splitIndex < 0) {
		return undefined;
	}
	for (let i = 0; i < remainingArgs.length; i++) {
		if (normalizedArgs[splitIndex + i] !== remainingArgs[i]) {
			return undefined;
		}
	}
	const globalArgs = normalizedArgs.slice(0, splitIndex);
	const args = [...globalArgs];
	const hasConfigFlag = globalArgs.some(
		(arg) => arg === "--config" || arg.startsWith("--config="),
	);
	if (configDir && !hasConfigFlag) {
		args.push("--config", configDir);
	}
	args.push("--id", sessionId);
	return args;
}

export function buildHistoryResumeCommand(
	input: BuildHistoryResumeArgsInput,
): HistoryResumeCommand | undefined {
	const childArgs = buildHistoryResumeArgs(input);
	if (!childArgs) {
		return undefined;
	}
	const spec = resolveCliLaunchSpec();
	if (!spec) {
		return undefined;
	}
	return {
		launcher: spec.launcher,
		childArgs: [...spec.childArgsPrefix, ...childArgs],
	};
}

/**
 * Resumes a history-picked session in a fresh `cline --id <sessionId>` child
 * process with inherited stdio, and returns its exit code. Creating a second
 * OpenTUI renderer in the picker's process can crash natively during teardown
 * (Bun "panic(main thread): Segmentation fault" on Ctrl+C), so the resumed
 * interactive TUI must get a process of its own.
 *
 * Returns undefined when the child cannot be launched; the caller should fall
 * back to resuming in-process.
 */
export async function spawnHistoryResume(
	input: BuildHistoryResumeArgsInput,
): Promise<number | undefined> {
	const command = buildHistoryResumeCommand(input);
	if (!command) {
		return undefined;
	}
	const { spawn } = await import("node:child_process");
	return await new Promise<number | undefined>((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command.launcher, command.childArgs, {
				stdio: "inherit",
			});
		} catch {
			resolve(undefined);
			return;
		}
		const onSigint = () => {
			try {
				child.kill("SIGINT");
			} catch {}
		};
		const onSigterm = () => {
			try {
				child.kill("SIGTERM");
			} catch {}
		};
		process.on("SIGINT", onSigint);
		process.on("SIGTERM", onSigterm);
		const finish = (value: number | undefined) => {
			process.off("SIGINT", onSigint);
			process.off("SIGTERM", onSigterm);
			resolve(value);
		};
		child.once("error", () => finish(undefined));
		child.once("exit", (code, signal) => finish(signal ? 1 : (code ?? 0)));
	});
}
