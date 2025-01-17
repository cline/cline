function serializeError(error) {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
		}
	}
	return error
}

function deserializeError(errorData) {
	if (errorData && typeof errorData === "object") {
		const error = new Error(errorData.message)
		error.name = errorData.name
		error.stack = errorData.stack
		return error
	}
	return errorData
}

module.exports = {
	serializeError,
	deserializeError,
}
