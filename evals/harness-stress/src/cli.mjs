#!/usr/bin/env node
import { createHarnessServer } from "./server.mjs";

const args = parseArgs(process.argv.slice(2));
const server = await createHarnessServer({
	host: args.host,
	port: args.port,
	allowRemote: args.allowRemote,
	allowExtreme: args.allowExtreme,
	traceFile: args.traceFile,
	onTrace: args.quiet
		? undefined
		: (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
});

process.stderr.write(`Cline harness stress endpoint: ${server.origin}/v1\n`);
process.stderr.write(
	"Use model harness/baseline or GET /v1/models for all scenarios.\n",
);

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.once(signal, async () => {
		await server.close();
		process.exit(0);
	});
}

function parseArgs(argv) {
	const result = {
		host: "127.0.0.1",
		port: 4319,
		allowRemote: false,
		allowExtreme: false,
		quiet: false,
	};
	for (let index = 0; index < argv.length; index++) {
		const value = argv[index];
		if (value === "--host") result.host = requiredValue(argv, ++index, value);
		else if (value === "--port")
			result.port = parsePort(requiredValue(argv, ++index, value));
		else if (value === "--trace-file")
			result.traceFile = requiredValue(argv, ++index, value);
		else if (value === "--allow-remote") result.allowRemote = true;
		else if (value === "--allow-extreme") result.allowExtreme = true;
		else if (value === "--quiet") result.quiet = true;
		else throw new Error(`Unknown argument: ${value}`);
	}
	return result;
}

function requiredValue(argv, index, flag) {
	if (!argv[index]) throw new Error(`${flag} requires a value`);
	return argv[index];
}

function parsePort(value) {
	const port = Number(value);
	if (!Number.isSafeInteger(port) || port < 0 || port > 65_535)
		throw new Error(`Invalid port: ${value}`);
	return port;
}
