#!/usr/bin/env node

/**
 * A script that overrides some of the create-react-app build script configurations
 * in order to disable code splitting/chunking and rename the output build files so
 * they have no hash. (Reference: https://mtm.dev/disable-code-splitting-create-react-app).
 *
 * This is crucial for getting React webview code to run because VS Code expects a
 * single (consistently named) JavaScript and CSS file when configuring webviews.
 */

const rewire = require("rewire")
const defaults = rewire("react-scripts/scripts/build.js")
const config = defaults.__get__("config")

/* Modifying Webpack Configuration for 'shared' dir
This section uses Rewire to modify Create React App's webpack configuration without ejecting. Rewire allows us to inject and alter the internal build scripts of CRA at runtime. This allows us to maintain a flexible project structure that keeps shared code outside the webview-ui/src directory, while still adhering to CRA's security model that typically restricts imports to within src/. 
1. Uses the ModuleScopePlugin to whitelist files from the shared directory, allowing them to be imported despite being outside src/. (see: https://stackoverflow.com/questions/44114436/the-create-react-app-imports-restriction-outside-of-src-directory/58321458#58321458)
2. Modifies the TypeScript rule to include the shared directory in compilation. This essentially transpiles and includes the ts files in shared dir in the output main.js file.
Before, we would just import types from shared dir and specifying include (and alias to have cleaner paths) in tsconfig.json was enough. But now that we are creating values (i.e. models in api.ts) to import into the react app, we must also include these files in the webpack resolution.
- Imports from the shared directory must use full paths relative to the src directory, without file extensions.
- Example: import { someFunction } from '../../src/shared/utils/helpers'
*/
const ModuleScopePlugin = require("react-dev-utils/ModuleScopePlugin")
const path = require("path")
const fs = require("fs")
// Get all files in the shared directory
const sharedDir = path.resolve(__dirname, "..", "..", "src", "shared")

function getAllFiles(dir) {
	let files = []
	fs.readdirSync(dir).forEach((file) => {
		const filePath = path.join(dir, file)
		if (fs.statSync(filePath).isDirectory()) {
			files = files.concat(getAllFiles(filePath))
		} else {
			const withoutExtension = path.join(dir, path.parse(file).name)
			files.push(withoutExtension)
		}
	})
	return files
}
const sharedFiles = getAllFiles(sharedDir)
// config.resolve.plugins = config.resolve.plugins.filter((plugin) => !(plugin instanceof ModuleScopePlugin))
// Instead of excluding the whole ModuleScopePlugin, we just whitelist specific files that can be imported from outside src.
config.resolve.plugins.forEach((plugin) => {
	if (plugin instanceof ModuleScopePlugin) {
		console.log("Whitelisting shared files: ", sharedFiles)
		sharedFiles.forEach((file) => plugin.allowedFiles.add(file))
	}
})
/* 
Webpack configuration

Webpack is a module bundler for JavaScript applications. It processes your project files, resolving dependencies and generating a deployable production build.
The webpack config is an object that tells webpack how to process and bundle your code. It defines entry points, output settings, and how to handle different file types.
This config.module section of the webpack config deals with how different file types (modules) should be treated.
config.module.rules:
Rules define how module files should be processed. Each rule can:
- Specify which files to process (test)
	When webpack "processes" a file, it performs several operations:
	1. Reads the file
	2. Parses its content and analyzes dependencies
	3. Applies transformations (e.g., converting TypeScript to JavaScript)
	4. Potentially modifies the code (e.g., applying polyfills)
	5. Includes the processed file in the final bundle
	By specifying which files to process, we're telling webpack which files should go through this pipeline and be included in our application bundle. Files that aren't processed are ignored by webpack.
	In our case, we're ensuring that TypeScript files in our shared directory are processed, allowing us to use them in our application.
- Define which folders to include or exclude
- Set which loaders to use for transformation
A loader transforms certain types of files into valid modules that webpack can process. For example, the TypeScript loader converts .ts files into JavaScript that webpack can understand.
By modifying these rules, we can change how webpack processes different files in our project, allowing us to include files from outside the standard src directory.

Why we need to modify the webpack config

Create React App (CRA) is designed to only process files within the src directory for security reasons. (CRA limits processing to the src directory to prevent accidental inclusion of sensitive files, reduce the attack surface, and ensure predictable builds, enhancing overall project security and consistency. Therefore it's essential that if you do include files outside src, you do so explicitly.)
To use files from the shared directory, we need to:
1. Modify ModuleScopePlugin to allow imports from the shared directory.
2. Update the TypeScript loader rule to process TypeScript files from the shared directory.
These changes tell webpack it's okay to import from the shared directory and ensure that TypeScript files in this directory are properly converted to JavaScript.

Modify webpack configuration to process TypeScript files from shared directory

This code modifies the webpack configuration to allow processing of TypeScript files from our shared directory, which is outside the standard src folder.
1. config.module.rules[1]: In Create React App's webpack config, the second rule (index 1) typically contains the rules for processing JavaScript and TypeScript files.
2. .oneOf: This array contains a list of loaders, and webpack will use the first matching loader for each file. We iterate through these to find the TypeScript loader.
3. We check each rule to see if it applies to TypeScript files by looking for 'ts|tsx' in the test regex.
4. When we find the TypeScript rule, we add our shared directory to its 'include' array. This tells webpack to also process TypeScript files from the shared directory.
Note: This code assumes a specific structure in the CRA webpack config. If CRA updates its config structure in future versions, this code might need to be adjusted.
*/
config.module.rules[1].oneOf.forEach((rule) => {
	if (rule.test && rule.test.toString().includes("ts|tsx")) {
		// rule.include is path to src by default, but we can update rule.include to be an array as it matches an expected schema by react-scripts
		rule.include = [rule.include, sharedDir].filter(Boolean)
	}
})

// Disable code splitting
config.optimization.splitChunks = {
	cacheGroups: {
		default: false,
	},
}

// Disable code chunks
config.optimization.runtimeChunk = false

// Rename main.{hash}.js to main.js
config.output.filename = "static/js/[name].js"

// Rename main.{hash}.css to main.css
config.plugins[5].options.filename = "static/css/[name].css"
config.plugins[5].options.moduleFilename = () => "static/css/main.css"
