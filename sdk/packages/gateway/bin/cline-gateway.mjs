#!/usr/bin/env node
// Cline Gateway lifecycle CLI (Gateway RFC, Phase 3).
import { runGatewayCli } from "../dist/index.js";

const code = await runGatewayCli(process.argv.slice(2));
if (code !== 0) {
	process.exit(code);
}
