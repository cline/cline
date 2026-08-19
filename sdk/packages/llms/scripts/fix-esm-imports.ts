#!/usr/bin/env bun

import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_RE = /\.(?:[cm]?js|json|node)$/;

function walkFiles(dir: string): string[] {
	const entries = readdirSync(dir);
	const files: string[] = [];

	for (const entry of entries) {
		const fullPath = join(dir, entry);
		const stats = statSync(fullPath);
		if (stats.isDirectory()) {
			files.push(...walkFiles(fullPath));
			continue;
		}
		if (stats.isFile() && fullPath.endsWith(".js")) {
			files.push(fullPath);
		}
	}

	return files;
}

function resolveSpecifier(filePath: string, specifier: string): string {
	if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
		return specifier;
	}

	if (EXTENSION_RE.test(specifier)) {
		return specifier;
	}

	const baseDir = dirname(filePath);
	const target = resolve(baseDir, specifier);
	const asFile = `${target}.js`;
	const asIndex = join(target, "index.js");

	if (existsSync(asFile)) {
		return `${specifier}.js`;
	}
	if (existsSync(asIndex)) {
		return `${specifier}/index.js`;
	}

	return specifier;
}

function rewriteImports(filePath: string): boolean {
	const content = readFileSync(filePath, "utf8");
	let changed = false;

	const replaceStatic = (
		_: string,
		prefix: string,
		specifier: string,
		suffix: string,
	) => {
		const resolved = resolveSpecifier(filePath, specifier);
		if (resolved !== specifier) {
			changed = true;
		}
		return `${prefix}${resolved}${suffix}`;
	};

	const staticPat = /(from\s+["'])(\.[^"']*)(["'])/g;
	const dynamicPat = /(import\(\s*["'])(\.[^"']*)(["']\s*\))/g;

	const rewritten = content
		.replace(staticPat, replaceStatic)
		.replace(dynamicPat, replaceStatic);

	if (changed) {
		writeFileSync(filePath, rewritten, "utf8");
	}

	return changed;
}

function main() {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	const distDir = resolve(__dirname, "../dist");

	if (!existsSync(distDir)) {
		console.log("No dist directory found; skipping ESM import fix.");
		return;
	}

	let fixedCount = 0;
	for (const filePath of walkFiles(distDir)) {
		if (rewriteImports(filePath)) {
			fixedCount++;
		}
	}

	console.log(`Fixed ESM import specifiers in ${fixedCount} file(s).`);
}

main();
