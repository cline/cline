/**
 * Factory decisions eval: runs the scoper and manager scenarios against a
 * real model and grades the outcomes in code. Run on demand:
 *
 *   bun run eval:factory -- --help
 *
 * Never part of `bun test` or CI.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	FACTORY_SYSTEM_PROMPT_RULE,
	FactoryGuidanceStore,
	factorySplitInstruction,
	ProviderSettingsManager,
	readFactoryManagerReadme,
} from "@cline/core";
import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared";
import { resolveProviderSettingsPath } from "@cline/shared/storage";
import { FACTORY_MANAGER_PROMPT_RULE } from "../../sidecar/chat-session";
import {
	gradeManager,
	gradeScoper,
	isHarnessOutcome,
	type ManagerTrial,
	type ScoperTrial,
	type Trial,
} from "./grade";
import { runManagerTrial } from "./manager";
import {
	formatMarkdown,
	formatTable,
	overallPassRate,
	type ScenarioSummary,
	summarize,
} from "./report";
import type { ModelChoice } from "./runtime";
import {
	MANAGER_SCENARIOS,
	type ManagerScenario,
	SCOPER_SCENARIOS,
	type ScoperScenario,
} from "./scenarios";
import { runScoperTrial } from "./scoper";
import type { TrialOptions } from "./trial";

const USAGE = `Usage: bun run eval:factory -- [options]

  --suite scoper|manager|all   Which decisions to evaluate (default all)
  --scenario <id>              Only this scenario; repeatable
  --trials N                   Independent trials per scenario (default 3)
  --provider <id>              Provider (default: last used in Cline)
  --model <id>                 Model (default: the provider's stored model)
  --concurrency N              Trials at once (default 2)
  --timeout-seconds N          Per trial (default 300)
  --plan-reviewers N           Scoper: plan reviewers in the card's pool (default 0, as with no workflow)
  --reviewers N                Scoper: final reviewers in the card's pool (default 1, as with no workflow)
  --out <dir>                  Where results.json and report.md go (default: a new temp dir)
  --fail-under <rate>          Exit 1 when the overall pass rate is below rate (0-1)
  --list                       Print the scenarios and exit
  --dry-run                    Print each selected scenario's assembled prompt; no model call
`;

type Job =
	| { suite: "scoper"; scenario: ScoperScenario; trial: number }
	| { suite: "manager"; scenario: ManagerScenario; trial: number };

function parse() {
	const { values } = parseArgs({
		options: {
			suite: { type: "string", default: "all" },
			scenario: { type: "string", multiple: true },
			trials: { type: "string", default: "3" },
			provider: { type: "string" },
			model: { type: "string" },
			concurrency: { type: "string", default: "2" },
			"timeout-seconds": { type: "string", default: "300" },
			"plan-reviewers": { type: "string" },
			reviewers: { type: "string" },
			out: { type: "string" },
			"fail-under": { type: "string" },
			list: { type: "boolean", default: false },
			"dry-run": { type: "boolean", default: false },
			help: { type: "boolean", default: false },
		},
	});
	const count = (name: string, value: string | undefined, min: number) => {
		const n = Number(value);
		if (!Number.isInteger(n) || n < min)
			throw new Error(`--${name} must be an integer of at least ${min}`);
		return n;
	};
	const pool = (name: string, value: string, min: number) => {
		const n = count(name, value, min);
		if (n > 4) throw new Error(`--${name} must be at most 4`);
		return n;
	};
	if (!["scoper", "manager", "all"].includes(values.suite ?? ""))
		throw new Error("--suite must be scoper, manager or all");
	const failUnder =
		values["fail-under"] === undefined
			? undefined
			: Number(values["fail-under"]);
	if (failUnder !== undefined && !(failUnder >= 0 && failUnder <= 1))
		throw new Error("--fail-under must be between 0 and 1");
	return {
		suite: values.suite as "scoper" | "manager" | "all",
		scenarios: values.scenario ?? [],
		trials: count("trials", values.trials, 1),
		provider: values.provider,
		model: values.model,
		concurrency: count("concurrency", values.concurrency, 1),
		timeoutMs: count("timeout-seconds", values["timeout-seconds"], 1) * 1000,
		reviewPool:
			values["plan-reviewers"] === undefined && values.reviewers === undefined
				? undefined
				: {
						planReviewers: pool(
							"plan-reviewers",
							values["plan-reviewers"] ?? "0",
							0,
						),
						reviewers: pool("reviewers", values.reviewers ?? "1", 1),
					},
		out: values.out,
		failUnder,
		list: values.list ?? false,
		dryRun: values["dry-run"] ?? false,
		help: values.help ?? false,
	};
}

function selectScenarios(args: ReturnType<typeof parse>) {
	const wanted = (id: string) =>
		!args.scenarios.length || args.scenarios.includes(id);
	const scoper =
		args.suite === "manager"
			? []
			: SCOPER_SCENARIOS.filter((s) => wanted(s.id));
	const manager =
		args.suite === "scoper"
			? []
			: MANAGER_SCENARIOS.filter((s) => wanted(s.id));
	const known = new Set([
		...(args.suite === "manager" ? [] : SCOPER_SCENARIOS.map((s) => s.id)),
		...(args.suite === "scoper" ? [] : MANAGER_SCENARIOS.map((s) => s.id)),
	]);
	const unknown = args.scenarios.filter((id) => !known.has(id));
	if (unknown.length)
		throw new Error(
			`Unknown scenario(s) for this suite: ${unknown.join(", ")}`,
		);
	return { scoper, manager };
}

const expectLabel = (expect: unknown) =>
	typeof expect === "string" ? expect : JSON.stringify(expect);

function printList(): void {
	console.log("Scoper scenarios (expect plan | split | either):");
	for (const s of SCOPER_SCENARIOS)
		console.log(`  ${s.id.padEnd(28)} ${s.expect.padEnd(7)} ${s.note}`);
	console.log("\nManager scenarios:");
	for (const s of MANAGER_SCENARIOS)
		console.log(
			`  ${s.id.padEnd(28)} ${expectLabel(s.expect)}\n${" ".repeat(31)}${s.note}`,
		);
}

/**
 * Sessions and storage go to a temporary Cline data directory; only the
 * stored provider settings are read from the user's own.
 */
function isolate(root: string): void {
	process.env.CLINE_PROVIDER_SETTINGS_PATH = resolveProviderSettingsPath();
	process.env.CLINE_DATA_DIR = join(root, "cline-data");
}

function resolveModel(args: ReturnType<typeof parse>): {
	model: ModelChoice;
	credential: boolean;
} {
	const settings = new ProviderSettingsManager();
	const providerId =
		args.provider ??
		settings.getLastUsedProviderSettings({ isClinePassEnabled: true })
			?.provider ??
		"cline";
	const stored = settings.getProviderSettings(providerId);
	const modelId =
		args.model ??
		stored?.model ??
		(providerId === "cline" ? CLINE_DEFAULT_MODEL_ID : undefined);
	if (!modelId)
		throw new Error(`No model stored for ${providerId}; pass --model.`);
	return {
		model: { providerId, modelId },
		credential: Boolean(stored?.apiKey || stored?.auth?.accessToken),
	};
}

async function runPool<T>(
	jobs: readonly Job[],
	concurrency: number,
	run: (job: Job) => Promise<T>,
): Promise<T[]> {
	const results: T[] = new Array(jobs.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
			while (next < jobs.length) {
				const index = next++;
				results[index] = await run(jobs[index] as Job);
			}
		}),
	);
	return results;
}

function printDryRun(job: Job, trial: Trial): void {
	const rule = "=".repeat(78);
	console.log(
		`\n${rule}\n${job.suite}/${job.scenario.id} (trial 1, not sent)\n${rule}`,
	);
	if (!trial.captured) {
		console.log(
			`No request was captured: ${trial.outcome}${trial.error ? `\n${trial.error}` : ""}`,
		);
		return;
	}
	const { systemPrompt, userMessage, tools } = trial.captured;
	const checks =
		job.suite === "scoper"
			? {
					"split instruction": userMessage.includes(
						factorySplitInstruction(true),
					),
				}
			: {
					FACTORY_SYSTEM_PROMPT_RULE: systemPrompt.includes(
						FACTORY_SYSTEM_PROMPT_RULE,
					),
					"manager readme": systemPrompt.includes(
						readFactoryManagerReadme(new FactoryGuidanceStore()).block,
					),
					FACTORY_MANAGER_PROMPT_RULE: systemPrompt.includes(
						FACTORY_MANAGER_PROMPT_RULE,
					),
				};
	console.log(`--- tools: ${tools.join(", ") || "(none)"}`);
	for (const [name, present] of Object.entries(checks))
		console.log(`--- contains ${name}: ${present ? "yes" : "NO"}`);
	console.log(
		`--- system prompt (${systemPrompt.length} chars)\n${systemPrompt}`,
	);
	console.log(`--- user message (${userMessage.length} chars)\n${userMessage}`);
}

async function main(): Promise<number> {
	const args = parse();
	if (args.help) {
		console.log(USAGE);
		return 0;
	}
	if (args.list) {
		printList();
		return 0;
	}
	const selected = selectScenarios(args);
	const root = mkdtempSync(join(tmpdir(), "factory-decisions-"));
	isolate(root);
	process.on("exit", () => rmSync(root, { recursive: true, force: true }));
	const { model, credential } = resolveModel(args);
	const trials = args.dryRun ? 1 : args.trials;
	const jobs: Job[] = [
		...selected.scoper.flatMap((scenario) =>
			Array.from({ length: trials }, (_, i) => ({
				suite: "scoper" as const,
				scenario,
				trial: i + 1,
			})),
		),
		...selected.manager.flatMap((scenario) =>
			Array.from({ length: trials }, (_, i) => ({
				suite: "manager" as const,
				scenario,
				trial: i + 1,
			})),
		),
	];
	if (!jobs.length) {
		console.log("No scenarios selected.");
		return 0;
	}
	console.log(`Provider: ${model.providerId}\nModel:    ${model.modelId}`);
	if (!args.dryRun && !credential) {
		console.error(
			`No stored credential for provider ${model.providerId}. Sign in with Cline (or pass --provider for one that has a stored key); nothing was run.`,
		);
		return 2;
	}
	console.log(
		args.dryRun
			? `Dry run: ${jobs.length} scenario(s), requests captured and never sent.`
			: `Starting ${jobs.length} trial(s): at least ${jobs.length} model session(s). Scoper format retries or a withdrawn breakdown, and the manager's duplicate-check judge, can each add one more.`,
	);
	const controller = new AbortController();
	process.on("SIGINT", () => {
		if (controller.signal.aborted) process.exit(130);
		console.error(
			"\nAborting: stopping sessions and writing partial results (Ctrl-C again to quit now).",
		);
		controller.abort();
	});
	const startedAt = new Date().toISOString();
	const results = await runPool(
		jobs,
		args.dryRun ? 1 : args.concurrency,
		async (job) => {
			const options: TrialOptions = {
				dryRun: args.dryRun,
				deadline: Date.now() + args.timeoutMs,
				signal: controller.signal,
				...(args.reviewPool ? { reviewPool: args.reviewPool } : {}),
			};
			if (controller.signal.aborted)
				return job.suite === "scoper"
					? ({
							suite: "scoper",
							scenarioId: job.scenario.id,
							trial: job.trial,
							outcome: "aborted",
							seconds: 0,
							modelRequests: 0,
							designerRuns: 0,
							formatRetries: 0,
							toolCalls: {},
						} satisfies ScoperTrial)
					: ({
							suite: "manager",
							scenarioId: job.scenario.id,
							trial: job.trial,
							outcome: "aborted",
							seconds: 0,
							modelRequests: 0,
							toolCalls: [],
							cards: [],
							priorityConfirmations: [],
							questions: [],
							seeded: [],
							judgeSessions: 0,
						} satisfies ManagerTrial);
			const trial =
				job.suite === "scoper"
					? await runScoperTrial(job.scenario, job.trial, model, options)
					: await runManagerTrial(job.scenario, job.trial, model, options);
			if (args.dryRun) printDryRun(job, trial);
			else
				console.log(
					`  ${job.suite}/${job.scenario.id} #${job.trial}: ${trial.outcome} (${trial.seconds.toFixed(0)}s)${trial.outcome === "harness_error" ? `\n${trial.error}` : ""}`,
				);
			return trial;
		},
	);
	const harnessBroke = results.some((t) => t.outcome === "harness_error");
	if (args.dryRun) return harnessBroke ? 2 : 0;

	const byScenario = [
		...selected.scoper.map((scenario) => {
			const trials = results.filter(
				(t): t is ScoperTrial =>
					t.suite === "scoper" && t.scenarioId === scenario.id,
			);
			return {
				suite: "scoper" as const,
				id: scenario.id,
				expect: scenario.expect,
				trials,
				grades: trials.map((t) => gradeScoper(scenario.expect, t)),
			};
		}),
		...selected.manager.map((scenario) => {
			const trials = results.filter(
				(t): t is ManagerTrial =>
					t.suite === "manager" && t.scenarioId === scenario.id,
			);
			return {
				suite: "manager" as const,
				id: scenario.id,
				expect: expectLabel(scenario.expect),
				trials,
				grades: trials.map((t) => gradeManager(scenario.expect, t)),
			};
		}),
	];
	const summaries: ScenarioSummary[] = byScenario.map(summarize);
	const out = resolve(
		args.out ?? mkdtempSync(join(tmpdir(), "factory-decisions-results-")),
	);
	mkdirSync(out, { recursive: true });
	const meta = {
		provider: model.providerId,
		model: model.modelId,
		trials,
		startedAt,
		...(args.reviewPool ? { reviewPool: args.reviewPool } : {}),
	};
	writeFileSync(
		join(out, "results.json"),
		`${JSON.stringify({ ...meta, finishedAt: new Date().toISOString(), aborted: controller.signal.aborted, summaries, scenarios: byScenario }, null, "\t")}\n`,
	);
	writeFileSync(join(out, "report.md"), formatMarkdown(summaries, meta));
	console.log(`\n${formatTable(summaries)}`);
	const overall = overallPassRate(summaries);
	const cost = results.reduce((sum, t) => sum + (t.usage?.totalCost ?? 0), 0);
	console.log(
		`\nOverall pass rate: ${overall === undefined ? "-" : `${Math.round(overall * 100)}%`}; model cost reported: $${cost.toFixed(3)}.`,
	);
	const skipped = results.filter((t) => isHarnessOutcome(t.outcome)).length;
	if (skipped)
		console.log(
			`${skipped} trial(s) aborted or broke in the harness and were not graded.`,
		);
	console.log(
		`Results: ${join(out, "results.json")}\nReport:  ${join(out, "report.md")}`,
	);
	if (controller.signal.aborted) return 130;
	if (harnessBroke) return 2;
	if (
		args.failUnder !== undefined &&
		overall !== undefined &&
		overall < args.failUnder
	)
		return 1;
	return 0;
}

main().then(
	(code) => process.exit(code),
	(error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(2);
	},
);
