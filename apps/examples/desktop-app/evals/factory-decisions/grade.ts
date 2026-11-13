/**
 * Trial records and their grading. Pure: no model, no I/O. A trial that was
 * aborted or broke inside the harness is never graded.
 */

export interface Usage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalCost: number;
}

/** A model request as it would have been sent (dry run). */
export interface CapturedRequest {
	role: string;
	systemPrompt: string;
	userMessage: string;
	tools: string[];
}

/** Outcomes that are not the model's decision. */
export type HarnessOutcome = "aborted" | "harness_error";

interface TrialBase {
	scenarioId: string;
	trial: number;
	seconds: number;
	modelRequests: number;
	usage?: Usage;
	error?: string;
	/** Dry run: the first request of the trial, never sent. */
	captured?: CapturedRequest;
}

export type ScoperOutcome =
	| "plan"
	| "split"
	| "split_withdrawn_then_plan"
	| "conclusion"
	| "question"
	| "failed"
	| "timeout"
	| HarnessOutcome;

export interface ScoperTrial extends TrialBase {
	suite: "scoper";
	outcome: ScoperOutcome;
	parts?: { title: string; paths: string[]; dependsOn: number[] }[];
	planUnits?: number;
	checks?: number;
	/** Designer runs, including format recoveries and a withdrawn breakdown. */
	designerRuns: number;
	formatRetries: number;
	/** Tool name → calls, over every designer run. */
	toolCalls: Record<string, number>;
	question?: string;
	finalText?: string;
}

export interface ManagerToolCall {
	name: string;
	input: unknown;
	/** The tool's reply `ok`, when it returned one. */
	ok?: boolean;
	errorCode?: string;
	duplicateOf?: boolean;
}

export interface FiledCard {
	title: string;
	project: string;
	priority?: string;
	deliverable?: string;
}

export interface ManagerTrial extends TrialBase {
	suite: "manager";
	/** "N cards", "asked" or "no card", or a harness outcome. */
	outcome: string;
	toolCalls: ManagerToolCall[];
	cards: FiledCard[];
	priorityConfirmations: { to: string; approved: boolean }[];
	questions: string[];
	/** Cards seeded before the first message, as the person sees them. */
	seeded: { shortId: string; title: string }[];
	finalText?: string;
	judgeSessions: number;
}

export type Trial = ScoperTrial | ManagerTrial;

export type ScoperExpect = "plan" | "split" | "either";

export interface ManagerExpect {
	cardsFiled: number | { min: number; max: number };
	/** Every filed card is in this project. */
	project?: string;
	/** The highest priority the model asked for, when filing or with factory_status. */
	priority?: string;
	priorityNot?: string;
	deliverable?: string;
	/** false: the first `factory` call must not pass allow_duplicate: true. */
	allowDuplicate?: false;
	/** At least one of these tools was called. */
	calledTools?: string[];
	/** The `factory` tool was never called. */
	noFiling?: true;
	/** The final reply names a seeded card (short id or title). */
	mentionsSeeded?: true;
}

export interface Grade {
	pass: boolean;
	reasons: string[];
}

const PRIORITY_ORDER = ["none", "low", "medium", "high", "urgent"];

/** Undefined: not graded (an `either` scenario, or the harness's own outcome). */
export function gradeScoper(
	expect: ScoperExpect,
	trial: ScoperTrial,
): Grade | undefined {
	if (expect === "either" || isHarnessOutcome(trial.outcome)) return undefined;
	// A withdrawn breakdown was the model choosing to split; it counts for neither.
	return trial.outcome === expect
		? { pass: true, reasons: [] }
		: { pass: false, reasons: [`expected ${expect}, got ${trial.outcome}`] };
}

export function gradeManager(
	expect: ManagerExpect | "either",
	trial: ManagerTrial,
): Grade | undefined {
	if (expect === "either" || isHarnessOutcome(trial.outcome)) return undefined;
	const reasons: string[] = [];
	const count = trial.cards.length;
	const { min, max } =
		typeof expect.cardsFiled === "number"
			? { min: expect.cardsFiled, max: expect.cardsFiled }
			: expect.cardsFiled;
	if (count < min || count > max)
		reasons.push(
			`expected ${min === max ? min : `${min}-${max}`} card(s), got ${count}`,
		);
	if (expect.project)
		for (const card of trial.cards)
			if (card.project !== expect.project)
				reasons.push(`"${card.title}" filed in ${card.project}`);
	const asked = requestedPriority(trial.toolCalls);
	if (expect.priority && asked !== expect.priority)
		reasons.push(`expected priority ${expect.priority}, asked for ${asked}`);
	if (expect.priorityNot && asked === expect.priorityNot)
		reasons.push(`asked for priority ${asked}`);
	if (expect.deliverable)
		for (const card of trial.cards)
			if ((card.deliverable ?? "change") !== expect.deliverable)
				reasons.push(
					`"${card.title}" delivers ${card.deliverable ?? "change"}`,
				);
	const filings = trial.toolCalls.filter((call) => call.name === "factory");
	if (
		expect.allowDuplicate === false &&
		inputField(filings[0]?.input, "allow_duplicate") === true
	)
		reasons.push("first filing passed allow_duplicate: true");
	if (
		expect.calledTools &&
		!trial.toolCalls.some((call) => expect.calledTools?.includes(call.name))
	)
		reasons.push(`called none of ${expect.calledTools.join(", ")}`);
	if (expect.noFiling && filings.length)
		reasons.push(`called factory ${filings.length} time(s)`);
	if (expect.mentionsSeeded) {
		const text = (trial.finalText ?? "").toLowerCase();
		if (
			!trial.seeded.some(
				(card) =>
					text.includes(card.shortId.toLowerCase()) ||
					text.includes(card.title.toLowerCase()),
			)
		)
			reasons.push("reply names no existing card");
	}
	return { pass: reasons.length === 0, reasons };
}

/**
 * The highest priority the model asked for: on a `factory` filing, or with
 * `factory_status` action priority (whether or not the person confirmed).
 */
export function requestedPriority(calls: readonly ManagerToolCall[]): string {
	let highest = "none";
	for (const call of calls) {
		const level =
			call.name === "factory" ||
			(call.name === "factory_status" &&
				inputField(call.input, "action") === "priority")
				? inputField(call.input, "priority")
				: undefined;
		if (
			typeof level === "string" &&
			PRIORITY_ORDER.indexOf(level) > PRIORITY_ORDER.indexOf(highest)
		)
			highest = level;
	}
	return highest;
}

export function isHarnessOutcome(outcome: string): outcome is HarnessOutcome {
	return outcome === "aborted" || outcome === "harness_error";
}

function inputField(input: unknown, key: string): unknown {
	return input && typeof input === "object"
		? (input as Record<string, unknown>)[key]
		: undefined;
}
