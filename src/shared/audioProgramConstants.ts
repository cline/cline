export const AUDIO_PROGRAM_CONFIG = {
	darwin: {
		command: "rec",
		fallbackPaths: ["/usr/local/bin/rec", "/opt/homebrew/bin/rec"],
		getArgs: (outputFile: string) => ["-c", "1", "-e", "signed", "-b", "16", outputFile],
		error: "Audio recording requires SoX. Please install it using: brew install sox",
	},
	linux: {
		command: "arecord",
		fallbackPaths: ["/usr/bin/arecord"],
		getArgs: (outputFile: string) => ["-f", "cd", "-t", "wav", "-d", "0", "-c", "1", outputFile],
		error: "Audio recording requires ALSA utilities. Please install using: sudo apt-get install alsa-utils (or equivalent for your distribution)",
	},
	win32: {
		command: "sox",
		fallbackPaths: ["C:\\Program Files (x86)\\sox\\sox.exe"],
		getArgs: (outputFile: string) => ["-t", "waveaudio", "default", "-c", "1", "-e", "signed", "-b", "16", outputFile],
		error: "Audio recording requires SoX. Please install it using: winget install ChrisBagwell.SoX",
	},
}
