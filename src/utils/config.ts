export type InjectableConfigType =
	| string
	| {
			[key: string]:
				| undefined
				| null
				| boolean
				| number
				| InjectableConfigType
				| Array<undefined | null | boolean | number | InjectableConfigType>
	  }

/**
 * Deeply injects environment variables into a configuration object/string/json
 *
 * Uses VSCode env:name pattern: https://code.visualstudio.com/docs/reference/variables-reference#_environment-variables
 *
 * Does not mutate original object
 */
export async function injectEnv<C extends InjectableConfigType>(config: C, notFoundValue: any = "") {
	return injectVariables(config, { env: process.env }, notFoundValue)
}

/**
 * Deeply injects variables into a configuration object/string/json
 *
 * Uses VSCode's variables reference pattern: https://code.visualstudio.com/docs/reference/variables-reference#_environment-variables
 *
 * Does not mutate original object
 *
 * There is a special handling for a nested (record-type) variables, where it is replaced by `propNotFoundValue` (if available) if the root key exists but the nested key does not.
 *
 * Matched keys that have `null` | `undefined` values are treated as not found.
 */
export async function injectVariables<C extends InjectableConfigType>(
	config: C,
	variables: Record<string, undefined | null | string | Record<string, undefined | null | string>>,
	propNotFoundValue?: any,
) {
	const isObject = typeof config === "object"
	let configString: string = isObject ? JSON.stringify(config) : config

	for (const [key, value] of Object.entries(variables)) {
		if (value == null) continue

		if (typeof value === "string") {
			// Normalize paths to forward slashes for cross-platform compatibility
			configString = configString.replace(new RegExp(`\\$\\{${key}\\}`, "g"), value.toPosix())
		} else {
			// Handle nested variables (e.g., ${env:VAR_NAME})
			configString = configString.replace(new RegExp(`\\$\\{${key}:([\\w]+)\\}`, "g"), (match, name) => {
				const nestedValue = value[name]

				if (nestedValue == null) {
					console.warn(`[injectVariables] variable "${name}" referenced but not found in "${key}"`)
					return propNotFoundValue ?? match
				}

				// Normalize paths for string values
				return typeof nestedValue === "string" ? nestedValue.toPosix() : nestedValue
			})
		}
	}

	return (isObject ? JSON.parse(configString) : configString) as C extends string ? string : C
}
