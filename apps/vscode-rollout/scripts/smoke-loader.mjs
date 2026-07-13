/**
 * Node-level smoke test for the built loader against a staged VSIX directory.
 * No real VS Code: `vscode` is stubbed just enough for the loader itself, and
 * the staging dir's next/legacy bundles are swapped for tiny recorders. Verifies
 * the loader's end-to-end behavior in a real require() environment:
 *   1. default (no cached cohort)      -> activates legacy
 *   2. cached cohort "next"            -> activates next, scoped context paths
 *   3. kill-switch cached              -> activates legacy despite cached next
 *   4. CLINE_BUNDLE_OVERRIDE=next      -> activates next
 *   5. next activation throws          -> disposes partial registrations, falls
 *                                         back to legacy, pins version
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
function makeVscodeStub(sandbox) {
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
				? `ctx.subscriptions.push({ dispose() { global.__smoke.disposed.push("${bundle}") } });\n\t\tthrow new Error("smoke: next activation exploded");`
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
	return sandbox;
}

async function runScenario(
	name,
	{ seed = {}, env = {}, nextThrows = false },
	checks,
) {
	const sandbox = makeSandbox({ nextThrows });
	global.__smoke = { activated: [], deactivated: [], disposed: [] };
	executedCommands.length = 0;

	const previousEnv = {};
	for (const [key, value] of Object.entries(env)) {
		previousEnv[key] = process.env[key];
		process.env[key] = value;
	}
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
		exports: makeVscodeStub(sandbox),
	};

	try {
		const loaderPath = path.join(sandbox, "extension.js");
		delete require.cache[loaderPath];
		const loader = require(loaderPath);
		const context = makeContext(sandbox, seed);
		const api = await loader.activate(context);
		await checks({ context, api, sandbox });
		await loader.deactivate();
		console.log(`PASS ${name}`);
	} finally {
		Module._resolveFilename = originalResolve;
		delete require.cache.vscode;
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
	"kill-switch beats cached next",
	{
		seed: { "cline.rollout.bundle": "next", "cline.rollout.killswitch": true },
	},
	async ({ api }) => {
		assert.deepEqual(api, { bundle: "legacy" });
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
	"next activation failure falls back to legacy",
	{ seed: { "cline.rollout.bundle": "next" }, nextThrows: true },
	async ({ context, api }) => {
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
	},
);

// deactivate() delegates to the active bundle
{
	const sandbox = makeSandbox();
	global.__smoke = { activated: [], deactivated: [], disposed: [] };
	const originalResolve = Module._resolveFilename;
	Module._resolveFilename = function (request, ...rest) {
		return request === "vscode"
			? "vscode"
			: originalResolve.call(this, request, ...rest);
	};
	require.cache.vscode = {
		id: "vscode",
		filename: "vscode",
		loaded: true,
		exports: makeVscodeStub(sandbox),
	};
	try {
		const loaderPath = path.join(sandbox, "extension.js");
		delete require.cache[loaderPath];
		const loader = require(loaderPath);
		await loader.activate(makeContext(sandbox));
		await loader.deactivate();
		assert.deepEqual(global.__smoke.deactivated, ["legacy"]);
		console.log("PASS deactivate delegates to active bundle");
	} finally {
		Module._resolveFilename = originalResolve;
		delete require.cache.vscode;
		rmSync(sandbox, { recursive: true, force: true });
	}
}

console.log("\nall loader smoke scenarios passed");
