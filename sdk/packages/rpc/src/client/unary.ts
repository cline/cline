import type * as grpc from "@grpc/grpc-js";

export function unary<TResponse = unknown>(
	invoke: (
		callback: (
			error: grpc.ServiceError | null,
			response: TResponse | undefined,
		) => void,
	) => void,
): Promise<TResponse> {
	return new Promise<TResponse>((resolve, reject) => {
		invoke((error, response) => {
			if (error) {
				reject(error);
				return;
			}
			resolve((response ?? ({} as TResponse)) as TResponse);
		});
	});
}
