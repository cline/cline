#!/usr/bin/env node
import { main } from "./server.js";

main().catch((error: unknown) => {
	console.error("Cline Cloud Agent MCP server failed:", error);
	process.exitCode = 1;
});
