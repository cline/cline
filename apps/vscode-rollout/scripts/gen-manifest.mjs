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
 *   `when` clause AND-ed with the `<prefix>.sdkBundle` context key (set by the
 *   loader before activation; prefix follows the manifest identity — see
 *   src/cohort.ts idPrefix), so a cohort never sees a button whose handler
 *   its bundle doesn't register — and shared buttons that moved position
 *   don't show up twice. Commands exclusive to one bundle are likewise hidden
 *   from the other cohort's command palette.
 * - views / viewsContainers / configuration / engines MUST be
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
	for (const field of ["views", "viewsContainers", "configuration"]) {
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
	const engines = unionEngines(nextPkg.engines, legacyPkg.engines);

	assertWalkthroughsCompatible(
		nextPkg.contributes?.walkthroughs,
		legacyPkg.contributes?.walkthroughs,
	);

	// The nightly packaging rewrites the whole `cline.*` ID namespace to
	// `cline-nightly.*` (scripts/nightlify.mjs), so the context key and the
	// injected setting must follow the manifest's identity. Keep in sync with
	// idPrefix/bundleContextKey/settingSection in src/cohort.ts.
	const prefix = nextPkg.name === "cline-nightly" ? "cline-nightly" : "cline";
	const nextGate = `${prefix}.sdkBundle`;
	const legacyGate = `!${nextGate}`;

	const nc = nextPkg.contributes ?? {};
	const lc = legacyPkg.contributes ?? {};
	const menus = unionMenus(nc.menus, lc.menus, nextGate, legacyGate);
	hideExclusiveCommandsFromPalette(
		menus,
		nc.commands,
		lc.commands,
		nextGate,
		legacyGate,
	);

	const manifest = {
		name: nextPkg.name,
		displayName: nextPkg.displayName,
		description: nextPkg.description,
		version,
		icon: nextPkg.icon,
		engines,
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
			keybindings: unionGated(
				nc.keybindings,
				lc.keybindings,
				nextGate,
				legacyGate,
			),
			menus,
			icons: unionIcons(nc.icons, lc.icons),
			configuration: injectLoaderConfiguration(nc.configuration, prefix),
			walkthroughs: nc.walkthroughs,
		},
		scripts: {},
	};

	assertSuperset(manifest, nextPkg, "next", nextGate);
	assertSuperset(manifest, legacyPkg, "legacy", legacyGate);
	return manifest;
}

/**
 * The loader's own user-visible escape hatch, keyed by the manifest identity.
 * Neither bundle knows about it; only the loader reads it (src/cohort.ts
 * settingSection/SETTING_BUNDLE_OVERRIDE — keep the key and values in sync).
 * Injected after the configuration-equality invariant so it can't mask real
 * drift between the bundles.
 */
function loaderSettings(prefix) {
	return {
		[`${prefix}.rollout.bundleOverride`]: {
			type: "string",
			enum: ["auto", "next", "legacy"],
			enumDescriptions: [
				"Follow the remote rollout assignment.",
				"Force the new (SDK-based) extension.",
				"Force the previous (legacy) extension.",
			],
			default: "auto",
			scope: "application",
			markdownDescription:
				"Manual override for Cline's staged extension rollout. `next` forces the new (SDK-based) extension, `legacy` forces the previous one, `auto` follows the remote rollout. Beats the remote kill-switch in both directions. Takes effect on window reload.",
		},
	};
}

function injectLoaderConfiguration(configuration, prefix) {
	const properties = { ...(configuration?.properties ?? {}) };
	for (const [key, schema] of Object.entries(loaderSettings(prefix))) {
		if (properties[key]) {
			throw new Error(
				`bundle manifests must not declare loader-owned setting ${key}`,
			);
		}
		properties[key] = schema;
	}
	return { title: "Cline", ...(configuration ?? {}), properties };
}

/**
 * Walkthroughs can't be gated per cohort, and their markdown at the VSIX root
 * always comes from the next checkout — so requiring byte-identical manifests
 * here would brick releases over copy tweaks while protecting nothing. Only
 * STRUCTURE must match (walkthrough/step ids, media paths, completion events —
 * the parts code and the manifest reference); when titles/descriptions
 * diverge, next's copy ships for everyone and the build says so.
 */
function assertWalkthroughsCompatible(next = [], legacy = []) {
	const structure = (walkthroughs) =>
		walkthroughs.map((walkthrough) => ({
			id: walkthrough.id,
			steps: (walkthrough.steps ?? []).map((step) => ({
				id: step.id,
				media: step.media,
				completionEvents: step.completionEvents,
				when: step.when,
			})),
		}));
	try {
		deepStrictEqual(structure(next), structure(legacy));
	} catch {
		throw new Error(
			"contributes.walkthroughs diverged structurally (ids/media/completionEvents) — reconcile the branches",
		);
	}
	try {
		deepStrictEqual(next, legacy);
	} catch {
		console.warn(
			"warning: walkthrough titles/descriptions differ between bundles; shipping next's copy for both cohorts",
		);
	}
}

/**
 * Engines can safely diverge in ONE direction: the union requires whichever
 * bundle needs the NEWER host, which necessarily satisfies the other bundle's
 * older requirement too. (main routinely bumps the VS Code engine ahead of the
 * legacy branch — an equality assertion here would brick every combined build
 * over that.) Non-caret/complex ranges we can't compare fail hard rather than
 * guessing.
 */
function unionEngines(nextEngines = {}, legacyEngines = {}) {
	const union = {};
	for (const key of new Set([
		...Object.keys(nextEngines),
		...Object.keys(legacyEngines),
	])) {
		const a = nextEngines[key];
		const b = legacyEngines[key];
		if (a === undefined || b === undefined || a === b) {
			union[key] = a ?? b;
			continue;
		}
		const minimum = (range) => {
			const match = /^\^(\d+(?:\.\d+)*)$/.exec(range);
			return match?.[1];
		};
		const [minA, minB] = [minimum(a), minimum(b)];
		if (!minA || !minB) {
			throw new Error(
				`engines.${key} diverged with uncomparable ranges: ${a} vs ${b}`,
			);
		}
		union[key] = compareDotted(minA, minB) >= 0 ? a : b;
		console.warn(
			`warning: engines.${key} differs between bundles (next ${a}, legacy ${b}); union requires ${union[key]}`,
		);
	}
	return union;
}

/** Compare dotted numeric versions; mirrors compareVersions in src/cohort.ts. */
function compareDotted(a, b) {
	const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
	const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) {
			return diff;
		}
	}
	return 0;
}

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
function unionGated(
	nextEntries = [],
	legacyEntries = [],
	nextGate,
	legacyGate,
) {
	const nextSet = new Set(nextEntries.map(stableJson));
	const legacySet = new Set(legacyEntries.map(stableJson));
	const entries = [];
	for (const entry of nextEntries) {
		entries.push(
			legacySet.has(stableJson(entry)) ? entry : gateWhen(entry, nextGate),
		);
	}
	for (const entry of legacyEntries) {
		if (!nextSet.has(stableJson(entry))) {
			entries.push(gateWhen(entry, legacyGate));
		}
	}
	return entries;
}

function unionMenus(a = {}, b = {}, nextGate, legacyGate) {
	const menus = {};
	for (const location of new Set([...Object.keys(a), ...Object.keys(b)])) {
		menus[location] = unionGated(
			a[location],
			b[location],
			nextGate,
			legacyGate,
		);
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
	nextGate,
	legacyGate,
) {
	const nextIds = new Set(nextCommands.map((c) => c.command));
	const legacyIds = new Set(legacyCommands.map((c) => c.command));
	const palette = menus.commandPalette ?? (menus.commandPalette = []);
	const alreadyListed = new Set(palette.map((e) => e.command));
	for (const id of nextIds) {
		if (!legacyIds.has(id) && !alreadyListed.has(id)) {
			palette.push({ command: id, when: nextGate });
		}
	}
	for (const id of legacyIds) {
		if (!nextIds.has(id) && !alreadyListed.has(id)) {
			palette.push({ command: id, when: legacyGate });
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
