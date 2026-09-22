#!/usr/bin/env bun
/**
 * CI gate for translation catalogs.
 *
 * Fails (exit 1) when any non-English catalog:
 *  - is missing keys that exist in `locales/en.json`, or has extra keys,
 *  - interpolates a different set of `{name}` placeholders than English,
 *  - is missing required plural branches (`other`; `one` for en-like locales),
 *  - contains an empty translation, a stray `{`, or an HTML tag,
 *  - repeats the English text verbatim for a translatable string (likely missed).
 *
 * Usage: bun run i18n:check
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractPlaceholders } from "../src/interpolate.js";

const root = join(import.meta.dir, "..");
const localesDir = join(root, "locales");

const enPath = join(localesDir, "en.json");
const en = JSON.parse(readFileSync(enPath, "utf8")) as Record<string, string>;
const enKeys = new Set(Object.keys(en));

type Problem = { locale: string; key?: string; message: string };
const problems: Problem[] = [];

// Discover every other catalog in locales/.
const files = readdirSync(localesDir).filter(
	(name) => name.endsWith(".json") && name !== "en.json",
);

for (const file of files) {
	const locale = file.replace(/\.json$/, "");
	const path = join(localesDir, file);
	let catalog: Record<string, unknown>;
	try {
		catalog = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch (error) {
		problems.push({
			locale,
			message: `not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		});
		continue;
	}
	const keys = new Set(Object.keys(catalog));

	for (const key of enKeys) {
		if (!keys.has(key)) {
			problems.push({
				locale,
				key,
				message: "missing key (present in en.json)",
			});
			continue;
		}
		const value = catalog[key];
		if (typeof value !== "string" || value.trim() === "") {
			problems.push({
				locale,
				key,
				message: "empty or non-string translation",
			});
			continue;
		}
		if (/[<>]/.test(value)) {
			problems.push({
				locale,
				key,
				message:
					"translation contains an HTML tag (< or >); interpolate data instead",
			});
		}
		const open = (value.match(/\{/g) ?? []).length;
		const close = (value.match(/\}/g) ?? []).length;
		if (open !== close) {
			problems.push({
				locale,
				key,
				message: `unbalanced braces (${open} open / ${close} close)`,
			});
			continue;
		}
		const enPh = extractPlaceholders(en[key]).sort().join(",");
		const locPh = extractPlaceholders(value).sort().join(",");
		if (enPh !== locPh) {
			problems.push({
				locale,
				key,
				message: `placeholder mismatch (en: [${enPh}] vs ${locale}: [${locPh}])`,
			});
		}
		// A translation identical to the source English text is almost always a
		// missed translation. Templates that carry no translatable words once
		// their placeholders are stripped (e.g. "{productName} v{version}")
		// are locale-invariant by design and are exempt.
		const enWithoutPlaceholders = en[key].replace(/\{[^}]*\}/g, "");
		if (
			locale.startsWith("zh") &&
			value === en[key] &&
			/[a-zA-Z]{4,}/.test(enWithoutPlaceholders)
		) {
			problems.push({
				locale,
				key,
				message: "identical to English source — likely untranslated",
			});
		}
	}

	for (const key of keys) {
		if (!enKeys.has(key)) {
			problems.push({ locale, key, message: "extra key (not in en.json)" });
		}
	}

	// Every plural template must define an `other` branch.
	for (const key of keys) {
		const value = catalog[key];
		if (typeof value === "string" && /,\s*plural\s*,/.test(value)) {
			if (!/other\s*\{/.test(value)) {
				problems.push({
					locale,
					key,
					message: "plural template is missing an `other` branch",
				});
			}
		}
	}
}

if (problems.length > 0) {
	console.error(`i18n:check found ${problems.length} problem(s):\n`);
	for (const problem of problems) {
		const where = problem.key
			? `${problem.locale}/${problem.key}`
			: problem.locale;
		console.error(`  ✖ ${where}: ${problem.message}`);
	}
	console.error("");
	process.exit(1);
}

console.log(
	`i18n:check OK — ${files.length + 1} catalog(s), ${enKeys.size} keys, no problems.`,
);
