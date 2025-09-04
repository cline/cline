import { GrpcRecorder, GrpcRecorderNoops, IRecorder } from "@/core/controller/grpc-recorder/grpc-recorder"
import { LogFileHandler, LogFileHandlerNoops } from "@/core/controller/grpc-recorder/log-file-handler"

export class GrpcRecorderBuilder {
	private fileHandler: LogFileHandler | null = null
	private enabled: boolean = true

	public withLogFileHandler(handler: LogFileHandler): this {
		this.fileHandler = handler
		return this
	}

	public enableIf(condition: boolean): this {
		this.enabled = condition
		return this
	}

	public build(): IRecorder {
		if (!this.enabled) {
			return new GrpcRecorderNoops()
		}

		const handler = this.fileHandler ?? new LogFileHandlerNoops()
		return new GrpcRecorder(handler)
	}
}
