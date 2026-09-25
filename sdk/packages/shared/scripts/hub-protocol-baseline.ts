#!/usr/bin/env bun
// Maintains src/hub-contract/hub-protocol.released.json: the Hub wire
// contract as of the latest SDK release. hub-protocol.test.ts compares the
// current contract against it, so a breaking change is measured against what
// installed clients actually run rather than against the last commit.
//
//   bun scripts/hub-protocol-baseline.ts --write   refresh it (SDK release bump)
//   bun scripts/hub-protocol-baseline.ts --check   fail unless it matches (publish)
//
// --write refuses a breaking change unless CURRENT_HUB_PROTOCOL_VERSION moved.

import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { CURRENT_HUB_PROTOCOL_VERSION } from "../src/hub";
import {
	buildHubProtocolDocument,
	findBreakingHubProtocolChanges,
	type HubProtocolDocument,
} from "../src/hub-contract";

const BASELINE = new URL(
	"../src/hub-contract/hub-protocol.released.json",
	import.meta.url,
);

const mode = process.argv[2];
if (mode !== "--write" && mode !== "--check") {
	console.error("Usage: bun scripts/hub-protocol-baseline.ts --write|--check");
	process.exit(2);
}

const current = buildHubProtocolDocument(CURRENT_HUB_PROTOCOL_VERSION);
const released = JSON.parse(
	readFileSync(BASELINE, "utf8"),
) as HubProtocolDocument;

if (mode === "--check") {
	if (!isDeepStrictEqual(JSON.parse(JSON.stringify(current)), released)) {
		console.error(
			"hub-protocol.released.json does not match the Hub contract being released. " +
				"Run `bun run version` (or `bun sdk/packages/shared/scripts/hub-protocol-baseline.ts --write`) and commit the result.",
		);
		process.exit(1);
	}
	console.log("Hub protocol baseline matches this release.");
	process.exit(0);
}

if (released.protocolVersion === current.protocolVersion) {
	const breaking = findBreakingHubProtocolChanges(released, current);
	if (breaking.length > 0) {
		console.error(
			`Breaking Hub wire changes since the last release need a protocol version bump:\n${breaking
				.map((change) => `  ${change}`)
				.join("\n")}`,
		);
		process.exit(1);
	}
}
writeFileSync(BASELINE, `${JSON.stringify(current, null, "\t")}\n`);
console.log(
	`Wrote the Hub protocol baseline (${Object.keys(current.commands).length} commands, ${Object.keys(current.events).length} events).`,
);
