import { v4 as uuidv4 } from "uuid"
export class AutocompleteDebouncer {
	private debounceTimeout: NodeJS.Timeout | undefined = undefined
	private debouncing = false
	private lastUUID: string | undefined = undefined

	async delayAndShouldDebounce(debounceDelay: number): Promise<boolean> {
		// Debounce
		const uuid = uuidv4()
		this.lastUUID = uuid

		// Debounce
		if (this.debouncing) {
			this.debounceTimeout?.refresh()
			const lastUUID = await new Promise((resolve) =>
				setTimeout(() => {
					resolve(this.lastUUID)
				}, debounceDelay),
			)
			if (uuid !== lastUUID) {
				return true
			}
		} else {
			this.debouncing = true
			this.debounceTimeout = setTimeout(async () => {
				this.debouncing = false
			}, debounceDelay)
		}

		return false
	}
}
