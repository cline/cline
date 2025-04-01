import fs from 'node:fs'
import path from 'path'

import Parser, { Language } from 'web-tree-sitter'
import { getUriFileExtension } from '../../utils/uri'
import { FileSymbolMap, SymbolWithRange } from '../types'
import { readFile } from '../../utils/vscode'

export enum LanguageName {
    CPP = 'cpp',
    C_SHARP = 'c_sharp',
    C = 'c',
    CSS = 'css',
    PHP = 'php',
    BASH = 'bash',
    JSON = 'json',
    TYPESCRIPT = 'typescript',
    TSX = 'tsx',
    ELM = 'elm',
    JAVASCRIPT = 'javascript',
    PYTHON = 'python',
    ELISP = 'elisp',
    ELIXIR = 'elixir',
    GO = 'go',
    EMBEDDED_TEMPLATE = 'embedded_template',
    HTML = 'html',
    JAVA = 'java',
    LUA = 'lua',
    OCAML = 'ocaml',
    QL = 'ql',
    RESCRIPT = 'rescript',
    RUBY = 'ruby',
    RUST = 'rust',
    SYSTEMRDL = 'systemrdl',
    TOML = 'toml',
    SOLIDITY = 'solidity',
}

export const supportedLanguages: { [key: string]: LanguageName } = {
    cpp: LanguageName.CPP,
    hpp: LanguageName.CPP,
    cc: LanguageName.CPP,
    cxx: LanguageName.CPP,
    hxx: LanguageName.CPP,
    cp: LanguageName.CPP,
    hh: LanguageName.CPP,
    inc: LanguageName.CPP,
    // Depended on this PR: https://github.com/tree-sitter/tree-sitter-cpp/pull/173
    // ccm: LanguageName.CPP,
    // c++m: LanguageName.CPP,
    // cppm: LanguageName.CPP,
    // cxxm: LanguageName.CPP,
    cs: LanguageName.C_SHARP,
    c: LanguageName.C,
    h: LanguageName.C,
    css: LanguageName.CSS,
    php: LanguageName.PHP,
    phtml: LanguageName.PHP,
    php3: LanguageName.PHP,
    php4: LanguageName.PHP,
    php5: LanguageName.PHP,
    php7: LanguageName.PHP,
    phps: LanguageName.PHP,
    'php-s': LanguageName.PHP,
    bash: LanguageName.BASH,
    sh: LanguageName.BASH,
    json: LanguageName.JSON,
    ts: LanguageName.TYPESCRIPT,
    mts: LanguageName.TYPESCRIPT,
    cts: LanguageName.TYPESCRIPT,
    tsx: LanguageName.TSX,
    // vue: LanguageName.VUE,  // tree-sitter-vue parser is broken
    // The .wasm file being used is faulty, and yaml is split line-by-line anyway for the most part
    // yaml: LanguageName.YAML,
    // yml: LanguageName.YAML,
    elm: LanguageName.ELM,
    js: LanguageName.JAVASCRIPT,
    jsx: LanguageName.JAVASCRIPT,
    mjs: LanguageName.JAVASCRIPT,
    cjs: LanguageName.JAVASCRIPT,
    py: LanguageName.PYTHON,
    // ipynb: LanguageName.PYTHON, // It contains Python, but the file format is a ton of JSON.
    pyw: LanguageName.PYTHON,
    pyi: LanguageName.PYTHON,
    el: LanguageName.ELISP,
    emacs: LanguageName.ELISP,
    ex: LanguageName.ELIXIR,
    exs: LanguageName.ELIXIR,
    go: LanguageName.GO,
    eex: LanguageName.EMBEDDED_TEMPLATE,
    heex: LanguageName.EMBEDDED_TEMPLATE,
    leex: LanguageName.EMBEDDED_TEMPLATE,
    html: LanguageName.HTML,
    htm: LanguageName.HTML,
    java: LanguageName.JAVA,
    lua: LanguageName.LUA,
    luau: LanguageName.LUA,
    ocaml: LanguageName.OCAML,
    ml: LanguageName.OCAML,
    mli: LanguageName.OCAML,
    ql: LanguageName.QL,
    res: LanguageName.RESCRIPT,
    resi: LanguageName.RESCRIPT,
    rb: LanguageName.RUBY,
    erb: LanguageName.RUBY,
    rs: LanguageName.RUST,
    rdl: LanguageName.SYSTEMRDL,
    toml: LanguageName.TOML,
    sol: LanguageName.SOLIDITY,

    // jl: LanguageName.JULIA,
    // swift: LanguageName.SWIFT,
    // kt: LanguageName.KOTLIN,
    // scala: LanguageName.SCALA,
}

export const IGNORE_PATH_PATTERNS: Partial<Record<LanguageName, RegExp[]>> = {
    [LanguageName.TYPESCRIPT]: [/.*node_modules/],
    [LanguageName.JAVASCRIPT]: [/.*node_modules/],
}

export async function getParserForFile(filepath: string) {
    try {
        await Parser.init()
        const parser = new Parser()

        const language = await getLanguageForFile(filepath)
        if (!language) {
            return undefined
        }

        parser.setLanguage(language)

        return parser
    } catch (e) {
        console.debug('Unable to load language for file', filepath, e)
        return undefined
    }
}

// Loading the wasm files to create a Language object is an expensive operation and with
// sufficient number of files can result in errors, instead keep a map of language name
// to Language object
const nameToLanguage = new Map<string, Language>()

export async function getLanguageForFile(filepath: string): Promise<Language | undefined> {
    try {
        await Parser.init()
        const extension = getUriFileExtension(filepath)

        const languageName = supportedLanguages[extension]
        if (!languageName) {
            return undefined
        }
        let language = nameToLanguage.get(languageName)

        if (!language) {
            language = await loadLanguageForFileExt(extension)
            nameToLanguage.set(languageName, language)
        }
        return language
    } catch (e) {
        console.debug('Unable to load language for file', filepath, e)
        return undefined
    }
}

export const getFullLanguageName = (filepath: string) => {
    const extension = getUriFileExtension(filepath)
    return supportedLanguages[extension]
}

export async function getQueryForFile(filepath: string, queryPath: string): Promise<Parser.Query | undefined> {
    const language = await getLanguageForFile(filepath)
    if (!language) {
        return undefined
    }

    const sourcePath = path.join(
        __dirname,
        '..',
        ...(process.env.NODE_ENV === 'test' ? ['extensions', 'vscode', 'tree-sitter'] : ['tree-sitter']),
        queryPath
    )
    if (!fs.existsSync(sourcePath)) {
        return undefined
    }
    const querySource = fs.readFileSync(sourcePath).toString()

    const query = language.query(querySource)
    return query
}

async function loadLanguageForFileExt(fileExtension: string): Promise<Language> {
    return await Parser.Language.load(path.join(__dirname, `tree-sitter-${supportedLanguages[fileExtension]}.wasm`))
}

// See https://tree-sitter.github.io/tree-sitter/using-parsers
const GET_SYMBOLS_FOR_NODE_TYPES: Parser.SyntaxNode['type'][] = [
    'class_declaration',
    'class_definition',
    'function_item', // function name = first "identifier" child
    'function_definition',
    'method_declaration', // method name = first "identifier" child
    'method_definition',
    'generator_function_declaration',
    // property_identifier
    // field_declaration
    // "arrow_function",
]

export async function getSymbolsForFile(filepath: string, contents: string): Promise<SymbolWithRange[] | undefined> {
    const parser = await getParserForFile(filepath)
    if (!parser) {
        return
    }

    let tree: Parser.Tree
    try {
        tree = parser.parse(contents)
    } catch (e) {
        console.log(`Error parsing file: ${filepath}`)
        return
    }
    // console.log(`file: ${filepath}`);

    // Function to recursively find all named nodes (classes and functions)
    const symbols: SymbolWithRange[] = []
    function findNamedNodesRecursive(node: Parser.SyntaxNode) {
        // console.log(`node: ${node.type}, ${node.text}`);
        if (GET_SYMBOLS_FOR_NODE_TYPES.includes(node.type)) {
            // console.log(`parent: ${node.type}, ${node.text.substring(0, 200)}`);
            // node.children.forEach((child) => {
            //   console.log(`child: ${child.type}, ${child.text}`);
            // });

            // Empirically, the actual name is the last identifier in the node
            // Especially with languages where return type is declared before the name
            // TODO use findLast in newer version of node target
            let identifier: Parser.SyntaxNode | undefined = undefined
            for (let i = node.children.length - 1; i >= 0; i--) {
                if (node.children[i].type === 'identifier' || node.children[i].type === 'property_identifier') {
                    identifier = node.children[i]
                    break
                }
            }

            if (identifier?.text) {
                symbols.push({
                    filepath,
                    type: node.type,
                    name: identifier.text,
                    range: {
                        start: {
                            character: node.startPosition.column,
                            line: node.startPosition.row,
                        },
                        end: {
                            character: node.endPosition.column + 1,
                            line: node.endPosition.row + 1,
                        },
                    },
                    content: node.text,
                })
            }
        }
        node.children.forEach(findNamedNodesRecursive)
    }
    findNamedNodesRecursive(tree.rootNode)
    return symbols
}

export async function getSymbolsForManyFiles(uris: string[]): Promise<FileSymbolMap> {
    const filesAndSymbols = await Promise.all(
        uris.map(async (uri): Promise<[string, SymbolWithRange[]]> => {
            const contents = await readFile(uri)
            let symbols = undefined
            try {
                symbols = await getSymbolsForFile(uri, contents)
            } catch (e) {
                console.error(`Failed to get symbols for ${uri}:`, e)
            }
            return [uri, symbols ?? []]
        })
    )
    return Object.fromEntries(filesAndSymbols)
}
