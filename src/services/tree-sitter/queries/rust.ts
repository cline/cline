/*
Rust language structures for tree-sitter parsing
Captures all required constructs for tests
*/
export default `
; Function definitions (all types)
(function_item
    name: (identifier) @name.definition.function) @definition.function

; Struct definitions (all types - standard, tuple, unit)
(struct_item
    name: (type_identifier) @name.definition.struct) @definition.struct

; Enum definitions with variants
(enum_item
    name: (type_identifier) @name.definition.enum) @definition.enum

; Trait definitions
(trait_item
    name: (type_identifier) @name.definition.trait) @definition.trait

; Impl blocks (inherent implementation)
(impl_item
    type: (type_identifier) @name.definition.impl) @definition.impl

; Trait implementations
(impl_item
    trait: (type_identifier) @name.definition.impl_trait
    type: (type_identifier) @name.definition.impl_for) @definition.impl_trait

; Module definitions
(mod_item
    name: (identifier) @name.definition.module) @definition.module

; Macro definitions
(macro_definition
    name: (identifier) @name.definition.macro) @definition.macro

; Attribute macros (for #[derive(...)] etc.)
(attribute_item
    (attribute) @name.definition.attribute) @definition.attribute

; Type aliases
(type_item
    name: (type_identifier) @name.definition.type_alias) @definition.type_alias

; Constants
(const_item
    name: (identifier) @name.definition.constant) @definition.constant

; Static items
(static_item
    name: (identifier) @name.definition.static) @definition.static

; Methods inside impl blocks
(impl_item
    body: (declaration_list
        (function_item
            name: (identifier) @name.definition.method))) @definition.method_container

; Use declarations
(use_declaration) @definition.use_declaration

; Lifetime definitions
(lifetime
    "'" @punctuation.lifetime
    (identifier) @name.definition.lifetime) @definition.lifetime

; Where clauses
(where_clause
    (where_predicate)*) @definition.where_clause

; Match expressions
(match_expression
    value: (_) @match.value
    body: (match_block)) @definition.match

; Unsafe blocks
(unsafe_block) @definition.unsafe_block
`
