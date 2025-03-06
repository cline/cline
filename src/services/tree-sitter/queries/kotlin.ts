/*
Minimal Kotlin query capturing class, function, and interface declarations.
See tree-sitter-kotlin's grammar for more advanced captures:
https://github.com/tree-sitter/tree-sitter-kotlin
*/

export default `
(class_declaration
  name: (simple_identifier) @name.definition.class) @definition.class

(function_declaration
  name: (simple_identifier) @name.definition.function) @definition.function

(interface_declaration
  name: (simple_identifier) @name.definition.interface) @definition.interface

(object_declaration
  name: (simple_identifier) @name.definition.object) @definition.object

(property_declaration
  name: (simple_identifier) @name.definition.property) @definition.property
`
