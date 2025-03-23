// Type declarations for third-party modules

declare module "knuth-shuffle-seeded" {
	export default function knuthShuffle<T>(array: T[], seed: any): T[]
}
