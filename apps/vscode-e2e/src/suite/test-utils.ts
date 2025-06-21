export const DEFAULT_SUITE_TIMEOUT = 120_000

export function setDefaultSuiteTimeout(context: Mocha.Suite) {
	context.timeout(DEFAULT_SUITE_TIMEOUT)
}
