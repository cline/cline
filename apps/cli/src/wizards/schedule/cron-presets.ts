export interface CronPreset {
	label: string;
	value: string;
	hint: string;
}

export const CRON_PRESETS: CronPreset[] = [
	{
		label: "Every 5 minutes",
		value: "*/5 * * * *",
		hint: "*/5 * * * *",
	},
	{
		label: "Every 15 minutes",
		value: "*/15 * * * *",
		hint: "*/15 * * * *",
	},
	{
		label: "Every hour",
		value: "0 * * * *",
		hint: "0 * * * *",
	},
	{
		label: "Every 6 hours",
		value: "0 */6 * * *",
		hint: "0 */6 * * *",
	},
	{
		label: "Daily at midnight",
		value: "0 0 * * *",
		hint: "0 0 * * *",
	},
	{
		label: "Daily at 9am",
		value: "0 9 * * *",
		hint: "0 9 * * *",
	},
	{
		label: "Every weekday at 9am",
		value: "0 9 * * 1-5",
		hint: "0 9 * * 1-5",
	},
	{
		label: "Every Monday at 9am",
		value: "0 9 * * 1",
		hint: "0 9 * * 1",
	},
	{
		label: "First of every month",
		value: "0 0 1 * *",
		hint: "0 0 1 * *",
	},
	{
		label: "Custom",
		value: "__custom__",
		hint: "enter your own cron expression",
	},
];
