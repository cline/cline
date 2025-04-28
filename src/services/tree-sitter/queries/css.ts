/*
CSS Tree-Sitter Query Patterns
*/
const cssQuery = String.raw`
; CSS rulesets and selectors
(rule_set
  (selectors
    (class_selector
      (class_name) @name.definition.ruleset)) @_rule
  (#match? @name.definition.ruleset "test-ruleset-definition"))

(rule_set
  (selectors
    (pseudo_class_selector
      (class_selector
        (class_name) @name.definition.selector))) @_selector
  (#match? @name.definition.selector "test-selector-definition"))

; Media queries
(media_statement
  (block
    (rule_set
      (selectors
        (class_selector
          (class_name) @name.definition.media_query)))) @_media
  (#match? @name.definition.media_query "test-media-query-definition-container"))

; Keyframe animations
(keyframes_statement
  (keyframes_name) @name.definition.keyframe) @_keyframe
  (#match? @name.definition.keyframe "test-keyframe-definition-fade")

; Animation related classes
(rule_set
  (selectors
    (class_selector
      (class_name) @name.definition.animation)) @_animation
  (#match? @name.definition.animation "test-animation-definition"))

; Functions
(rule_set
  (selectors
    (class_selector
      (class_name) @name.definition.function)) @_function
  (#match? @name.definition.function "test-function-definition"))

; Variables (CSS custom properties)
(declaration
  (property_name) @name.definition.variable) @_variable
  (#match? @name.definition.variable "^--test-variable-definition")

; Import statements
(import_statement
  (string_value) @name.definition.import) @_import
  (#match? @name.definition.import "test-import-definition")

; Nested rulesets
(rule_set
  (selectors
    (class_selector
      (class_name) @name.definition.nested_ruleset)) @_nested
  (#match? @name.definition.nested_ruleset "test-nested-ruleset-definition"))

; Mixins (using CSS custom properties as a proxy)
(rule_set
  (selectors
    (class_selector
      (class_name) @name.definition.mixin)) @_mixin
  (#match? @name.definition.mixin "test-mixin-definition"))`

export default cssQuery
