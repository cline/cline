/**
 * Node-level smoke test for the built loader against a staged VSIX directory.
 * No real VS Code: `vscode` is stubbed just enough for the loader itself, and
 * the staging dir's next/legacy bundles are swapped for tiny recorders. Verifies
 * the loader's end-to-end behavior in a real require() environment:
 *   1. default (no cached cohort)      -> activates legacy
 *   2. cached cohort "next"            -> activates next, scoped context paths
 *   3. versioned kill-switch           -> demotes in-scope versions only
 *      (including the pre-versioning boolean cache format), and a refresh
 *      caches the payload's maxKilledVersion for the next window
 *   4. CLINE_BUNDLE_OVERRIDE / the cline.rollout.bundleOverride setting
 *      force a bundle in either direction, past the kill-switch
 *   5. next activation throws          -> disposes partial registrations, falls
 *                                         back to legacy, pins version, and
 *                                         skips the cohort refresh
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
function makeVscodeStub(sandbox, settings = {}) {
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
		env: { machineId: "smoke-machine", isTelemetryEnabled: false },
		version: "0.0.0-smoke",
		_sandbox: sandbox,
	};
}

function makeContext(sandbox, globalStateSeed = {}) {
	const state = new Map(Object.entries(globalStateSeed));
	return {
		extensionUri: { fsPath: sandbox, path: sandbox, scheme: "file" },
		extensionPath: sandbox,
		extension: { packageJSON: { version: "4.1.0-smoke" } },
		subscriptions: [],
		globalState: {
			get: (key) => state.get(key),
			update: async (key, value) => void state.set(key, value),
			_dump: () => Object.fromEntries(state),
		},
		asAbsolutePath: (rel) => path.join(sandbox, rel),
	};
}

function flagResponse(flags = { rollout: false, killswitch: false }) {
	return {
		ok: true,
		json: async () => ({
			featureFlags: {
				"ext-sdk-bundle-rollout": flags.rollout,
				"ext-sdk-bundle-killswitch": flags.killswitch,
			},
			// PostHog /decide delivers payloads as JSON-encoded strings.
			featureFlagPayloads: flags.killswitchPayload
				? {
						"ext-sdk-bundle-killswitch": JSON.stringify(
							flags.killswitchPayload,
						),
					}
				: {},
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
function makeSandbox({ nextThrows = false } = {}) {
	const sandbox = mkdtempSync(path.join(tmpdir(), "cline-ab-smoke-"));
	cpSync(
		path.join(staging, "extension.js"),
		path.join(sandbox, "extension.js"),
	);
	for (const bundle of ["next", "legacy"]) {
		mkdirSync(path.join(sandbox, bundle, "dist"), { recursive: true });
		const throwLine =
			bundle === "next" && nextThrows
				? `await global.__smoke.beforeNextFailure?.();\n\t\tctx.subscriptions.push({ dispose() { global.__smoke.disposed.push("${bundle}") } });\n\t\tthrow new Error("smoke: next activation exploded");`
				: "";
		writeFileSync(
			path.join(sandbox, bundle, "dist", "extension.js"),
			`exports.activate = async (ctx) => {
		${throwLine}
		global.__smoke.activated.push({ bundle: "${bundle}", extensionPath: ctx.extensionPath, asAbs: ctx.asAbsolutePath("webview-ui/build") });
		return { bundle: "${bundle}" };
	};
	exports.deactivate = () => { global.__smoke.deactivated.push("${bundle}"); };`,
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
		fetchController = makeFlagFetch(),
		beforeNextFailure,
		expectRefresh = true,
	},
	checks,
	afterDeactivateChecks = async () => {},
) {
	const sandbox = makeSandbox({ nextThrows });
	global.__smoke = {
		activated: [],
		deactivated: [],
		disposed: [],
		beforeNextFailure,
	};
	executedCommands.length = 0;

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
		exports: makeVscodeStub(sandbox, settings),
	};

	try {
		const loaderPath = path.join(sandbox, "extension.js");
		delete require.cache[loaderPath];
		const loader = require(loaderPath);
		const context = makeContext(sandbox, seed);
		const api = await loader.activate(context);
		if (expectRefresh) {
			await waitFor(
				() => fetchController.calls.length > 0,
				`${name} did not refresh its cohort after activation`,
			);
			await flushAsyncWork();
			assert.equal(
				fetchController.calls.length,
				1,
				`${name} should refresh its cohort exactly once`,
			);
		}
		await checks({
			context,
			api,
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
	},
);

await runScenario(
	"kill-switch scoped to this version beats cached next",
	{
		seed: {
			"cline.rollout.bundle": "next",
			"cline.rollout.killswitch": "4.1.0",
		},
	},
	async ({ api }) => {
		assert.deepEqual(api, { bundle: "legacy" });
	},
);

await runScenario(
	"kill-switch scoped below this version does not apply",
	{
		seed: {
			"cline.rollout.bundle": "next",
			"cline.rollout.killswitch": "4.0.9",
		},
	},
	async ({ api }) => {
		assert.deepEqual(api, { bundle: "next" });
	},
);

await runScenario(
	"legacy boolean kill-switch cache still demotes",
	{
		seed: { "cline.rollout.bundle": "next", "cline.rollout.killswitch": true },
	},
	async ({ api }) => {
		assert.deepEqual(api, { bundle: "legacy" });
	},
);

await runScenario(
	"kill-switch payload from the flag refresh is cached for the next window",
	{
		seed: { "cline.rollout.bundle": "next" },
		fetchController: makeFlagFetch({
			rollout: true,
			killswitch: true,
			killswitchPayload: { maxKilledVersion: "4.1.2" },
		}),
	},
	async ({ context, api }) => {
		// This window already ran next; the refresh demotes the NEXT window.
		assert.deepEqual(api, { bundle: "next" });
		const state = context.globalState._dump();
		assert.equal(state["cline.rollout.killswitch"], "4.1.2");
		assert.equal(state["cline.rollout.bundle"], "legacy");
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
	"user setting overrides to next past an armed kill-switch",
	{
		seed: { "cline.rollout.killswitch": "*" },
		settings: { "cline.rollout.bundleOverride": "next" },
	},
	async ({ api }) => {
		assert.deepEqual(api, { bundle: "next" });
	},
);

const failedNextRefresh = makeDeferredFlagFetch({
	rollout: true,
	killswitch: false,
});
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
		// Keep the fetch stub installed long enough for an incorrectly delayed
		// refresh to reach the network boundary before asserting its absence.
		await new Promise((resolve) => setTimeout(resolve, 100));
		// Settle a refresh if the loader incorrectly launched one. With the old
		// ordering it would now promote COHORT_STATE_KEY back to next.
		if (fetchCalls.length > 0) {
			failedNextRefresh.resolve();
			await flushAsyncWork();
		}
		assert.equal(
			fetchCalls.length,
			0,
			"crash fallback must not refresh the failed cohort",
		);
		assert.equal(context.globalState._dump()["cline.rollout.bundle"], "legacy");
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
