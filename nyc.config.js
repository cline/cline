module.exports = {
    extends: '@istanbuljs/nyc-config-typescript',
    include: [
        'src/**/*.ts'
    ],
    exclude: [
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts'
    ],
    reporter: [
        'text',
        'lcov',
        'html'
    ],
    all: true
};
