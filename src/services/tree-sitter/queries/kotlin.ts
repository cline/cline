/*
- class declarations (regular, data, abstract, sealed, enum, annotation)
- interface declarations
- function declarations (regular, suspend, extension)
- object declarations (including companion objects)
- property declarations and accessors
- type aliases and constructors
*/
export default `
; Type alias declarations
(type_alias
  (type_identifier) @name.definition.type_alias
) @definition.type_alias

; Regular class declarations
(class_declaration
  (type_identifier) @name.definition.class
) @definition.class

; Data class declarations
(class_declaration
  (modifiers
    (class_modifier) @_modifier (#eq? @_modifier "data"))
  (type_identifier) @name.definition.data_class
) @definition.data_class

; Abstract class declarations
(class_declaration
  (modifiers
    (inheritance_modifier) @_modifier (#eq? @_modifier "abstract"))
  (type_identifier) @name.definition.abstract_class
) @definition.abstract_class

; Sealed class declarations
(class_declaration
  (modifiers
    (class_modifier) @_modifier (#eq? @_modifier "sealed"))
  (type_identifier) @name.definition.sealed_class
) @definition.sealed_class

; Enum class declarations
(class_declaration
  (type_identifier)
  (enum_class_body)
) @definition.enum_class

; Interface declarations
(class_declaration
  (type_identifier) @name.definition.interface
) @definition.interface

; Regular function declarations
(function_declaration
  (simple_identifier) @name.definition.function
) @definition.function


; Suspend function declarations
(function_declaration
  (modifiers
    (function_modifier) @_modifier (#eq? @_modifier "suspend"))
  (simple_identifier) @name.definition.suspend_function
) @definition.suspend_function

; Object declarations
(object_declaration
  (type_identifier) @name.definition.object
) @definition.object

; Companion object declarations
(companion_object) @definition.companion_object



; Annotation class declarations
(class_declaration
  (modifiers
    (class_modifier) @_modifier (#eq? @_modifier "annotation"))
  (type_identifier) @name.definition.annotation_class
) @definition.annotation_class
; Extension function declarations
(function_declaration
  (modifiers
    (function_modifier) @_modifier (#eq? @_modifier "extension"))
  (simple_identifier) @name.definition.extension_function
) @definition.extension_function

; Primary constructor declarations
(class_declaration
  (primary_constructor) @definition.primary_constructor
)

; Secondary constructor declarations
(secondary_constructor) @definition.secondary_constructor

; Property declarations
(property_declaration
  (variable_declaration
    (simple_identifier) @name.definition.property)
) @definition.property

; Property declarations with accessors
(property_declaration
  (variable_declaration
    (simple_identifier) @name.definition.property)
  (getter)? @definition.getter
  (setter)? @definition.setter
) @definition.property_with_accessors

`
