/*
- function declarations (with associated comments)
- method declarations (with associated comments)
- type specifications
- struct definitions
- interface definitions
- constant declarations
- variable declarations
- type aliases
- init functions
- anonymous functions
*/
export default `
; Function declarations with associated comments
(
  (comment)* @doc
  .
  (function_declaration
    name: (identifier) @name.definition.function) @definition.function
  (#strip! @doc "^//\\s*")
  (#set-adjacent! @doc @definition.function)
)

; Method declarations with associated comments
(
  (comment)* @doc
  .
  (method_declaration
    name: (field_identifier) @name.definition.method) @definition.method
  (#strip! @doc "^//\\s*")
  (#set-adjacent! @doc @definition.method)
)

; Type specifications
(type_spec
  name: (type_identifier) @name.definition.type) @definition.type

; Struct definitions
(type_spec
  name: (type_identifier) @name.definition.struct
  type: (struct_type)) @definition.struct

; Interface definitions
(type_spec
  name: (type_identifier) @name.definition.interface
  type: (interface_type)) @definition.interface

; Constant declarations - single constant
(const_declaration
  (const_spec
    name: (identifier) @name.definition.constant)) @definition.constant

; Constant declarations - multiple constants in a block
(const_spec
  name: (identifier) @name.definition.constant) @definition.constant

; Variable declarations - single variable
(var_declaration
  (var_spec
    name: (identifier) @name.definition.variable)) @definition.variable

; Variable declarations - multiple variables in a block
(var_spec
  name: (identifier) @name.definition.variable) @definition.variable

; Type aliases
(type_spec
  name: (type_identifier) @name.definition.type_alias
  type: (type_identifier)) @definition.type_alias

; Init functions
(function_declaration
  name: (identifier) @name.definition.init_function
  (#eq? @name.definition.init_function "init")) @definition.init_function

; Anonymous functions
(func_literal) @definition.anonymous_function
`
