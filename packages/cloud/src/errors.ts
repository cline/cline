export class CloudAPIError extends Error {
	constructor(
		message: string,
		public statusCode?: number,
		public responseBody?: unknown,
	) {
		super(message)
		this.name = "CloudAPIError"
		Object.setPrototypeOf(this, CloudAPIError.prototype)
	}
}

export class TaskNotFoundError extends CloudAPIError {
	constructor(taskId?: string) {
		super(taskId ? `Task '${taskId}' not found` : "Task not found", 404)
		this.name = "TaskNotFoundError"
		Object.setPrototypeOf(this, TaskNotFoundError.prototype)
	}
}

export class AuthenticationError extends CloudAPIError {
	constructor(message = "Authentication required") {
		super(message, 401)
		this.name = "AuthenticationError"
		Object.setPrototypeOf(this, AuthenticationError.prototype)
	}
}

export class NetworkError extends CloudAPIError {
	constructor(message = "Network error occurred") {
		super(message)
		this.name = "NetworkError"
		Object.setPrototypeOf(this, NetworkError.prototype)
	}
}

export class InvalidClientTokenError extends Error {
	constructor() {
		super("Invalid/Expired client token")
		Object.setPrototypeOf(this, InvalidClientTokenError.prototype)
	}
}
