/*
C# Tree-Sitter Query Patterns
*/
export default `
; Using directives
(using_directive) @name.definition.using

; Namespace declarations (including file-scoped)
(namespace_declaration
  name: (identifier) @name.definition.namespace)
(file_scoped_namespace_declaration
  name: (identifier) @name.definition.namespace)

; Class declarations (including generic, static, abstract, partial, nested)
(class_declaration
  name: (identifier) @name.definition.class)

; Interface declarations
(interface_declaration
  name: (identifier) @name.definition.interface)

; Struct declarations
(struct_declaration
  name: (identifier) @name.definition.struct)

; Enum declarations
(enum_declaration
  name: (identifier) @name.definition.enum)

; Record declarations
(record_declaration
  name: (identifier) @name.definition.record)

; Method declarations (including async, static, generic)
(method_declaration
  name: (identifier) @name.definition.method)

; Property declarations
(property_declaration
  name: (identifier) @name.definition.property)

; Event declarations
(event_declaration
  name: (identifier) @name.definition.event)

; Delegate declarations
(delegate_declaration
  name: (identifier) @name.definition.delegate)

; Attribute declarations
(class_declaration
  (attribute_list
    (attribute
      name: (identifier) @name.definition.attribute)))

; Generic type parameters
(type_parameter_list
  (type_parameter
    name: (identifier) @name.definition.type_parameter))

; LINQ expressions
(query_expression) @name.definition.linq_expression
`
