/**
 * Generic conversion utilities for proto <-> domain model conversions
 */

type ConversionOptions<T, U> = {
	/**
	 * Custom field mappings from source to target
	 * (sourceName -> targetName)
	 */
	fieldMap?: Record<string, string>

	/**
	 * Fields that need JSON parsing when converting to domain
	 */
	jsonFields?: string[]

	/**
	 * Custom value transformers for specific fields
	 */
	customTransformers?: Record<string, (value: any) => any>

	/**
	 * Fields to exclude from conversion
	 */
	excludeFields?: string[]
}

/**
 * Creates a generic conversion function between two object types
 *
 * @param options Conversion options
 * @returns A conversion function that takes a source object and returns a target object
 */
export function createConverter<TSource, TTarget>(options: ConversionOptions<TSource, TTarget> = {}) {
	const { fieldMap = {}, jsonFields = [], customTransformers = {}, excludeFields = [] } = options

	// Create reverse field map for lookup
	const reverseFieldMap: Record<string, string> = {}
	Object.entries(fieldMap).forEach(([key, value]) => {
		reverseFieldMap[value] = key
	})

	/**
	 * Converts a source object to a target object
	 *
	 * @param source The source object
	 * @param targetCreator Optional factory function to create the target object
	 * @returns The converted target object
	 */
	return function convert(source: TSource, targetCreator?: (data: any) => TTarget): TTarget {
		if (!source) {
			return {} as TTarget
		}

		const result: Record<string, any> = {}

		// Process all fields from the source
		Object.entries(source as Record<string, any>).forEach(([key, value]) => {
			// Skip undefined values and excluded fields
			if (value === undefined || excludeFields.includes(key)) {
				return
			}

			// Map field name if needed
			const targetKey = fieldMap[key] || key

			// Skip if the field is explicitly mapped to null or empty string
			if (targetKey === null || targetKey === "") {
				return
			}

			// Apply custom transformer if available
			if (customTransformers[key]) {
				result[targetKey] = customTransformers[key](value)
				return
			}

			// Handle JSON fields (parsing strings to objects)
			if (jsonFields.includes(key) && typeof value === "string") {
				try {
					result[targetKey] = JSON.parse(value)
				} catch (e) {
					console.warn(`Failed to parse JSON for field ${key}:`, e)
					result[targetKey] = value
				}
				return
			}

			// Default: direct value assignment
			result[targetKey] = value
		})

		// Use factory function if provided, otherwise return plain object
		return targetCreator ? targetCreator(result) : (result as TTarget)
	}
}

/**
 * Creates a converter function that stringifies specified fields for proto serialization
 *
 * @param jsonFields Fields that need to be stringified
 * @returns A function that prepares an object for proto serialization
 */
export function createJsonStringifier(jsonFields: string[]) {
	return function stringifyJsonFields(obj: Record<string, any>): Record<string, any> {
		if (!obj) {
			return {}
		}

		const result = { ...obj }

		jsonFields.forEach((field) => {
			if (result[field] !== undefined && result[field] !== null) {
				result[field] = JSON.stringify(result[field])
			}
		})

		return result
	}
}

/**
 * Creates bidirectional converters between domain and proto types
 *
 * @param protoToDomainOptions Options for proto -> domain conversion
 * @param domainToProtoOptions Options for domain -> proto conversion
 * @returns Object containing both conversion functions
 */
export function createBidirectionalConverters<TProto, TDomain>(
	protoToDomainOptions: ConversionOptions<TProto, TDomain>,
	domainToProtoOptions: ConversionOptions<TDomain, TProto>,
	protoFactory?: (data: any) => TProto,
) {
	return {
		fromProto: createConverter<TProto, TDomain>(protoToDomainOptions),
		toProto: createConverter<TDomain, TProto>(domainToProtoOptions),
		protoFactory,
	}
}
