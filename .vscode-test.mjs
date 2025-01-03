import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'src/test/extension.test.ts',
	workspaceFolder: '.',
	mocha: {
		timeout: 60000,
		ui: 'tdd'
	},
	launchArgs: [
		'--enable-proposed-api=RooVeterinaryInc.roo-cline',
		'--disable-extensions'
	]
});
