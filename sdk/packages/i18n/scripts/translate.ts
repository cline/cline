#!/usr/bin/env bun
/**
 * LLM-backed catalog translator for @cline/i18n.
 *
 * English (src/locales/en) is the source of truth. For each target locale this
 * script finds keys that are missing (including per-language CLDR plural
 * forms), translates them with Claude, merges them into the locale's JSON
 * catalogs (sorted, so diffs stay reviewable), and regenerates src/resources.ts
 * so the locale is registered automatically.
 *
 * Usage (from sdk/packages/i18n):
 *   bun run translate                          # fill gaps in every registered locale
 *   bun run translate -- --lang ja             # add/update one locale (creates the folder)
 *   bun run translate -- --lang de --lang fr   # several locales
 *   bun run translate -- --check               # report missing keys, no API calls (exit 1 if any)
 *   bun run translate -- --regen               # only regenerate src/resources.ts
 *   bun run translate -- --lang es --retranslate history.filters
 *                                              # re-translate keys under a prefix (after en copy changes)
 *
 * Auth: uses ANTHROPIC_API_KEY or an `ant auth login` profile.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const PACKAGE_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const LOCALES_DIR = path.join(PACKAGE_ROOT, "src", "locales");
const RESOURCES_FILE = path.join(PACKAGE_ROOT, "src", "resources.ts");
const SOURCE_LOCALE = "en";
const MODEL = process.env.CLINE_I18N_MODEL ?? "claude-opus-5";
const CHUNK_SIZE = 40;
const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"];

/** Preferred native-script display names; anything else falls back to Intl.DisplayNames. */
const KNOWN_DISPLAY_NAMES: Record<string, string> = {
	ar: "العربية",
	cs: "Čeština",
	de: "Deutsch",
	en: "English",
	es: "Español",
	fr: "Français",
	hi: "हिन्दी",
	hu: "Magyar",
	it: "Italiano",
	ja: "日本語",
	ko: "한국어",
	pl: "Polski",
	"pt-BR": "Português (Brasil)",
	"pt-PT": "Português (Portugal)",
	ru: "Русский",
	tr: "Türkçe",
	"zh-CN": "简体中文",
	"zh-TW": "繁體中文",
};

type Flat = Record<string, string>;

// ---------- catalog helpers ----------

function flatten(value: unknown, prefix = "", out: Flat = {}): Flat {
	if (typeof value === "string") {
		out[prefix] = value;
		return out;
	}
	if (typeof value === "object" && value !== null) {
		for (const [key, child] of Object.entries(value)) {
			flatten(child, prefix ? `${prefix}.${key}` : key, out);
		}
	}
	return out;
}

function unflatten(flat: Flat): Record<string, unknown> {
	const root: Record<string, unknown> = {};
	for (const [flatKey, value] of Object.entries(flat)) {
		const parts = flatKey.split(".");
		let node = root;
		for (const part of parts.slice(0, -1)) {
			node = (node[part] ??= {}) as Record<string, unknown>;
		}
		node[parts.at(-1) as string] = value;
	}
	return root;
}

function sortDeep(value: unknown): unknown {
	if (typeof value !== "object" || value === null) {
		return value;
	}
	return Object.fromEntries(
		Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, child]) => [key, sortDeep(child)]),
	);
}

function splitPluralSuffix(key: string): {
	base: string;
	category: string | null;
} {
	const lastSegment = key.split(".").at(-1) as string;
	for (const suffix of PLURAL_SUFFIXES) {
		if (
			lastSegment.endsWith(`_${suffix}`) &&
			lastSegment.length > suffix.length + 1
		) {
			return {
				base: key.slice(0, key.length - suffix.length - 1),
				category: suffix,
			};
		}
	}
	return { base: key, category: null };
}

async function readCatalog(locale: string, namespace: string): Promise<Flat> {
	const file = path.join(LOCALES_DIR, locale, `${namespace}.json`);
	if (!existsSync(file)) {
		return {};
	}
	return flatten(JSON.parse(await readFile(file, "utf8")));
}

async function writeCatalog(
	locale: string,
	namespace: string,
	flat: Flat,
): Promise<void> {
	const dir = path.join(LOCALES_DIR, locale);
	await mkdir(dir, { recursive: true });
	const sorted = sortDeep(unflatten(flat));
	await writeFile(
		path.join(dir, `${namespace}.json`),
		`${JSON.stringify(sorted, null, "\t")}\n`,
	);
}

async function listLocales(): Promise<string[]> {
	const entries = await readdir(LOCALES_DIR, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));
}

async function listNamespaces(): Promise<string[]> {
	const entries = await readdir(path.join(LOCALES_DIR, SOURCE_LOCALE));
	return entries
		.filter((name) => name.endsWith(".json"))
		.map((name) => name.slice(0, -".json".length))
		.sort((a, b) => a.localeCompare(b));
}

// ---------- gap analysis ----------

type MissingEntry = {
	targetKey: string;
	sourceText: string;
	pluralCategory: string | null;
};

/**
 * Computes the keys the target locale still needs. Plural groups are expanded
 * to the target language's own CLDR cardinal categories (zh needs only _other,
 * ru needs _one/_few/_many/_other, ...), sourced from the closest English form.
 */
function computeMissing(
	source: Flat,
	target: Flat,
	locale: string,
	retranslatePrefix?: string,
): MissingEntry[] {
	const categories = new Intl.PluralRules(locale).resolvedOptions()
		.pluralCategories;
	const pluralGroups = new Map<string, Map<string, string>>();
	const plainKeys: string[] = [];

	for (const key of Object.keys(source)) {
		const { base, category } = splitPluralSuffix(key);
		if (category) {
			const group = pluralGroups.get(base) ?? new Map<string, string>();
			group.set(category, source[key]);
			pluralGroups.set(base, group);
		} else {
			plainKeys.push(key);
		}
	}

	const needed = (targetKey: string) =>
		!(targetKey in target) ||
		(retranslatePrefix !== undefined &&
			targetKey.startsWith(retranslatePrefix));

	const missing: MissingEntry[] = [];
	for (const key of plainKeys) {
		if (needed(key)) {
			missing.push({
				targetKey: key,
				sourceText: source[key],
				pluralCategory: null,
			});
		}
	}
	for (const [base, forms] of pluralGroups) {
		for (const category of categories) {
			const targetKey = `${base}_${category}`;
			if (!needed(targetKey)) {
				continue;
			}
			const sourceText =
				forms.get(category) ?? forms.get("other") ?? [...forms.values()][0];
			missing.push({ targetKey, sourceText, pluralCategory: category });
		}
	}
	return missing;
}

// ---------- translation ----------

function displayName(locale: string): string {
	return (
		KNOWN_DISPLAY_NAMES[locale] ??
		new Intl.DisplayNames([locale], { type: "language" }).of(locale) ??
		locale
	);
}

function englishName(locale: string): string {
	return (
		new Intl.DisplayNames(["en"], { type: "language" }).of(locale) ?? locale
	);
}

async function translateChunk(
	client: Anthropic,
	locale: string,
	namespace: string,
	entries: MissingEntry[],
): Promise<Flat> {
	const language = englishName(locale);
	const schema = {
		type: "object",
		properties: Object.fromEntries(
			entries.map((entry) => [entry.targetKey, { type: "string" }]),
		),
		required: entries.map((entry) => entry.targetKey),
		additionalProperties: false,
	};
	const payload = Object.fromEntries(
		entries.map((entry) => [
			entry.targetKey,
			entry.pluralCategory
				? {
						english: entry.sourceText,
						note: `CLDR plural category "${entry.pluralCategory}" of a count-based message`,
					}
				: { english: entry.sourceText },
		]),
	);

	const response = await client.messages.create({
		model: MODEL,
		max_tokens: 16000,
		system: [
			`You translate user-interface strings for Cline, an AI coding-agent extension for VS Code, from English into ${language} (locale ${locale}).`,
			"Rules:",
			`- Translate naturally and idiomatically for a software UI. Match the terminology of the official ${language} localization of VS Code where applicable.`,
			"- Keep i18next interpolation placeholders such as {{count}} exactly as they appear.",
			"- Keep product and technology names untranslated: Cline, VS Code, MCP, API, Git, Token (as the LLM-token unit where the language conventionally keeps it).",
			'- Preserve trailing ellipses ("...") and other meaningful punctuation.',
			"- For plural entries, produce the correct form for the stated CLDR plural category.",
			`- The strings belong to the "${namespace}" namespace of the UI.`,
		].join("\n"),
		messages: [
			{
				role: "user",
				content: `Translate the "english" value of every entry. Respond with one translation per key.\n\n${JSON.stringify(payload, null, 2)}`,
			},
		],
		output_config: { format: { type: "json_schema", schema } },
	});

	if (response.stop_reason === "refusal") {
		throw new Error(`Translation request refused for ${locale}/${namespace}`);
	}
	if (response.stop_reason === "max_tokens") {
		throw new Error(
			`Translation response truncated for ${locale}/${namespace} — lower CHUNK_SIZE`,
		);
	}
	const text = response.content.find((block) => block.type === "text")?.text;
	if (!text) {
		throw new Error(`Empty translation response for ${locale}/${namespace}`);
	}
	return JSON.parse(text) as Flat;
}

// ---------- resources.ts codegen ----------

function varName(locale: string, namespace: string): string {
	const localePart = locale.replace(/[^a-zA-Z0-9]/g, "");
	return `${localePart}${namespace[0].toUpperCase()}${namespace.slice(1)}`;
}

function keyLiteral(key: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

async function regenResources(): Promise<void> {
	const locales = await listLocales();
	const namespaces = await listNamespaces();

	const lines: string[] = [
		"// GENERATED FILE — do not edit by hand. Regenerate with `bun run translate -- --regen`",
		"// (from sdk/packages/i18n). Locales and namespaces are discovered from",
		"// src/locales/<locale>/<namespace>.json; new languages are registered here automatically.",
	];
	for (const locale of locales) {
		for (const namespace of namespaces) {
			lines.push(
				`import ${varName(locale, namespace)} from "./locales/${locale}/${namespace}.json";`,
			);
		}
	}
	lines.push("");
	lines.push(
		`export const NAMESPACES = [${namespaces.map((ns) => JSON.stringify(ns)).join(", ")}] as const;`,
	);
	lines.push("export type Namespace = (typeof NAMESPACES)[number];");
	lines.push("");
	lines.push("/** Native-script display names for the language picker. */");
	lines.push("export const LOCALE_DISPLAY_NAMES = {");
	for (const locale of locales) {
		lines.push(
			`\t${keyLiteral(locale)}: ${JSON.stringify(displayName(locale))},`,
		);
	}
	lines.push("};");
	lines.push("");
	lines.push(
		"/** All message catalogs, keyed by locale then namespace. English is the source catalog. */",
	);
	lines.push("export const resources = {");
	for (const locale of locales) {
		lines.push(`\t${keyLiteral(locale)}: {`);
		for (const namespace of namespaces) {
			lines.push(`\t\t${namespace}: ${varName(locale, namespace)},`);
		}
		lines.push("\t},");
	}
	lines.push("} as const;");
	lines.push("");

	await writeFile(RESOURCES_FILE, lines.join("\n"));
	// Normalize to the repo's Biome style so --regen never causes format churn.
	try {
		const { execSync } = await import("node:child_process");
		execSync(`bunx biome format --write ${JSON.stringify(RESOURCES_FILE)}`, {
			cwd: PACKAGE_ROOT,
			stdio: "ignore",
		});
	} catch {
		// biome unavailable — the emitted file is already close to the house style
	}
	console.log(
		`Regenerated ${path.relative(PACKAGE_ROOT, RESOURCES_FILE)} (${locales.join(", ")})`,
	);
}

// ---------- main ----------

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const targetLocales: string[] = [];
	let check = false;
	let regenOnly = false;
	let retranslatePrefix: string | undefined;
	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--lang":
				targetLocales.push(args[++i]);
				break;
			case "--check":
				check = true;
				break;
			case "--regen":
				regenOnly = true;
				break;
			case "--retranslate":
				retranslatePrefix = args[++i];
				break;
			default:
				throw new Error(`Unknown argument: ${args[i]}`);
		}
	}

	if (regenOnly) {
		await regenResources();
		return;
	}

	const namespaces = await listNamespaces();
	const locales = (
		targetLocales.length > 0 ? targetLocales : await listLocales()
	).filter((locale) => locale !== SOURCE_LOCALE);

	let totalMissing = 0;
	const client = check ? null : new Anthropic();

	for (const locale of locales) {
		for (const namespace of namespaces) {
			const source = await readCatalog(SOURCE_LOCALE, namespace);
			const target = await readCatalog(locale, namespace);
			const missing = computeMissing(source, target, locale, retranslatePrefix);
			totalMissing += missing.length;
			if (missing.length === 0) {
				continue;
			}
			if (check) {
				console.log(
					`${locale}/${namespace}: ${missing.length} missing (${missing.map((m) => m.targetKey).join(", ")})`,
				);
				continue;
			}
			console.log(
				`${locale}/${namespace}: translating ${missing.length} strings with ${MODEL}...`,
			);
			for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
				const chunk = missing.slice(i, i + CHUNK_SIZE);
				const translated = await translateChunk(
					client as Anthropic,
					locale,
					namespace,
					chunk,
				);
				Object.assign(target, translated);
			}
			await writeCatalog(locale, namespace, target);
		}
	}

	if (check) {
		if (totalMissing > 0) {
			console.error(
				`\n${totalMissing} missing translations. Run \`bun run translate\` to fill them.`,
			);
			process.exit(1);
		}
		console.log("All catalogs are complete.");
		return;
	}

	await regenResources();
	if (totalMissing > 0) {
		console.log(
			`\nTranslated ${totalMissing} strings. Review the diffs, then run \`bun run test\` for parity checks.`,
		);
	} else {
		console.log("Nothing to translate — all catalogs are complete.");
	}
}

await main();
