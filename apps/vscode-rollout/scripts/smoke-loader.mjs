/**
 * Node-level smoke test for the built loader against a staged VSIX directory.
 * No real VS Code: `vscode` is stubbed just enough for the loader itself, and
 * the staging dir's next/legacy bundles are swapped for tiny recorders. Verifies
 * the loader's end-to-end behavior in a real require() environment:
 *   1. default (no cached cohort)      -> activates legacy
 *   2. cached cohort "next"            -> activates next, scoped context paths
 *   3. the flag refresh caches a TWO-WAY assignment for the next window
 *      (rollout on promotes, rollout off demotes a cached "next")
 *   4. CLINE_BUNDLE_OVERRIDE / the cline.rollout.bundleOverride setting
 *      force a bundle in either direction
 *   5. next activation throws          -> disposes partial registrations, falls
 *                                         back to legacy, pins version, and
 *                                         skips the cohort refresh
 *   6. the activated bundle's reportRolloutActivation export receives the
 *      authoritative attempted/actual/fallback record (and its absence is
 *      tolerated); the loader's own loader_decision capture fires exactly
 *      once per window
 *   7. the nightly identity (manifest name cline-nightly) switches the
 *      setting section + context key namespace and shows the status bar
 *      bundle indicator
 *   8. both bundles throwing surfaces the failure and captures a
 *      double_failure loader event
 *
 * Usage: node smoke-loader.mjs <staging-dir>
 * Copies the staging dir to a temp sandbox; the input is never modified.
 */
import assert from "node:assert";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const staging = process.argv[2];
if (!staging) {
	console.error("usage: node smoke-loader.mjs <staging-dir>");
	process.exit(1);
}

// ---- vscode API stub (only what the loader touches) -------------------------
const executedCommands = [];
const statusBarItems = [];
function makeVscodeStub(
	sandbox,
	settings = {},
	{ telemetryEnabled = false } = {},
) {
	return {
		Uri: {
			file: (fsPath) => ({ fsPath, path: fsPath, scheme: "file" }),
			joinPath: (base, ...segments) => {
				const fsPath = path.join(base.fsPath, ...segments);
				return { fsPath, path: fsPath, scheme: "file" };
			},
		},
		commands: {
			executeCommand: async (command, ...args) => {
				executedCommands.push([command, ...args]);
			},
		},
		workspace: {
			getConfiguration: (section) => ({
				get: (key) => settings[`${section}.${key}`],
			}),
		},
		window: {
			createStatusBarItem: () => {
				const item = {
					text: "",
					tooltip: "",
					shown: false,
					show() {
						this.shown = true;
					},
					dispose() {},
				};
				statusBarItems.push(item);
				return item;
			},
		},
		StatusBarAlignment: { Left: 1, Right: 2 },
		env: { machineId: "smoke-machine", isTelemetryEnabled: telemetryEnabled },
		version: "0.0.0-smoke",
		_sandbox: sandbox,
	};
}

function makeContext(sandbox, globalStateSeed = {}, packageJSON = {}) {
	const state = new Map(Object.entries(globalStateSeed));
	return {
		extensionUri: { fsPath: sandbox, path: sandbox, scheme: "file" },
		extensionPath: sandbox,
		extension: { packageJSON: { version: "4.1.0-smoke", ...packageJSON } },
		subscriptions: [],
		globalState: {
			get: (key) => state.get(key),
			update: async (key, value) => void state.set(key, value),
			_dump: () => Object.fromEntries(state),
		},
		asAbsolutePath: (rel) => path.join(sandbox, rel),
	};
}

/** PostHog /capture/ POSTs recorded by a scenario's fetch stub, parsed. */
function captureCalls(fetchCalls) {
	return fetchCalls
		.filter(([url]) => String(url).includes("/capture/"))
		.map(([, init]) => JSON.parse(init.body));
}

function captureEvents(fetchCalls, event) {
	return captureCalls(fetchCalls).filter((capture) => capture.event === event);
}

function loaderDecisionCaptures(fetchCalls) {
	return captureEvents(fetchCalls, "extension.rollout.loader_decision");
}

function featureFlagCalledCaptures(fetchCalls) {
	return captureEvents(fetchCalls, "$feature_flag_called");
}

function decideCalls(fetchCalls) {
	return fetchCalls.filter(([url]) => String(url).includes("/decide"));
}

function flagResponse(flags = { rollout: false }) {
	return {
		ok: true,
		json: async () => ({
			featureFlags: {
				"ext-sdk-bundle-rollout": flags.rollout,
			},
		}),
	};
}

function makeFlagFetch(flags) {
	const calls = [];
	const fetch = async (...args) => {
		calls.push(args);
		return flagResponse(flags);
	};
	return { calls, fetch };
}

function makeDeferredFlagFetch(flags) {
	const calls = [];
	let resolveResponse;
	let markStarted;
	const started = new Promise((resolve) => {
		markStarted = resolve;
	});
	const fetch = (...args) => {
		calls.push(args);
		markStarted();
		return new Promise((resolve) => {
			resolveResponse = () => resolve(flagResponse(flags));
		});
	};
	return {
		calls,
		fetch,
		started,
		resolve: () => resolveResponse?.(),
	};
}

async function waitFor(predicate, message, timeoutMs = 500) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) {
			assert.fail(message);
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

async function flushAsyncWork() {
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
}

// ---- sandbox setup -----------------------------------------------------------
function makeSandbox({
	nextThrows = false,
	legacyThrows = false,
	omitReportExport = false,
} = {}) {
	const sandbox = mkdtempSync(path.join(tmpdir(), "cline-ab-smoke-"));
	cpSync(
		path.join(staging, "extension.js"),
		path.join(sandbox, "extension.js"),
	);
	for (const bundle of ["next", "legacy"]) {
		mkdirSync(path.join(sandbox, bundle, "dist"), { recursive: true });
		const throws =
			(bundle === "next" && nextThrows) ||
			(bundle === "legacy" && legacyThrows);
		const throwLine = throws
			? `await global.__smoke.beforeNextFailure?.();\n\t\tctx.subscriptions.push({ dispose() { global.__smoke.disposed.push("${bundle}") } });\n\t\tthrow new Error("smoke: ${bundle} activation exploded");`
			: "";
		// Mirrors the reportRolloutActivation export both real bundles gained in
		// their rollout-telemetry PRs; recorded so scenarios can assert the
		// authoritative attempted/actual/fallback record.
		const reportExport = omitReportExport
			? ""
			: `exports.reportRolloutActivation = async (input) => { global.__smoke.reports.push({ reporter: "${bundle}", attemptedBundle: input.attemptedBundle, actualBundle: input.actualBundle, fallback: input.fallback, hasError: input.error !== undefined }); };`;
		writeFileSync(
			path.join(sandbox, bundle, "dist", "extension.js"),
			`exports.activate = async (ctx) => {
		${throwLine}
		global.__smoke.activated.push({ bundle: "${bundle}", extensionPath: ctx.extensionPath, asAbs: ctx.asAbsolutePath("webview-ui/build") });
		return { bundle: "${bundle}" };
	};
	exports.deactivate = () => { global.__smoke.deactivated.push("${bundle}"); };
	${reportExport}`,
		);
	}
	mkdirSync(path.join(sandbox, "data"), { recursive: true });
	writeFileSync(
		path.join(sandbox, "data", "globalState.json"),
		JSON.stringify({ "cline.generatedMachineId": "smoke-machine" }),
	);
	return sandbox;
}

async function runScenario(
	name,
	{
		seed = {},
		env = {},
		settings = {},
		nextThrows = false,
		legacyThrows = false,
		omitReportExport = false,
		telemetryEnabled = false,
		contextPackageJSON = {},
		expectFailure = false,
		fetchController = makeFlagFetch(),
		beforeNextFailure,
		expectRefresh = true,
	},
	checks,
	afterDeactivateChecks = async () => {},
) {
	const sandbox = makeSandbox({ nextThrows, legacyThrows, omitReportExport });
	global.__smoke = {
		activated: [],
		deactivated: [],
		disposed: [],
		reports: [],
		beforeNextFailure,
	};
	executedCommands.length = 0;
	statusBarItems.length = 0;

	const previousEnv = {};
	const scenarioEnv = {
		CLINE_DIR: sandbox,
		// A dev build leaves this lookup dynamic; production builds inline the
		// real PostHog key. Either way, the smoke must exercise refreshCohort.
		TELEMETRY_SERVICE_API_KEY: "smoke-posthog-project-key",
		...env,
	};
	for (const [key, value] of Object.entries(scenarioEnv)) {
		previousEnv[key] = process.env[key];
		process.env[key] = value;
	}
	const originalFetch = global.fetch;
	global.fetch = fetchController.fetch;
	const originalResolve = Module._resolveFilename;
	Module._resolveFilename = function (request, ...rest) {
		if (request === "vscode") {
			return "vscode";
		}
		return originalResolve.call(this, request, ...rest);
	};
	require.cache.vscode = {
		id: "vscode",
		filename: "vscode",
		loaded: true,
		exports: makeVscodeStub(sandbox, settings, { telemetryEnabled }),
	};

	try {
		const loaderPath = path.join(sandbox, "extension.js");
		delete require.cache[loaderPath];
		const loader = require(loaderPath);
		const context = makeContext(sandbox, seed, contextPackageJSON);
		let api;
		let activationError;
		try {
			api = await loader.activate(context);
		} catch (error) {
			activationError = error;
		}
		if (expectFailure) {
			assert.ok(activationError, `${name} should have failed to activate`);
		} else if (activationError) {
			throw activationError;
		}
		if (expectRefresh) {
			await waitFor(
				() => decideCalls(fetchController.calls).length > 0,
				`${name} did not refresh its cohort after activation`,
			);
			await flushAsyncWork();
			assert.equal(
				decideCalls(fetchController.calls).length,
				1,
				`${name} should refresh its cohort exactly once`,
			);
		}
		await checks({
			context,
			api,
			activationError,
			sandbox,
			fetchCalls: fetchController.calls,
		});
		await loader.deactivate();
		await afterDeactivateChecks({ context, api, sandbox });
		console.log(`PASS ${name}`);
	} finally {
		Module._resolveFilename = originalResolve;
		delete require.cache.vscode;
		if (originalFetch === undefined) {
			delete global.fetch;
		} else {
			global.fetch = originalFetch;
		}
		for (const [key, value] of Object.entries(previousEnv)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
		rmSync(sandbox, { recursive: true, force: true });
	}
}

const require = Module.createRequire(import.meta.url);

await runScenario("default cohort -> legacy", {}, async ({ api, sandbox }) => {
	assert.deepEqual(api, { bundle: "legacy" });
	assert.equal(
		global.__smoke.activated[0].extensionPath,
		path.join(sandbox, "legacy"),
	);
	assert.deepEqual(executedCommands[0], [
		"setContext",
		"cline.sdkBundle",
		false,
	]);
	assert.deepEqual(global.__smoke.deactivated, []);
	// The activated bundle received the authoritative activation record.
	assert.deepEqual(global.__smoke.reports, [
		{
			reporter: "legacy",
			attemptedBundle: "legacy",
			actualBundle: "legacy",
			fallback: false,
			hasError: false,
		},
	]);
	// Stable identity: no nightly status bar indicator.
	assert.equal(statusBarItems.length, 0);
});

await runScenario(
	"cached next -> next with scoped paths",
	{ seed: { "cline.rollout.bundle": "next" } },
	async ({ api, sandbox }) => {
		assert.deepEqual(api, { bundle: "next" });
		const activation = global.__smoke.activated[0];
		assert.equal(activation.extensionPath, path.join(sandbox, "next"));
		assert.equal(
			activation.asAbs,
			path.join(sandbox, "next", "webview-ui", "build"),
		);
		assert.deepEqual(executedCommands[0], [
			"setContext",
			"cline.sdkBundle",
			true,
		]);
		assert.deepEqual(global.__smoke.reports, [
			{
				reporter: "next",
				attemptedBundle: "next",
				actualBundle: "next",
				fallback: false,
				hasError: false,
			},
		]);
	},
);

await runScenario(
	"rollout flag on promotes for the NEXT window only",
	{
		fetchController: makeFlagFetch({ rollout: true }),
	},
	async ({ context, api, fetchCalls }) => {
		// This window already decided legacy from the (empty) cache; the refresh
		// promotes the NEXT window.
		assert.deepEqual(api, { bundle: "legacy" });
		assert.equal(context.globalState._dump()["cline.rollout.bundle"], "next");
		const [featureFlagCalled] = featureFlagCalledCaptures(fetchCalls);
		assert.ok(featureFlagCalled, "rollout refresh must emit the PostHog feature-flag exposure event");
		assert.equal(featureFlagCalled.properties.$feature_flag, "ext-sdk-bundle-rollout");
		assert.equal(featureFlagCalled.properties.$feature_flag_response, true);
	},
);

await runScenario(
	"rollout flag off demotes a cached next for the NEXT window (two-way)",
	{
		seed: { "cline.rollout.bundle": "next" },
		fetchController: makeFlagFetch({ rollout: false }),
	},
	async ({ context, api, fetchCalls }) => {
		// This window already ran next; dialing the flag down moves the machine
		// back to legacy on its next reload.
		assert.deepEqual(api, { bundle: "next" });
		assert.equal(context.globalState._dump()["cline.rollout.bundle"], "legacy");
		const [featureFlagCalled] = featureFlagCalledCaptures(fetchCalls);
		assert.ok(featureFlagCalled, "rollout refresh must emit the PostHog feature-flag exposure event");
		assert.equal(featureFlagCalled.event, "$feature_flag_called");
		assert.equal(featureFlagCalled.properties.$feature_flag, "ext-sdk-bundle-rollout");
		assert.equal(featureFlagCalled.properties.$feature_flag_response, false);
	},
);

await runScenario(
	"env override forces next",
	{ env: { CLINE_BUNDLE_OVERRIDE: "next" } },
	async ({ api }) => {
		assert.deepEqual(api, { bundle: "next" });
	},
);

await runScenario(
	"user setting overrides to legacy despite cached next",
	{
		seed: { "cline.rollout.bundle": "next" },
		settings: { "cline.rollout.bundleOverride": "legacy" },
	},
	async ({ api }) => {
		assert.deepEqual(api, { bundle: "legacy" });
	},
);

await runScenario(
	"user setting overrides to next despite a cached legacy assignment",
	{
		seed: { "cline.rollout.bundle": "legacy" },
		settings: { "cline.rollout.bundleOverride": "next" },
	},
	async ({ api }) => {
		assert.deepEqual(api, { bundle: "next" });
	},
);

const failedNextRefresh = makeDeferredFlagFetch({ rollout: true });
await runScenario(
	"next activation failure falls back to legacy",
	{
		seed: { "cline.rollout.bundle": "next" },
		nextThrows: true,
		fetchController: failedNextRefresh,
		expectRefresh: false,
		beforeNextFailure: () =>
			Promise.race([
				failedNextRefresh.started,
				new Promise((resolve) => setTimeout(resolve, 100)),
			]),
	},
	async ({ context, api, fetchCalls }) => {
		assert.deepEqual(api, { bundle: "legacy" });
		assert.deepEqual(
			global.__smoke.disposed,
			["next"],
			"partial registrations disposed",
		);
		const state = context.globalState._dump();
		assert.equal(state["cline.rollout.bundle"], "legacy");
		assert.equal(
			state["cline.rollout.nextActivationFailedVersion"],
			"4.1.0-smoke",
		);
		assert.equal(
			context.subscriptions.length,
			0,
			"failed bundle's subscriptions removed",
		);
		// setContext flipped back for the legacy UI
		assert.deepEqual(executedCommands.at(-1), [
			"setContext",
			"cline.sdkBundle",
			false,
		]);
		// The LEGACY bundle (the one whose telemetry pipeline is alive) received
		// the authoritative fallback record; the dead next bundle reported nothing.
		assert.deepEqual(global.__smoke.reports, [
			{
				reporter: "legacy",
				attemptedBundle: "next",
				actualBundle: "legacy",
				fallback: true,
				hasError: true,
			},
		]);
		// Keep the fetch stub installed long enough for an incorrectly delayed
		// refresh to reach the network boundary before asserting its absence.
		await new Promise((resolve) => setTimeout(resolve, 100));
		// Settle a refresh if the loader incorrectly launched one. With the old
		// ordering it would now promote COHORT_STATE_KEY back to next.
		if (decideCalls(fetchCalls).length > 0) {
			failedNextRefresh.resolve();
			await flushAsyncWork();
		}
		assert.equal(
			decideCalls(fetchCalls).length,
			0,
			"crash fallback must not refresh the failed cohort",
		);
		assert.equal(context.globalState._dump()["cline.rollout.bundle"], "legacy");
	},
);

await runScenario(
	"loader_decision capture carries the loader-side metadata",
	{
		env: { CLINE_BUNDLE_OVERRIDE: "next" },
		telemetryEnabled: true,
		contextPackageJSON: { name: "claude-dev" },
	},
	async ({ fetchCalls }) => {
		await waitFor(
			() => loaderDecisionCaptures(fetchCalls).length > 0,
			"loader_decision capture never reached the network",
		);
		const captures = loaderDecisionCaptures(fetchCalls);
		assert.equal(captures.length, 1);
		const [capture] = captures;
		assert.equal(capture.event, "extension.rollout.loader_decision");
		assert.equal(capture.properties.bundle, "next");
		assert.equal(capture.properties.attempted_bundle, "next");
		assert.equal(capture.properties.fallback, false);
		assert.equal(capture.properties.override, "env");
		assert.equal(capture.properties.loader_version, "4.1.0-smoke");
		assert.equal(capture.properties.extension_name, "claude-dev");
	},
);

await runScenario(
	"crash fallback captures exactly one loader_decision event",
	{
		seed: { "cline.rollout.bundle": "next" },
		nextThrows: true,
		telemetryEnabled: true,
		expectRefresh: false,
	},
	async ({ fetchCalls }) => {
		await waitFor(
			() => loaderDecisionCaptures(fetchCalls).length > 0,
			"fallback loader_decision capture never reached the network",
		);
		// Give an incorrect second capture (the pre-fix fallback:false event from
		// the recursive legacy success) time to reach the network before counting.
		await new Promise((resolve) => setTimeout(resolve, 100));
		const captures = loaderDecisionCaptures(fetchCalls);
		assert.equal(
			captures.length,
			1,
			"fallback must emit exactly ONE loader event (regression: duplicate fallback:false event)",
		);
		const [capture] = captures;
		assert.equal(capture.event, "extension.rollout.loader_decision");
		assert.equal(capture.properties.bundle, "legacy");
		assert.equal(capture.properties.attempted_bundle, "next");
		assert.equal(capture.properties.fallback, true);
		assert.match(capture.properties.error_message, /next activation exploded/);
	},
);

await runScenario(
	"a bundle without the reportRolloutActivation export still activates",
	{ omitReportExport: true },
	async ({ api }) => {
		assert.deepEqual(api, { bundle: "legacy" });
		assert.deepEqual(global.__smoke.reports, []);
	},
);

await runScenario(
	"nightly identity: namespaced setting + context key, status bar indicator",
	{
		contextPackageJSON: { name: "cline-nightly" },
		settings: { "cline-nightly.rollout.bundleOverride": "next" },
	},
	async ({ api, context }) => {
		assert.deepEqual(api, { bundle: "next" });
		assert.deepEqual(executedCommands[0], [
			"setContext",
			"cline-nightly.sdkBundle",
			true,
		]);
		assert.equal(statusBarItems.length, 1);
		const [item] = statusBarItems;
		assert.equal(item.shown, true);
		assert.equal(item.text, "Cline: Next");
		assert.match(item.tooltip, /bundleOverride setting/);
		assert.ok(
			context.subscriptions.includes(item),
			"indicator must be disposed with the extension",
		);
	},
);

await runScenario(
	"double failure: both bundles throw, loader reports and rethrows",
	{
		seed: { "cline.rollout.bundle": "next" },
		nextThrows: true,
		legacyThrows: true,
		telemetryEnabled: true,
		expectFailure: true,
		expectRefresh: false,
	},
	async ({ activationError, fetchCalls }) => {
		assert.match(String(activationError), /legacy activation exploded/);
		assert.deepEqual(
			global.__smoke.reports,
			[],
			"no bundle survived to report the authoritative event",
		);
		await waitFor(
			() => loaderDecisionCaptures(fetchCalls).length >= 2,
			"double failure should capture the fallback AND the double_failure events",
		);
		const captures = loaderDecisionCaptures(fetchCalls);
		assert.equal(captures.length, 2);
		for (const capture of captures) {
			assert.equal(capture.event, "extension.rollout.loader_decision");
			assert.equal(capture.properties.fallback, true);
		}
		const doubleFailure = captures.find(
			(c) => c.properties.double_failure === true,
		);
		assert.ok(doubleFailure, "one capture must be flagged double_failure");
		assert.equal(doubleFailure.properties.attempted_bundle, "next");
		assert.match(
			doubleFailure.properties.error_message,
			/legacy activation exploded/,
		);
	},
);

await runScenario(
	"deactivate delegates to active bundle",
	{},
	async () => {},
	async () => {
		assert.deepEqual(global.__smoke.deactivated, ["legacy"]);
	},
);

console.log("\nall loader smoke scenarios passed");
