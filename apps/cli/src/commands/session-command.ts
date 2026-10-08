import { type Command, Option } from "commander";
import type { CliOutputMode } from "../utils/types";
import {
	runSessionDiff,
	runSessionExport,
	runSessionReplay,
	runSessionValidate,
	SESSION_DIFF_FORMATS,
	SESSION_REPLAY_FORMATS,
	SESSION_REPLAY_MODES,
	type SessionRerunFlags,
} from "./session";

type SessionCommandIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

type RegisterSessionCommandOptions = {
	program: Command;
	io: SessionCommandIo;
	setExitCode: (code: number) => void;
	isInteractiveTTY?: () => boolean;
};

export function registerSessionCommand({
	program,
	io,
	setExitCode,
	isInteractiveTTY = () =>
		process.stdin.isTTY === true && process.stdout.isTTY === true,
}: RegisterSessionCommandOptions): void {
	const sessionCmd = program
		.command("session")
		.description("Export, replay and compare recorded sessions")
		.option("--json", "Output as JSON")
		.action(() => {
			sessionCmd.outputHelp();
			setExitCode(0);
		});

	const outputMode = (cmd: Command): CliOutputMode =>
		program.opts().json || sessionCmd.opts().json || cmd.opts().json
			? "json"
			: "text";

	const exportCmd = sessionCmd
		.command("export <sessionId>")
		.description("Export a session as a replay bundle directory")
		.requiredOption("--bundle <dir>", "Directory to write the bundle to")
		.option(
			"--no-redact",
			"Keep values that match the sanitiser rules (secrets, ids, home paths)",
		)
		.option("--force", "Replace an existing bundle in the target directory")
		.option("--json", "Output as JSON")
		.action(async (sessionId: string) => {
			const opts = exportCmd.opts<{
				bundle: string;
				redact: boolean;
				force?: boolean;
			}>();
			setExitCode(
				await runSessionExport({
					sessionId,
					bundleDir: opts.bundle,
					redact: opts.redact !== false,
					overwrite: opts.force === true,
					outputMode: outputMode(exportCmd),
					io,
				}),
			);
		});

	const replayCmd = sessionCmd
		.command("replay <bundle>")
		.description(
			"Play back a session replay bundle, or rerun it live with --mode rerun (rerun exit 0: no divergence, 1: diverged, 2: error)",
		)
		.addOption(
			new Option(
				"--mode <mode>",
				"playback shows the recording; rerun runs the session again in a rebuilt workspace and reports where it diverged",
			)
				.choices([...SESSION_REPLAY_MODES])
				.default("playback"),
		)
		.addOption(
			new Option(
				"--format <format>",
				"Output format (default: tui in a terminal, text otherwise)",
			).choices([...SESSION_REPLAY_FORMATS]),
		)
		.option("--from <n>", "First iteration to play (1-based, inclusive)")
		.option("--to <n>", "Last iteration to play (inclusive)")
		.option(
			"--speed <factor>",
			"Playback speed relative to the recorded pace; 0 plays instantly (default: 1 in the TUI, 0 for text)",
		)
		.option("--step", "Advance one iteration at a time")
		.option(
			"--session <id>",
			"Session in the bundle to play (default: the bundle root; a rerun always starts from the root)",
		)
		.option(
			"--workspace <path>",
			"Rerun: repository to restore the starting checkpoint from (default: the recorded workspace path)",
		)
		.option(
			"--in-place",
			"Rerun: run in the workspace itself instead of a fresh copy (files are changed)",
		)
		.option(
			"--until-divergence",
			"Rerun: stop at the first divergence that counts",
		)
		.option("--continue", "Rerun: run to the end (default)")
		.option(
			"--ignore <kinds>",
			'Rerun: comma-separated divergence kinds that do not count, e.g. "request" (all request kinds)',
		)
		.option(
			"--count <kinds>",
			'Rerun: comma-separated divergence kinds that count in addition to the defaults, e.g. "assistant-text"',
		)
		.option(
			"--lenient",
			"Rerun: report request differences without counting them",
		)
		.option(
			"--interactive",
			"Rerun: ask for tool approvals and questions instead of answering from the recording",
		)
		.option(
			"--model <id>",
			"Rerun: model to run with (relaxes request matching to messages and tools)",
		)
		.option(
			"--provider <id>",
			"Rerun: provider to run with (relaxes request matching to messages and tools)",
		)
		.option(
			"--out <dir>",
			"Rerun: directory for the workspace copy, the rerun bundle and rerun-report.json (default: <bundle>.rerun-<time> next to the bundle)",
		)
		.option(
			"--in-container",
			"Rerun: run inside a container with the workspace mounted at the recorded path and the recorded env set",
		)
		.option(
			"--image <image>",
			"Rerun in a container: image to run (required; bundles carry no image digest)",
		)
		.option(
			"--container-runtime <bin>",
			"Rerun in a container: runtime binary (default: docker)",
		)
		.option(
			"--container-cli <command>",
			"Rerun in a container: the Cline CLI command in the image (default: cline)",
		)
		.option(
			"--container-arg <arg>",
			"Rerun in a container: extra argument for `<runtime> run`, repeatable (e.g. --container-arg=--volume=/src:/src:ro)",
			(value: string, previous: string[] = []) => [...previous, value],
		)
		.action(async (bundle: string) => {
			const opts = replayCmd.opts<
				{
					mode?: string;
					format?: string;
					from?: string;
					to?: string;
					speed?: string;
					step?: boolean;
					session?: string;
					containerArg?: string[];
				} & Omit<SessionRerunFlags, "containerArgs">
			>();
			setExitCode(
				await runSessionReplay({
					bundleDir: bundle,
					mode: opts.mode,
					format: opts.format,
					from: opts.from,
					to: opts.to,
					speed: opts.speed,
					step: opts.step === true,
					sessionId: opts.session,
					rerun: {
						workspace: opts.workspace,
						inPlace: opts.inPlace,
						untilDivergence: opts.untilDivergence,
						continue: opts.continue,
						ignore: opts.ignore,
						count: opts.count,
						lenient: opts.lenient,
						interactive: opts.interactive,
						model: opts.model,
						provider: opts.provider,
						out: opts.out,
						inContainer: opts.inContainer,
						image: opts.image,
						containerRuntime: opts.containerRuntime,
						containerCli: opts.containerCli,
						containerArgs: opts.containerArg,
					},
					io,
					isInteractiveTTY: isInteractiveTTY(),
				}),
			);
		});

	const diffCmd = sessionCmd
		.command("diff <recorded> <live>")
		.description(
			"Compare two replay bundles of the same task iteration by iteration and report the first divergence (exit 0: none, 1: diverged, 2: error)",
		)
		.option(
			"--ignore <kinds>",
			'Comma-separated divergence kinds that do not count, e.g. "assistant-text" or "request" (all request kinds)',
		)
		.option("--lenient", "Report divergences without failing (exit 0)")
		.addOption(
			new Option("--format <format>", "Output format (default: text)").choices([
				...SESSION_DIFF_FORMATS,
			]),
		)
		.option("--json", "Output as JSON (same as --format json)")
		.action(async (recorded: string, live: string) => {
			const opts = diffCmd.opts<{
				ignore?: string;
				lenient?: boolean;
				format?: string;
			}>();
			setExitCode(
				await runSessionDiff({
					recordedDir: recorded,
					liveDir: live,
					ignore: opts.ignore,
					lenient: opts.lenient === true,
					format: opts.format,
					outputMode: outputMode(diffCmd),
					io,
				}),
			);
		});

	const validateCmd = sessionCmd
		.command("validate <bundle>")
		.description("Check a session replay bundle against its schema")
		.option("--json", "Output as JSON")
		.action(async (bundle: string) => {
			setExitCode(
				await runSessionValidate({
					bundleDir: bundle,
					outputMode: outputMode(validateCmd),
					io,
				}),
			);
		});
}
