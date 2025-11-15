/**
 * Utility type to extract only properties that exist in target type T from source type U
 * This ensures compile-time safety by only allowing known properties through.
 */
export type PickKnownProperties<T, U> = Pick<U, Extract<keyof U, keyof T>>

/**
 * Utility type to make all properties in T recursively optional
 */
export type PartialDeep<T> = T extends object
	? T extends Array<infer U>
		? Array<PartialDeep<U>>
		: T extends Function
			? T
			: { [P in keyof T]?: PartialDeep<T[P]> }
	: T

/**
 * Utility type to ensure that an object T has no extra properties beyond those defined in Shape
 */
export type OnlyKnown<T extends object, Shape extends object> = T & { [K in Exclude<keyof T, keyof Shape>]?: never }

/**
 * Function to filter an object T to only include properties defined in Shape
 *
 * @param obj - The object to filter
 * @param shape - An object representing the desired shape
 * @returns A new object containing only the properties of obj that exist in shape
 */
export function toKnownShape<T extends object, Shape extends object>(obj: T, shape: Shape): OnlyKnown<T, Shape> {
	const result: Record<string, any> = {}
	const shapeKeys = Object.keys(shape)

	for (let i = 0; i < shapeKeys.length; i++) {
		const key = shapeKeys[i]
		if (key in obj) {
			result[key] = obj[key as keyof T]
		}
	}

	return result as OnlyKnown<T, Shape>
}
