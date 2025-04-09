/*
- function signatures and declarations
- method signatures and definitions
- abstract method signatures
- class declarations (including abstract classes)
- module declarations
- arrow functions (lambda functions)
- switch/case statements with complex case blocks
- enum declarations with members
- namespace declarations
- utility types
- class members and properties
- constructor methods
- getter/setter methods
- async functions and arrow functions
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

(call_expression
  function: (identifier) @func_name
  arguments: (arguments
    (string) @name
    [(arrow_function) (function_expression)]) @definition.test)
  (#match? @func_name "^(describe|test|it)$")

(assignment_expression
  left: (member_expression
    object: (identifier) @obj
    property: (property_identifier) @prop)
  right: [(arrow_function) (function_expression)]) @definition.test
  (#eq? @obj "exports")
  (#eq? @prop "test")
(arrow_function) @definition.lambda

; Switch statements and case clauses
(switch_statement) @definition.switch

; Individual case clauses with their blocks
(switch_case) @definition.case

; Default clause
(switch_default) @definition.default

; Enum declarations
(enum_declaration
  name: (identifier) @name.definition.enum) @definition.enum

; Decorator definitions with decorated class
(export_statement
  decorator: (decorator
    (call_expression
      function: (identifier) @name.definition.decorator))
  declaration: (class_declaration
    name: (type_identifier) @name.definition.decorated_class)) @definition.decorated_class

; Explicitly capture class name in decorated class
(class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

; Namespace declarations
(internal_module
  name: (identifier) @name.definition.namespace) @definition.namespace

; Interface declarations with generic type parameters and constraints
(interface_declaration
  name: (type_identifier) @name.definition.interface
  type_parameters: (type_parameters)?) @definition.interface

; Type alias declarations with generic type parameters and constraints
(type_alias_declaration
  name: (type_identifier) @name.definition.type
  type_parameters: (type_parameters)?) @definition.type

; Utility Types
(type_alias_declaration
  name: (type_identifier) @name.definition.utility_type) @definition.utility_type

; Class Members and Properties
(public_field_definition
  name: (property_identifier) @name.definition.property) @definition.property

; Constructor
(method_definition
  name: (property_identifier) @name.definition.constructor
  (#eq? @name.definition.constructor "constructor")) @definition.constructor

; Getter/Setter Methods
(method_definition
  name: (property_identifier) @name.definition.accessor) @definition.accessor

; Async Functions
(function_declaration
  name: (identifier) @name.definition.async_function) @definition.async_function

; Async Arrow Functions
(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition.async_arrow
    value: (arrow_function))) @definition.async_arrow
`
