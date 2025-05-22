const prefix = "[ClineWebview]"

export const logger = {
	debug: (...args: any[]) => {
		if (import.meta.env.DEV) {
			console.debug(prefix, ...args)
		}
	},
	info: (...args: any[]) => {
		// In a production app, you might send these to a logging service
		// or have a more sophisticated way to enable/disable them.
		// For now, we'll log them if in DEV or if explicitly enabled via a global flag (not implemented here).
		// As a simple default, let's make info logs also DEV only for now to keep prod console clean,
		// unless a specific need arises to show them in prod.
		if (import.meta.env.DEV) {
			console.info(prefix, ...args)
		}
	},
	warn: (...args: any[]) => {
		console.warn(prefix, ...args)
	},
	error: (...args: any[]) => {
		console.error(prefix, ...args)
	},
}

// Example of a more specific logger for a component, if needed elsewhere:
// export const createComponentLogger = (componentName: string) => ({
// 	debug: (...args: any[]) => logger.debug(`[${componentName}]`, ...args),
// 	info: (...args: any[]) => logger.info(`[${componentName}]`, ...args),
// 	warn: (...args: any[]) => logger.warn(`[${componentName}]`, ...args),
// 	error: (...args: any[]) => logger.error(`[${componentName}]`, ...args),
// });
