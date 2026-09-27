import { Readable, Writable } from "node:stream";
import { registerClineClientIdentity } from "../utils/cline-client-identity";
import { writeDiagnostic } from "../utils/output";

export interface AcpModeOptions {
	autoApproveTools?: boolean;
}

export async function runAcpMode(options?: AcpModeOptions): Promise<void> {
	const { AgentSideConnection, ndJsonStream } = await import(
		"@agentclientprotocol/sdk"
	);
	const { AcpAgent } = await import("./acpAgent");

	registerClineClientIdentity("cline-acp");

	writeDiagnostic("[acp] starting ACP mode over stdio…");

	const stream = ndJsonStream(
		Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
		Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
	);

	const connection = new AgentSideConnection((conn) => {
		return new AcpAgent(conn, {
			autoApproveTools: options?.autoApproveTools,
		});
	}, stream);

	// Keep the process alive until the connection closes
	await connection.closed;
}
