const { override } = require('customize-cra');

module.exports = override();

// Jest configuration override
module.exports.jest = function(config) {
    // Configure reporters
    config.reporters = [["jest-simple-dot-reporter", {}]];
    
    // Configure module name mapper for CSS modules
    config.moduleNameMapper = {
        ...config.moduleNameMapper,
        "\\.(css|less|scss|sass)$": "identity-obj-proxy"
    };
    
    // Configure transform ignore patterns for ES modules
    config.transformIgnorePatterns = [
        '/node_modules/(?!(rehype-highlight|react-remark|unist-util-visit|unist-util-find-after|vfile|unified|bail|is-plain-obj|trough|vfile-message|unist-util-stringify-position|mdast-util-from-markdown|mdast-util-to-string|micromark|decode-named-character-reference|character-entities|markdown-table|zwitch|longest-streak|escape-string-regexp|unist-util-is|hast-util-to-text|@vscode/webview-ui-toolkit|@microsoft/fast-react-wrapper|@microsoft/fast-element|@microsoft/fast-foundation|@microsoft/fast-web-utilities|exenv-es6)/)'
    ];
    
    return config;
}