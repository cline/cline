// Run after platform signing; checksum the exact executable users download.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const target = process.argv[2];
if (!target || !/^[a-z0-9_-]+$/.test(target))
	throw new Error("usage: collect-runtime-asset.ts <target-triple>");
const extension = target.includes("windows") ? ".exe" : "";
const name = `cline-runtime-${target}${extension}`;
mkdirSync("dist/publish", { recursive: true });
const output = join("dist/publish", name);
copyFileSync(`src-tauri/bin/cline-cli-${target}${extension}`, output);
writeFileSync(
	`${output}.sha256`,
	`${createHash("sha256").update(readFileSync(output)).digest("hex")}  ${name}\n`,
);
