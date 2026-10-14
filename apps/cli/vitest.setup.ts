import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Unit tests (and any subprocess they spawn, via env inheritance) must never
// touch the developer's real ~/.cline: a test that reaches core startup can
// otherwise spawn a real hub daemon against the real discovery record, or
// trigger a real background auto-update. Point everything at a per-worker
// temp dir before any test file is imported. Tests that need specific paths
// still override these per-test.
const isolatedRoot = mkdtempSync(join(tmpdir(), "cline-cli-vitest-"));
process.env.CLINE_DIR = join(isolatedRoot, ".cline");
process.env.CLINE_DATA_DIR = join(isolatedRoot, "data");
process.env.CLINE_HUB_DISCOVERY_PATH = join(isolatedRoot, "hub-discovery.json");
process.env.CLINE_NO_AUTO_UPDATE = "1";
