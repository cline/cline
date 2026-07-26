import { Empty, EmptyRequest } from "@shared/proto/bedrock_coder/common"

export async function shutdown(request: EmptyRequest): Promise<Empty> {
	// VSCode extensions cannot shutdown the host process (VSCode itself)
	// This is a no-op that just returns success
	// The shutdown RPC is primarily used by standalone bedrock-coder-core instances
	// to tell their paired host bridge processes to shut down
	return Empty.create({})
}
