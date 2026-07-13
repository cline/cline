/**
 * Generate the combined VSIX's package.json as the UNION of the two bundles'
 * manifests, regenerated from both branches' actual package.json files at
 * stitch time so contribution drift between branches can't ship silently.
 *
 * Rules:
 * - Identity/top-level fields come from the next (main) manifest.
 * - `main` points at the loader; `version` comes from the release input.
 * - commands / menus / keybindings / activationEvents / icons are unioned.
 *   Menu entries and keybindings present in only ONE manifest get their
 *   `when` clause AND-ed with the `cline.sdkBundle` context key (set by the
 *   loader before activation), so a cohort never sees a button whose handler
 *   its bundle doesn't register — and shared buttons that moved position
 *   don't show up twice. Commands exclusive to one bundle are likewise hidden
 *   from the other cohort's command palette.
 * - views / viewsContainers / configuration / walkthroughs / engines MUST be
 *   identical in both manifests — they can't be safely gated at runtime, so
 *   divergence is a hard error.
 *
 * Usage: node gen-manifest.mjs --next <pkg.json> --legacy <pkg.json> --version <x.y.z> [--out <file>]
 */

import { deepStrictEqual } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";

export function generateManifest(nextPkg, legacyPkg, version) {
	for (const field of ["name", "publisher", "main"]) {
		if (nextPkg[field] !== legacyPkg[field]) {
			throw new Error(
				`manifest field "${field}" differs: ${nextPkg[field]} vs ${legacyPkg[field]}`,
			);
		}
	}
	for (const field of [
		"views",
		"viewsContainers",
		"configuration",
		"walkthroughs",
	]) {
		try {
			deepStrictEqual(
				nextPkg.contributes?.[field],
				legacyPkg.contributes?.[field],
			);
		} catch {
			throw new Error(
				`contributes.${field} diverged between bundles — it cannot be gated at runtime; reconcile the branches`,
			);
		}
	}
	try {
		deepStrictEqual(nextPkg.engines, legacyPkg.engines);
	} catch {
		throw new Error(
			`engines diverged: ${JSON.stringify(nextPkg.engines)} vs ${JSON.stringify(legacyPkg.engines)}`,
		);
	}

	const nc = nextPkg.contributes ?? {};
	const lc = legacyPkg.contributes ?? {};
	const menus = unionMenus(nc.menus, lc.menus);
	hideExclusiveCommandsFromPalette(menus, nc.commands, lc.commands);

	const manifest = {
		name: nextPkg.name,
		displayName: nextPkg.displayName,
		description: nextPkg.description,
		version,
		icon: nextPkg.icon,
		engines: nextPkg.engines,
		author: nextPkg.author,
		license: nextPkg.license,
		publisher: nextPkg.publisher,
		repository: nextPkg.repository,
		homepage: nextPkg.homepage,
		categories: nextPkg.categories,
		keywords: nextPkg.keywords,
		activationEvents: unionPrimitive(
			nextPkg.activationEvents,
			legacyPkg.activationEvents,
		),
		main: "./extension.js",
		contributes: {
			viewsContainers: nc.viewsContainers,
			views: nc.views,
			commands: unionBy(
				[...(nc.commands ?? []), ...(lc.commands ?? [])],
				(c) => c.command,
			),
			keybindings: unionGated(nc.keybindings, lc.keybindings),
			menus,
			icons: unionIcons(nc.icons, lc.icons),
			configuration: nc.configuration,
			walkthroughs: nc.walkthroughs,
		},
		scripts: {},
	};

	assertSuperset(manifest, nextPkg, "next", NEXT_GATE);
	assertSuperset(manifest, legacyPkg, "legacy", LEGACY_GATE);
	return manifest;
}

/**
 * Context key the loader sets (via setContext) before activating a bundle.
 * true => next bundle. Keep in sync with src/extension.ts.
 */
const COHORT_CONTEXT_KEY = "cline.sdkBundle";
const NEXT_GATE = COHORT_CONTEXT_KEY;
const LEGACY_GATE = `!${COHORT_CONTEXT_KEY}`;

function unionPrimitive(a = [], b = []) {
	return [...new Set([...a, ...b])];
}

/** Union keeping first occurrence per key (next wins on shared ids). */
function unionBy(items, keyFn) {
	const seen = new Map();
	for (const item of items) {
		const key = keyFn(item);
		if (!seen.has(key)) {
			seen.set(key, item);
		}
	}
	return [...seen.values()];
}

function sortKeysDeep(value) {
	if (Array.isArray(value)) {
		return value.map(sortKeysDeep);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, sortKeysDeep(value[key])]),
		);
	}
	return value;
}

function stableJson(value) {
	return JSON.stringify(sortKeysDeep(value));
}

function gateWhen(entry, gate) {
	return { ...entry, when: entry.when ? `(${entry.when}) && ${gate}` : gate };
}

/**
 * Union two entry lists (menu entries or keybindings): entries declared by
 * both bundles pass through untouched; entries declared by only one get their
 * `when` AND-ed with that bundle's cohort gate.
 */
function unionGated(nextEntries = [], legacyEntries = []) {
	const nextSet = new Set(nextEntries.map(stableJson));
	const legacySet = new Set(legacyEntries.map(stableJson));
	const entries = [];
	for (const entry of nextEntries) {
		entries.push(
			legacySet.has(stableJson(entry)) ? entry : gateWhen(entry, NEXT_GATE),
		);
	}
	for (const entry of legacyEntries) {
		if (!nextSet.has(stableJson(entry))) {
			entries.push(gateWhen(entry, LEGACY_GATE));
		}
	}
	return entries;
}

function unionMenus(a = {}, b = {}) {
	const menus = {};
	for (const location of new Set([...Object.keys(a), ...Object.keys(b)])) {
		menus[location] = unionGated(a[location], b[location]);
	}
	return menus;
}

/**
 * A command declared by only one bundle would surface in the other cohort's
 * command palette with no registered handler ("command not found" on run).
 * Hide it there unless that bundle's own manifest already constrains it.
 */
function hideExclusiveCommandsFromPalette(
	menus,
	nextCommands = [],
	legacyCommands = [],
) {
	const nextIds = new Set(nextCommands.map((c) => c.command));
	const legacyIds = new Set(legacyCommands.map((c) => c.command));
	const palette = menus.commandPalette ?? (menus.commandPalette = []);
	const alreadyListed = new Set(palette.map((e) => e.command));
	for (const id of nextIds) {
		if (!legacyIds.has(id) && !alreadyListed.has(id)) {
			palette.push({ command: id, when: NEXT_GATE });
		}
	}
	for (const id of legacyIds) {
		if (!nextIds.has(id) && !alreadyListed.has(id)) {
			palette.push({ command: id, when: LEGACY_GATE });
		}
	}
}

function unionIcons(a = {}, b = {}) {
	const icons = { ...b, ...a };
	for (const id of Object.keys(icons)) {
		if (a[id] && b[id] && JSON.stringify(a[id]) !== JSON.stringify(b[id])) {
			throw new Error(
				`contributes.icons["${id}"] diverged between bundles — icon fonts resolve from the VSIX root`,
			);
		}
	}
	return icons;
}

/**
 * Every command/keybinding/menu entry/activation event a bundle declares must
 * survive the union, either verbatim or with its `when` AND-ed with that
 * bundle's cohort gate.
 */
function assertSuperset(manifest, sourcePkg, label, gate) {
	const missing = [];
	const commandIds = new Set(
		manifest.contributes.commands.map((c) => c.command),
	);
	for (const cmd of sourcePkg.contributes?.commands ?? []) {
		if (!commandIds.has(cmd.command)) {
			missing.push(`command ${cmd.command}`);
		}
	}
	for (const event of sourcePkg.activationEvents ?? []) {
		if (!manifest.activationEvents.includes(event)) {
			missing.push(`activationEvent ${event}`);
		}
	}
	const presentOrGated = (unionEntries, entry) => {
		const set = new Set((unionEntries ?? []).map(stableJson));
		return (
			set.has(stableJson(entry)) || set.has(stableJson(gateWhen(entry, gate)))
		);
	};
	for (const kb of sourcePkg.contributes?.keybindings ?? []) {
		if (!presentOrGated(manifest.contributes.keybindings, kb)) {
			missing.push(`keybinding ${kb.command}`);
		}
	}
	for (const [location, entries] of Object.entries(
		sourcePkg.contributes?.menus ?? {},
	)) {
		for (const entry of entries) {
			if (!presentOrGated(manifest.contributes.menus[location], entry)) {
				missing.push(
					`menu ${location}: ${entry.command ?? JSON.stringify(entry)}`,
				);
			}
		}
	}
	if (missing.length > 0) {
		throw new Error(
			`union manifest is missing ${label} contributions:\n  ${missing.join("\n  ")}`,
		);
	}
}

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i += 2) {
		args[argv[i].replace(/^--/, "")] = argv[i + 1];
	}
	return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const { next, legacy, version, out } = parseArgs(process.argv);
	if (!next || !legacy || !version) {
		console.error(
			"usage: gen-manifest.mjs --next <pkg.json> --legacy <pkg.json> --version <x.y.z> [--out <file>]",
		);
		process.exit(1);
	}
	const manifest = generateManifest(
		JSON.parse(readFileSync(next, "utf8")),
		JSON.parse(readFileSync(legacy, "utf8")),
		version,
	);
	const json = `${JSON.stringify(manifest, null, "\t")}\n`;
	if (out) {
		writeFileSync(out, json);
		console.log(`wrote ${out}`);
	} else {
		process.stdout.write(json);
	}
}
