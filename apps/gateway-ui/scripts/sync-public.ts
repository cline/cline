import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve(import.meta.dir, "../../cline/webview/public");
const destination = resolve(import.meta.dir, "../public");

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
