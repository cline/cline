export interface AutoRunSettings {
	enabled: boolean;
	command: string;
}

export const DEFAULT_AUTO_RUN_SETTINGS: AutoRunSettings = {
	enabled: false,
	command: '',
};
