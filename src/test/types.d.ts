/**
 * Type declarations to fix module resolution issues between CommonJS and ESM
 */

// Allow importing chai as a CommonJS module
declare module "chai" {
	export const expect: any
	export const assert: any
	export const should: any
	export default any
}

// Allow importing delay as a CommonJS module
declare module "delay" {
	const delay: (ms: number) => Promise<void>
	export default delay
}
