const esbuild = require('esbuild')
const fs = require('fs')
const path = require('path')

const production = process.argv.includes('--production')
const watch = process.argv.includes('--watch')

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',

    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started')
        })
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`)
                console.error(`    ${location.file}:${location.line}:${location.column}:`)
            })
            console.log('[watch] build finished')
        })
    },
}

const copyNativeModules = {
    name: 'copy-native-modules',
    setup(build) {
        build.onEnd(() => {
            const distDir = path.join(__dirname, 'dist')
            const nodeModulesDir = path.join(__dirname, 'node_modules')

            // Copy SQLite3 binary
            const sqliteBinaryPath = require.resolve('sqlite3')
            const sqliteBinaryDir = path.dirname(sqliteBinaryPath)
            const binaryFiles = fs.readdirSync(sqliteBinaryDir).filter((file) => file.endsWith('.node'))

            binaryFiles.forEach((file) => {
                const sourcePath = path.join(sqliteBinaryDir, file)
                const targetPath = path.join(distDir, file)
                fs.copyFileSync(sourcePath, targetPath)
            })
        })
    },
}

const copyWasmFiles = {
    name: 'copy-wasm-files',
    setup(build) {
        build.onEnd(() => {
            const distDir = path.join(__dirname, 'dist')

            // tree sitter
            const sourceDir = path.join(__dirname, 'node_modules', 'web-tree-sitter')

            // Copy tree-sitter.wasm
            fs.copyFileSync(path.join(sourceDir, 'tree-sitter.wasm'), path.join(distDir, 'tree-sitter.wasm'))

            // Copy language-specific WASM files
            const languageWasmDir = path.join(__dirname, 'node_modules', 'tree-sitter-wasms', 'out')
            const languages = [
                'typescript',
                'tsx',
                'python',
                'rust',
                'javascript',
                'go',
                'cpp',
                'c',
                'c_sharp',
                'ruby',
                'java',
                'php',
                'swift',
                'kotlin',
            ]

            languages.forEach((lang) => {
                const filename = `tree-sitter-${lang}.wasm`
                fs.copyFileSync(path.join(languageWasmDir, filename), path.join(distDir, filename))
            })
        })
    },
}

const extensionConfig = {
    bundle: true,
    minify: production,
    sourcemap: !production,
    logLevel: 'silent',
    plugins: [copyWasmFiles, copyNativeModules, esbuildProblemMatcherPlugin],
    entryPoints: ['src/extension.ts'],
    format: 'cjs',
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode', 'sqlite3'],
    target: 'node16',
    mainFields: ['main', 'module'],
}

async function main() {
    const extensionCtx = await esbuild.context(extensionConfig)
    if (watch) {
        await extensionCtx.watch()
    } else {
        await extensionCtx.rebuild()
        await extensionCtx.dispose()
    }
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
