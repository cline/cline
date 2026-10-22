import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
	extend: {
		classGroups: {
			"bg-color": [
				{
					bg: [
						"surface-hover",
						"surface-hover-lighter",
						"surface-hover-darker",
					],
				},
			],
		},
	},
});

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
