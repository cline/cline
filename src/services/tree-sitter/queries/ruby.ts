/*
- method definitions (including singleton methods and aliases, with associated comments)
- class definitions (including singleton classes, with associated comments)
- module definitions
- constants
- global variables
- instance variables
- class variables
- symbols
- blocks, procs, and lambdas
- mixins (include, extend, prepend)
- metaprogramming constructs (define_method, method_missing)
- attribute accessors (attr_reader, attr_writer, attr_accessor)
- class macros (has_many, belongs_to, etc. in Rails-like code)
- exception handling (begin/rescue/ensure)
- keyword arguments
- splat operators
- hash rocket and JSON-style hashes
- string interpolation
- regular expressions
- Ruby 2.7+ pattern matching
- Ruby 3.0+ endless methods
- Ruby 3.1+ pin operator and shorthand hash syntax
*/
export default `
; Method definitions
(method
  name: (identifier) @name.definition.method) @definition.method

; Singleton methods
(singleton_method
  object: (_)
  name: (identifier) @name.definition.method) @definition.method

; Method aliases
(alias
  name: (_) @name.definition.method) @definition.method

; Class definitions
(class
  name: [
    (constant) @name.definition.class
    (scope_resolution
      name: (_) @name.definition.class)
  ]) @definition.class

; Singleton classes
(singleton_class
  value: [
    (constant) @name.definition.class
    (scope_resolution
      name: (_) @name.definition.class)
  ]) @definition.class

; Module definitions
(module
  name: [
    (constant) @name.definition.module
    (scope_resolution
      name: (_) @name.definition.module)
  ]) @definition.module

; Constants
(assignment
  left: (constant) @name.definition.constant) @definition.constant

; Global variables
(global_variable) @definition.global_variable

; Instance variables
(instance_variable) @definition.instance_variable

; Class variables
(class_variable) @definition.class_variable

; Symbols
(simple_symbol) @definition.symbol
(hash_key_symbol) @definition.symbol

; Blocks
(block) @definition.block
(do_block) @definition.block

; Basic mixin statements - capture all include/extend/prepend calls
(call
  method: (identifier) @_mixin_method
  arguments: (argument_list
    (constant) @name.definition.mixin)
  (#match? @_mixin_method "^(include|extend|prepend)$")) @definition.mixin

; Mixin module definition
(module
  name: (constant) @name.definition.mixin_module
  (#match? @name.definition.mixin_module ".*Module$")) @definition.mixin_module

; Mixin-related methods
(method
  name: (identifier) @name.definition.mixin_method
  (#match? @name.definition.mixin_method "(included|extended|prepended)_method")) @definition.mixin_method

; Singleton class blocks
(singleton_class) @definition.singleton_class

; Class methods in singleton context
(singleton_method
  object: (self)
  name: (identifier) @name.definition.singleton_method) @definition.singleton_method

; Attribute accessors
(call
  method: (identifier) @_attr_accessor
  arguments: (argument_list
    (_) @name.definition.attr_accessor)
  (#eq? @_attr_accessor "attr_accessor")) @definition.attr_accessor

(call
  method: (identifier) @_attr_reader
  arguments: (argument_list
    (_) @name.definition.attr_reader)
  (#eq? @_attr_reader "attr_reader")) @definition.attr_reader

(call
  method: (identifier) @_attr_writer
  arguments: (argument_list
    (_) @name.definition.attr_writer)
  (#eq? @_attr_writer "attr_writer")) @definition.attr_writer

; Class macros (Rails-like)
(call
  method: (identifier) @_macro_name
  arguments: (argument_list
    (_) @name.definition.class_macro)
  (#match? @_macro_name "^(has_many|belongs_to|has_one|validates|scope|before_action|after_action)$")) @definition.class_macro

; Exception handling
(begin) @definition.begin
(rescue) @definition.rescue
(ensure) @definition.ensure

; Keyword arguments
(keyword_parameter
  name: (identifier) @name.definition.keyword_parameter) @definition.keyword_parameter

; Splat operators
(splat_parameter) @definition.splat_parameter
(splat_argument) @definition.splat_argument

; Hash syntax variants
(pair
  key: (_) @name.definition.hash_key) @definition.hash_pair

; String interpolation - capture the string with interpolation and surrounding context
(assignment
  left: (identifier) @name.definition.string_var
  right: (string
    (interpolation))) @definition.string_interpolation

; Regular expressions - capture the regex pattern and assignment
(assignment
  left: (identifier) @name.definition.regex_var
  right: (regex)) @definition.regex_assignment

; Pattern matching - capture the entire case_match structure
(case_match) @definition.case_match

; Pattern matching - capture in_clause with hash pattern
(in_clause
  pattern: (hash_pattern)) @definition.hash_pattern_clause

; Endless methods - capture the method definition with name and surrounding context
(comment) @_endless_method_comment
(#match? @_endless_method_comment "Ruby 3.0\\+ endless method")
(method
  name: (identifier) @name.definition.endless_method
  body: (binary
    operator: "=")) @definition.endless_method

; Pin operator - capture the entire in_clause with variable_reference_pattern
(in_clause
  pattern: (variable_reference_pattern)) @definition.pin_pattern_clause

; Shorthand hash syntax - capture the method containing shorthand hash
(comment) @_shorthand_hash_comment
(#match? @_shorthand_hash_comment "Ruby 3.1\\+ shorthand hash syntax")
(method
  name: (identifier) @name.definition.shorthand_method) @definition.shorthand_method

; Shorthand hash syntax - capture the hash with shorthand syntax
(hash
  (pair
    (hash_key_symbol)
    ":")) @definition.shorthand_hash

; Capture larger contexts for features that need at least 4 lines

; Capture the entire program to include all comments and code
(program) @definition.program

; Capture all comments
(comment) @definition.comment

; Capture all method definitions
(method) @definition.method_all
`
