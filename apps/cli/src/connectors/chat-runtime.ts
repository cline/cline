import type { CliLoggerAdapter } from "../logging/adapter";

export function createChatSdkLogger(adapter: CliLoggerAdapter) {
	return {
		child(prefix: string) {
			return createChatSdkLogger(adapter.child({ chatLogger: prefix }));
		},
		debug(message: string, ...args: unknown[]) {
			adapter.core.debug(message, args.length > 0 ? { args } : undefined);
		},
		info(message: string, ...args: unknown[]) {
			adapter.core.log(message, args.length > 0 ? { args } : undefined);
		},
		warn(message: string, ...args: unknown[]) {
			adapter.core.log(message, {
				severity: "warn",
				...(args.length > 0 ? { args } : {}),
			});
		},
		error(message: string, ...args: unknown[]) {
			adapter.core.error?.(message, args.length > 0 ? { args } : undefined);
		},
	};
}

export async function enqueueThreadTurn(
	threadQueues: Map<string, Promise<void>>,
	threadId: string,
	work: () => Promise<void>,
): Promise<void> {
	const previous = threadQueues.get(threadId) ?? Promise.resolve();
	const current = previous
		.catch(() => {})
		.then(work)
		.finally(() => {
			if (threadQueues.get(threadId) === current) {
				threadQueues.delete(threadId);
			}
		});
	threadQueues.set(threadId, current);
	return current;
}

export type ConnectorWebhookHandler = (
	request: Request,
) => Response | Promise<Response>;

export type ConnectorWebhookServer = {
	close: () => Promise<void>;
};

async function readRequestBody(
	request: import("node:http").IncomingMessage,
): Promise<Uint8Array | undefined> {
	if (
		request.method === "GET" ||
		request.method === "HEAD" ||
		request.method === undefined
	) {
		return undefined;
	}
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	const body = Buffer.concat(chunks);
	return body.length > 0 ? body : undefined;
}

export async function startConnectorWebhookServer(input: {
	host: string;
	port: number;
	routes: Record<string, ConnectorWebhookHandler>;
	notFound?: ConnectorWebhookHandler;
}): Promise<ConnectorWebhookServer> {
	const http = await import("node:http");

	const server = http.createServer(async (req, res) => {
		try {
			const hostHeader = req.headers.host || `${input.host}:${input.port}`;
			const requestUrl = new URL(req.url || "/", `http://${hostHeader}`);
			const body = await readRequestBody(req);
			const request = new Request(requestUrl.toString(), {
				method: req.method,
				headers: new Headers(
					Object.entries(req.headers).flatMap(([key, value]) => {
						if (Array.isArray(value)) {
							return value.map((entry) => [key, entry] as [string, string]);
						}
						return typeof value === "string" ? [[key, value]] : [];
					}),
				),
				body,
				duplex: body ? "half" : undefined,
			});
			const handler =
				input.routes[requestUrl.pathname] ??
				input.notFound ??
				(() => new Response("Not Found", { status: 404 }));
			const response = await handler(request);
			res.statusCode = response.status;
			response.headers.forEach((value, key) => {
				res.setHeader(key, value);
			});
			const buffer = Buffer.from(await response.arrayBuffer());
			res.end(buffer);
		} catch (error) {
			res.statusCode = 500;
			res.end(error instanceof Error ? error.message : "Internal Server Error");
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(input.port, input.host, () => {
			server.off("error", reject);
			resolve();
		});
	});

	return {
		close: async () => {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		},
	};
}
