type KeysWithUndefinedValues<T extends Record<string, unknown>> = {
	[K in keyof T]: undefined extends T[K] ? K : never;
}[keyof T];

type KeysWithoutUndefinedValues<T extends Record<string, unknown>> = Exclude<
	keyof T,
	KeysWithUndefinedValues<T>
>;

export type OmitUndefinedValues<T extends Record<string, unknown>> = Pick<
	T,
	KeysWithoutUndefinedValues<T>
> &
	Partial<{
		[K in KeysWithUndefinedValues<T>]: Exclude<T[K], undefined>;
	}>;

export function omitUndefinedValues<T extends Record<string, unknown>>(
	value: T,
): OmitUndefinedValues<T> {
	return Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	) as OmitUndefinedValues<T>;
}
