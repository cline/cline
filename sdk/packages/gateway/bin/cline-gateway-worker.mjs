#!/usr/bin/env node
// Cline Gateway execution worker entry (Gateway RFC, Phase 4).
// Speaks the worker supervision contract over stdin/stdout NDJSON.
// Spawned (sandboxed) by the Gateway's WorkerSupervisor — never run by hand.
import { runWorkerEntry } from "../dist/index.js";

runWorkerEntry();
