import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Points `CLINE_DIR` at a throwaway directory before any test loads. The env
 * var, unlike `setClineDir`, reaches every copy of @cline/shared (core's own
 * build when this package runs outside the repo) and the plugin sandbox's
 * workers, so no test can install into, or write sessions to, the person's
 * real ~/.cline.
 */
const clineDir = mkdtempSync(join(tmpdir(), "next-turn-test-cline-"));
process.env.CLINE_DIR = clineDir;
delete process.env.CLINE_DATA_DIR;
process.on("exit", () => rmSync(clineDir, { recursive: true, force: true }));
