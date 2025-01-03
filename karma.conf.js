module.exports = function (config) {
  config.set({
    // base path that will be used to resolve all patterns (eg. files, exclude)
    basePath: '',

    // frameworks to use
    // available frameworks: https://www.npmjs.com/search?q=keywords:karma-adapter
    frameworks: ['jasmine'],

    // list of files / patterns to load in the browser
    files: [
      { pattern: 'node_modules/jasmine-core/lib/jasmine-core/jasmine.js', watched: false },
      { pattern: 'node_modules/jasmine-core/lib/jasmine-core/jasmine-html.js', watched: false },
      { pattern: 'node_modules/jasmine-core/lib/jasmine-core/boot.js', watched: false },
      { pattern: 'src/test/**/*.spec.ts', type: 'module' }
    ],

    // list of files / patterns to exclude
    exclude: [
      '**/node_modules/**'
    ],

    // preprocess matching files before serving them to the browser
    // available preprocessors: https://www.npmjs.com/search?q=keywords:karma-preprocessor
    preprocessors: {
      '**/*.ts': ['typescript']
    },

    // test results reporter to use
    // possible values: 'dots', 'progress'
    // available reporters: https://www.npmjs.com/search?q=keywords:karma-reporter
    reporters: ['progress'],

    // web server port
    port: 9876,

    // enable / disable colors in the output (reporters and logs)
    colors: true,

    // level of logging
    // possible values: config.LOG_DISABLE || config.LOG_ERROR || config.LOG_WARN || config.LOG_INFO || config.LOG_DEBUG
    logLevel: config.LOG_INFO,

    // enable / disable watching file and executing tests whenever any file changes
    autoWatch: false,

    // start these browsers
    // available browser launchers: https://www.npmjs.com/search?q=keywords:karma-launcher
    browsers: ['ChromeHeadless'],

    // Continuous Integration mode
    // if true, Karma captures browsers, runs the tests and exits
    singleRun: true,

    // Concurrency level
    // how many browser instances should be started simultaneously
    concurrency: Infinity,

    // TypeScript configuration
    typescriptPreprocessor: {
      options: {
        sourceMap: true,
        target: 'ES2020',
        module: 'commonjs',
        strict: true
      },
      transformPath: function(path) {
        return path.replace(/\.ts$/, '.js');
      }
    }
  });
};
