import { GrpcPostRecordHook, GrpcRequestFilter } from "@core/controller/grpc-recorder/types"
import { Controller } from "@/core/controller"
import { GrpcRecorder, GrpcRecorderNoops, IRecorder } from "@/core/controller/grpc-recorder/grpc-recorder"
import { LogFileHandler, LogFileHandlerNoops } from "@/core/controller/grpc-recorder/log-file-handler"
import { testHooks } from "@/core/controller/grpc-recorder/test-hooks"

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
	private hooks: GrpcPostRecordHook[] = []

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

	public withPostRecordHooks(...hooks: GrpcPostRecordHook[]): this {
		this.hooks.push(...hooks)
		return this
	}

	// Initialize the recorder as a singleton
	private static recorder: IRecorder

	/**
	 * Gets or creates the GrpcRecorder instance
	 */
	static getRecorder(controller: Controller): IRecorder {
		if (!GrpcRecorderBuilder.recorder) {
			GrpcRecorderBuilder.recorder = GrpcRecorder.builder()
				.enableIf(process.env.GRPC_RECORDER_ENABLED === "true" && process.env.CLINE_ENVIRONMENT === "local")
				.withLogFileHandler(new LogFileHandler())
				.build(controller)
		}
		return GrpcRecorderBuilder.recorder
	}

	public build(controller?: Controller): IRecorder {
		if (!this.enabled) {
			return new GrpcRecorderNoops()
		}

		let filters: GrpcRequestFilter[] = filtersFromEnv()
		if (this.filters.length > 0) {
			filters = filters.concat(this.filters)
		}

		let hooks: GrpcPostRecordHook[] = hooksFromEnv(controller)
		if (this.hooks.length > 0) {
			hooks = hooks.concat(this.hooks)
		}

		const handler = this.fileHandler ?? new LogFileHandlerNoops()
		return new GrpcRecorder(handler, filters, hooks)
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
	return [
		(req) => req.is_streaming,
		(req) => ["cline.UiService", "cline.McpService", "cline.WebService"].includes(req.service),
		(req) =>
			[
				"refreshOpenRouterModels",
				"getAvailableTerminalProfiles",
				"showTaskWithId",
				"deleteTasksWithIds",
				"getTotalTasksSize",
				"cancelTask",
			].includes(req.method),
	]
}

function hooksFromEnv(controller?: Controller): GrpcPostRecordHook[] {
	const hooks: GrpcPostRecordHook[] = []

	if (controller && process.env.GRPC_RECORDER_TESTS_FILTERS_ENABLED === "true") {
		hooks.push(...testHooks(controller))
	}

	return hooks
}
