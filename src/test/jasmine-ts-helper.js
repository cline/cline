const ts = require('ts-node');
const { SpecReporter } = require('jasmine-spec-reporter');

// Register TypeScript compiler
ts.register({
    transpileOnly: true,
    project: './tsconfig.json'
});

// Configure Jasmine reporter
jasmine.getEnv().clearReporters();
jasmine.getEnv().addReporter(new SpecReporter({
    spec: {
        displayPending: true,
        displayStacktrace: true
    }
}));
