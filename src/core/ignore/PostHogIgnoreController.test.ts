import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { after, beforeEach, describe, it } from 'mocha'
import 'should'
import { PostHogIgnoreController } from './PostHogIgnoreController'

describe('PostHogIgnoreController', () => {
    let tempDir: string
    let controller: PostHogIgnoreController

    beforeEach(async () => {
        tempDir = path.join(os.tmpdir(), `llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        await fs.mkdir(tempDir)

        await fs.writeFile(
            path.join(tempDir, '.gitignore'),
            [
                '.env',
                '*.secret',
                'private/',
                '# This is a comment',
                '',
                'temp.*',
                'file-with-space-at-end.* ',
                '**/.git/**',
            ].join('\n')
        )

        controller = new PostHogIgnoreController(tempDir)
        await controller.initialize()
    })

    after(async () => {
        await fs.rm(tempDir, { recursive: true, force: true })
    })

    describe('Default Patterns', () => {
        it('should allow access to regular files', async () => {
            const results = [
                controller.validateAccess('src/index.ts'),
                controller.validateAccess('README.md'),
                controller.validateAccess('package.json'),
            ]
            results.forEach((result) => result.should.be.true())
        })

        it('should block access to .gitignore file', async () => {
            const result = controller.validateAccess('.gitignore')
            result.should.be.false()
        })
    })

    describe('Custom Patterns', () => {
        it('should block access to custom ignored patterns', async () => {
            const results = [
                controller.validateAccess('config.secret'),
                controller.validateAccess('private/data.txt'),
                controller.validateAccess('temp.json'),
                controller.validateAccess('nested/deep/file.secret'),
                controller.validateAccess('private/nested/deep/file.txt'),
            ]
            results.forEach((result) => result.should.be.false())
        })

        it('should allow access to non-ignored files', async () => {
            const results = [
                controller.validateAccess('public/data.txt'),
                controller.validateAccess('config.json'),
                controller.validateAccess('src/temp/file.ts'),
                controller.validateAccess('nested/deep/file.txt'),
                controller.validateAccess('not-private/data.txt'),
            ]
            results.forEach((result) => result.should.be.true())
        })

        it('should handle pattern edge cases', async () => {
            await fs.writeFile(
                path.join(tempDir, '.gitignore'),
                ['*.secret', 'private/', '*.tmp', 'data-*.json', 'temp/*'].join('\n')
            )

            controller = new PostHogIgnoreController(tempDir)
            await controller.initialize()

            const results = [
                controller.validateAccess('data-123.json'),
                controller.validateAccess('data.json'),
                controller.validateAccess('script.tmp'),
            ]

            results[0].should.be.false()
            results[1].should.be.true()
            results[2].should.be.false()
        })

        it('should handle nested directory patterns', async () => {
            await fs.writeFile(
                path.join(tempDir, '.gitignore'),
                ['src/**/test/', 'dist/**/*.map', '**/node_modules/**'].join('\n')
            )

            controller = new PostHogIgnoreController(tempDir)
            await controller.initialize()

            const testPaths = [
                'src/components/test/Component.tsx',
                'src/components/Component.tsx',
                'dist/main.js.map',
                'dist/main.js',
                'node_modules/react/index.js',
                'src/node_modules/local/index.js',
            ]

            const results = testPaths.map((testPath) => {
                const result = controller.validateAccess(testPath)
                const absolutePath = path.resolve(tempDir, testPath)
                const relativePath = path.relative(tempDir, absolutePath).toPosix()
                console.log(
                    `Testing path: ${testPath}, absolute: ${absolutePath}, relative: ${relativePath}, result: ${result}`
                )
                return result
            })

            results[0].should.be.false() // src/components/test/Component.tsx
            results[1].should.be.true() // src/components/Component.tsx
            results[2].should.be.false() // dist/main.js.map
            results[3].should.be.true() // dist/main.js
            results[4].should.be.false() // node_modules/react/index.js
            results[5].should.be.false() // src/node_modules/local/index.js
        })

        it('should handle complex pattern combinations', async () => {
            await fs.writeFile(
                path.join(tempDir, '.gitignore'),
                ['*.log', 'logs/', '*.tmp', 'temp/', '**/build/', 'coverage/', '*.min.js', '*.min.css'].join('\n')
            )

            controller = new PostHogIgnoreController(tempDir)
            await controller.initialize()

            const results = [
                controller.validateAccess('app.log'), // Should be false (matches *.log)
                controller.validateAccess('logs/error.log'), // Should be false (matches logs/)
                controller.validateAccess('temp/data.tmp'), // Should be false (matches both *.tmp and temp/)
                controller.validateAccess('src/build/index.js'), // Should be false (matches **/build/)
                controller.validateAccess('coverage/lcov.info'), // Should be false (matches coverage/)
                controller.validateAccess('dist/app.min.js'), // Should be false (matches *.min.js)
                controller.validateAccess('dist/styles.min.css'), // Should be false (matches *.min.css)
                controller.validateAccess('src/index.js'), // Should be true
                controller.validateAccess('styles.css'), // Should be true
            ]

            results.forEach((result, i) => {
                const expected = i < 7 ? false : true
                result.should.equal(expected, `Test case ${i} failed`)
            })
        })

        it('should handle comments in .gitignore', async () => {
            // Create a new .gitignore with comments
            await fs.writeFile(
                path.join(tempDir, '.gitignore'),
                ['# Comment line', '*.secret', 'private/', 'temp.*'].join('\n')
            )

            controller = new PostHogIgnoreController(tempDir)
            await controller.initialize()

            const result = controller.validateAccess('test.secret')
            result.should.be.false()
        })
    })

    describe('Path Handling', () => {
        it('should handle absolute paths and match ignore patterns', async () => {
            // Test absolute path that should be allowed
            const allowedPath = path.join(tempDir, 'src/file.ts')
            const allowedResult = controller.validateAccess(allowedPath)
            allowedResult.should.be.true()

            // Test absolute path that matches an ignore pattern (*.secret)
            const ignoredPath = path.join(tempDir, 'config.secret')
            const ignoredResult = controller.validateAccess(ignoredPath)
            ignoredResult.should.be.false()

            // Test absolute path in ignored directory (private/)
            const ignoredDirPath = path.join(tempDir, 'private/data.txt')
            const ignoredDirResult = controller.validateAccess(ignoredDirPath)
            ignoredDirResult.should.be.false()
        })

        it('should handle relative paths and match ignore patterns', async () => {
            // Test relative path that should be allowed
            const allowedResult = controller.validateAccess('./src/file.ts')
            allowedResult.should.be.true()

            // Test relative path that matches an ignore pattern (*.secret)
            const ignoredResult = controller.validateAccess('./config.secret')
            ignoredResult.should.be.false()

            // Test relative path in ignored directory (private/)
            const ignoredDirResult = controller.validateAccess('./private/data.txt')
            ignoredDirResult.should.be.false()
        })

        it('should normalize paths with backslashes', async () => {
            const result = controller.validateAccess('src\\file.ts')
            result.should.be.true()
        })
    })

    describe('Batch Filtering', () => {
        it('should filter an array of paths', async () => {
            const paths = ['src/index.ts', '.env', 'lib/utils.ts', '.git/config', 'dist/bundle.js']

            const filtered = controller.filterPaths(paths)
            filtered.should.deepEqual(['src/index.ts', 'lib/utils.ts', 'dist/bundle.js'])
        })
    })

    describe('Error Handling', () => {
        it('should handle invalid paths', async () => {
            // Test with an invalid path containing null byte
            const result = controller.validateAccess('\0invalid')
            result.should.be.true()
        })

        it('should handle missing .gitignore gracefully', async () => {
            // Create a new controller in a directory without .gitignore
            const emptyDir = path.join(os.tmpdir(), `llm-test-empty-${Date.now()}`)
            await fs.mkdir(emptyDir)

            try {
                const controller = new PostHogIgnoreController(emptyDir)
                await controller.initialize()
                const result = controller.validateAccess('file.txt')
                result.should.be.true()
            } finally {
                await fs.rm(emptyDir, { recursive: true, force: true })
            }
        })

        it('should handle empty .gitignore', async () => {
            await fs.writeFile(path.join(tempDir, '.gitignore'), '')

            controller = new PostHogIgnoreController(tempDir)
            await controller.initialize()

            const result = controller.validateAccess('regular-file.txt')
            result.should.be.true()
        })
    })
})
