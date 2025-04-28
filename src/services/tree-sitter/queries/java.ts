/*
Query patterns for Java language structures
*/
export default `
; Module declarations
(module_declaration
  name: (scoped_identifier) @name.definition.module) @definition.module

; Package declarations
((package_declaration
  (scoped_identifier)) @name.definition.package) @definition.package

; Line comments
(line_comment) @definition.comment

; Class declarations
(class_declaration
  name: (identifier) @name.definition.class) @definition.class

; Interface declarations
(interface_declaration
  name: (identifier) @name.definition.interface) @definition.interface

; Enum declarations
(enum_declaration
  name: (identifier) @name.definition.enum) @definition.enum

; Record declarations
(record_declaration
  name: (identifier) @name.definition.record) @definition.record

; Annotation declarations
(annotation_type_declaration
  name: (identifier) @name.definition.annotation) @definition.annotation

; Constructor declarations
(constructor_declaration
  name: (identifier) @name.definition.constructor) @definition.constructor

; Method declarations
(method_declaration
  name: (identifier) @name.definition.method) @definition.method

; Inner class declarations
(class_declaration
  (class_body
    (class_declaration
      name: (identifier) @name.definition.inner_class))) @definition.inner_class

; Static nested class declarations
(class_declaration
  (class_body
    (class_declaration
      name: (identifier) @name.definition.static_nested_class))) @definition.static_nested_class

; Lambda expressions
(lambda_expression) @definition.lambda

; Field declarations
(field_declaration
  (modifiers)?
  type: (_)
  declarator: (variable_declarator
    name: (identifier) @name.definition.field)) @definition.field

; Import declarations
(import_declaration
  (scoped_identifier) @name.definition.import) @definition.import

; Type parameters
(type_parameters
  (type_parameter) @name.definition.type_parameter) @definition.type_parameter
`
