/*
- function signatures and declarations
- method signatures and definitions
- abstract method signatures
- class declarations (including abstract classes)
- module declarations
*/
export default `
(function_signature
  name: (identifier) @name.definition.function) @definition.function

(method_signature
  name: (property_identifier) @name.definition.method) @definition.method

(abstract_method_signature
  name: (property_identifier) @name.definition.method) @definition.method

(abstract_class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

(module
  name: (identifier) @name.definition.module) @definition.module

(function_declaration
  name: (identifier) @name.definition.function) @definition.function

(method_definition
  name: (property_identifier) @name.definition.method) @definition.method

(class_declaration
  name: (type_identifier) @name.definition.class) @definition.class
`
