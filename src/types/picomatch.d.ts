declare module "picomatch" {
	type PicomatchOptions = {
		dot?: boolean
		nocase?: boolean
		ignore?: string | string[]
		posix?: boolean
		windows?: boolean
	}

	type PicomatchMatcher = (input: string) => boolean

	function picomatch(pattern: string | string[], options?: PicomatchOptions): PicomatchMatcher

	export default picomatch
}
