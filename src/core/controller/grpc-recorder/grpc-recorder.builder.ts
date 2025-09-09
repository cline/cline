import { GrpcRequestFilter } from "@core/controller/grpc-recorder/types"
import { GrpcRecorder, GrpcRecorderNoops, IRecorder } from "@/core/controller/grpc-recorder/grpc-recorder"
import { LogFileHandler, LogFileHandlerNoops } from "@/core/controller/grpc-recorder/log-file-handler"

/**
 * A builder class for constructing a gRPC recorder instance.
 *
 * This class follows the Builder pattern, allowing consumers
 * to configure logging behavior and control whether recording
 * is enabled or disabled before creating a final `IRecorder`.
 */
export class GrpcRecorderBuilder {
	private fileHandler: LogFileHandler | null = null
	private enabled: boolean = true
	private filters: GrpcRequestFilter[] = []

	public withLogFileHandler(handler: LogFileHandler): this {
		this.fileHandler = handler
		return this
	}

	public enableIf(condition: boolean): this {
		this.enabled = condition
		return this
	}

	public withFilters(...filters: GrpcRequestFilter[]): this {
		this.filters.push(...filters)
		return this
	}

	public build(): IRecorder {
		if (!this.enabled) {
			return new GrpcRecorderNoops()
		}

		let filters: GrpcRequestFilter[] = filtersFromEnv()
		if (this.filters.length > 0) {
			filters = filters.concat(this.filters)
		}

		const handler = this.fileHandler ?? new LogFileHandlerNoops()
		return new GrpcRecorder(handler, filters)
	}
}

function filtersFromEnv(): GrpcRequestFilter[] {
	const filters: GrpcRequestFilter[] = []

	if (process.env.GRPC_RECORDER_TESTS_FILTERS_ENABLED === "true") {
		filters.push(...testFilters())
	}

	return filters
}

function testFilters(): GrpcRequestFilter[] {
	/*
	 * Ignores streaming messages and unwanted services messages
	 * that record more than expected.
	 */
	return [(req) => req.is_streaming, (req) => ["cline.UiService", "cline.McpService", "cline.WebService"].includes(req.service)]
}
