export interface TaskAbortCleanupDependencies {
	urlContentFetcher?: {
		closeBrowser?: () => void | Promise<void>
	}
	browserSession: {
		dispose: () => Promise<void>
	}
	clineIgnoreController: {
		dispose: () => Promise<void>
	}
	fileContextTracker: {
		dispose: () => Promise<void>
	}
	focusChainManager?: {
		dispose: () => void | Promise<void>
	}
	presentationScheduler: {
		dispose: () => Promise<void>
	}
}

export async function performTaskAbortCleanup(deps: TaskAbortCleanupDependencies): Promise<void> {
	await Promise.resolve(deps.urlContentFetcher?.closeBrowser?.())
	await deps.browserSession.dispose()
	await Promise.all([
		deps.clineIgnoreController.dispose(),
		deps.fileContextTracker.dispose(),
		Promise.resolve(deps.focusChainManager?.dispose()),
	])
	await deps.presentationScheduler.dispose()
}
