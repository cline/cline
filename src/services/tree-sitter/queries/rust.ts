/*
- struct definitions
- method definitions
- function definitions
- enum definitions
- trait definitions
- impl trait for struct
- generic structs with lifetime parameters
- macro definitions
- modules
- type aliases
- constants
- static variables
- associated types
- union types
- closures
- match expressions
- where clauses
- attribute macros
- async functions and blocks
- impl blocks with generic parameters
- complex trait bounds
*/
export default `
; Struct definitions
(struct_item
    name: (type_identifier) @name.definition.class) @definition.class

; Method definitions within impl blocks
(declaration_list
    (function_item
        name: (identifier) @name.definition.method)) @definition.method

; Standalone function definitions
(function_item
    name: (identifier) @name.definition.function) @definition.function

; Enum definitions
(enum_item
    name: (type_identifier) @name.definition.enum) @definition.enum

; Trait definitions
(trait_item
    name: (type_identifier) @name.definition.trait) @definition.trait

; Impl trait for struct
(impl_item
    trait: (type_identifier) @name.definition.impl_trait
    type: (type_identifier) @name.definition.impl_for) @definition.impl_trait

; Generic structs with lifetime parameters
(struct_item
    name: (type_identifier) @name.definition.generic_class
    type_parameters: (type_parameters) @type_parameters) @definition.generic_class

; Macro definitions
(macro_definition
    name: (identifier) @name.definition.macro) @definition.macro

; Module definitions
(mod_item
    name: (identifier) @name.definition.module) @definition.module

; Type aliases
(type_item
    name: (type_identifier) @name.definition.type) @definition.type

; Constants
(const_item
    name: (identifier) @name.definition.constant) @definition.constant

; Static variables
(static_item
    name: (identifier) @name.definition.static) @definition.static

; Union types
(union_item
    name: (type_identifier) @name.definition.union) @definition.union

; Associated types in traits
(associated_type
    name: (type_identifier) @name.definition.associated_type) @definition.associated_type

; Closures
(closure_expression) @definition.closure

; Match expressions
(match_expression) @definition.match

; Where clauses
(where_clause) @definition.where_clause

; Attribute macros
(attribute_item) @definition.attribute

; Async functions
(function_item
    (function_modifiers)
    name: (identifier) @name.definition.async_function) @definition.async_function

; Impl blocks with generic parameters
(impl_item
    type_parameters: (type_parameters) @type_parameters) @definition.generic_impl

; Complex trait bounds
(trait_bounds) @definition.trait_bounds
`
