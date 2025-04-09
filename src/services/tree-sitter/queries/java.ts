/*
- class declarations (including inner and anonymous classes)
- method declarations
- interface declarations
- enum declarations and enum constants
- annotation type declarations and elements
- field declarations
- constructor declarations
- lambda expressions
- type parameters (for generics)
- package and import declarations
*/
export default `
; Class declarations
(class_declaration
  name: (identifier) @name.definition.class) @definition.class

; Method declarations
(method_declaration
  name: (identifier) @name.definition.method) @definition.method

; Interface declarations
(interface_declaration
  name: (identifier) @name.definition.interface) @definition.interface

; Enum declarations
(enum_declaration
  name: (identifier) @name.definition.enum) @definition.enum

; Enum constants
(enum_constant
  name: (identifier) @name.definition.enum_constant) @definition.enum_constant

; Annotation type declarations
(annotation_type_declaration
  name: (identifier) @name.definition.annotation) @definition.annotation

; Field declarations
(field_declaration
  declarator: (variable_declarator
    name: (identifier) @name.definition.field)) @definition.field

; Constructor declarations
(constructor_declaration
  name: (identifier) @name.definition.constructor) @definition.constructor

; Inner class declarations
(class_body
  (class_declaration
    name: (identifier) @name.definition.inner_class)) @definition.inner_class

; Anonymous class declarations
(object_creation_expression
  (class_body)) @definition.anonymous_class

; Lambda expressions
(lambda_expression) @definition.lambda

; Type parameters (for generics)
(type_parameters) @definition.type_parameters

; Package declarations
(package_declaration
  (scoped_identifier) @name.definition.package) @definition.package

; Import declarations
(import_declaration) @definition.import
`
