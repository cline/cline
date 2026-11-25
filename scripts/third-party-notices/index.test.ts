import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BUNDLE_INPUTS } from "./bundle-inputs";
import { collectPackageEntries } from "./index";

const root = mkdtempSync(join(tmpdir(), "third-party-notices-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, content: string): string {
	const file = join(root, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content);
	return file;
}

function pkg(dir: string, name: string): void {
	write(
		`${dir}/package.json`,
		JSON.stringify({ name, version: "1.0.0", license: "MIT" }),
	);
	write(`${dir}/LICENSE`, `Copyright (c) ${name} authors`);
}

const names = (inputs: string[]) =>
	collectPackageEntries(inputs, root)
		.map((e) => e.name)
		.sort();

describe("collectPackageEntries", () => {
	test("keeps a package whose source-mapped file it does not publish", () => {
		pkg("node_modules/@scope/widget", "@scope/widget");
		expect(
			names([join(root, "node_modules/@scope/widget/src/widget.tsx")]),
		).toEqual(["@scope/widget"]);
	});

	test("follows a workspace package's dist to the code it bundled", () => {
		pkg("node_modules/bundled-dep", "bundled-dep");
		write("packages/lib/package.json", JSON.stringify({ name: "lib" }));
		write(
			`packages/lib/dist/${BUNDLE_INPUTS}`,
			JSON.stringify([
				join(root, "packages/lib/src/index.ts"),
				join(root, "node_modules/bundled-dep/index.js"),
			]),
		);
		expect(names([join(root, "packages/lib/dist/index.js")])).toEqual([
			"bundled-dep",
		]);
		expect(names([join(root, "packages/lib/src/index.ts")])).toEqual([]);
	});

	test("includes packages a stylesheet imports", () => {
		pkg("node_modules/css-framework", "css-framework");
		pkg("node_modules/@fonts/sans", "@fonts/sans");
		pkg("node_modules/css-plugin", "css-plugin");
		pkg("node_modules/icons", "icons");
		write("node_modules/icons/dist/icons.css", "");
		const css = write(
			"app/styles/globals.css",
			[
				'@import "@fonts/sans";',
				'@import "css-framework";',
				'@import url("../../node_modules/icons/dist/icons.css");',
				'@plugin "css-plugin";',
				'@import "./local.css";',
				'@import "https://example.com/remote.css";',
			].join("\n"),
		);
		write("app/styles/local.css", "");
		expect(names([css])).toEqual([
			"@fonts/sans",
			"css-framework",
			"css-plugin",
			"icons",
		]);
	});
});
