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
		.description("Play back a session replay bundle")
		.addOption(
			new Option("--mode <mode>", "Replay mode")
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
			"Session in the bundle to play (default: the bundle root)",
		)
		.action(async (bundle: string) => {
			const opts = replayCmd.opts<{
				mode?: string;
				format?: string;
				from?: string;
				to?: string;
				speed?: string;
				step?: boolean;
				session?: string;
			}>();
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
