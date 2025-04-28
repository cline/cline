export default String.raw`
# Standard class definition test - at least 4 lines
class StandardClassDefinition
  # Class-level constant with descriptive initialization
  STANDARD_CONFIG = {
    name: "StandardClass",
    version: "1.0.0",
    description: "Test standard class definition",
    features: ["basic", "advanced", "expert"]
  }.freeze

  # Instance method to demonstrate class functionality
  def standard_instance_method
    initialize_configuration
    validate_settings
    process_features
    generate_output
  end

  # Class method to demonstrate singleton method definition
  def self.standard_class_method
    validate_environment
    initialize_resources
    configure_system
    cleanup_resources
  end

  # Nested class definition test
  class NestedClassDefinition
    def nested_instance_method
      setup_nested_environment
      process_nested_data
      validate_nested_results
      cleanup_nested_resources
    end
  end
end

# Method definition variations test
class MethodDefinitionTypes
  # Standard instance method test
  def standard_instance_method(data, format: :json)
    validate_input(data)
    process_data(data)
    format_output(format)
    generate_response
  end

  # Class method test
  def self.class_method_example(config)
    validate_config(config)
    initialize_system(config)
    process_configuration(config)
    finalize_setup(config)
  end

  # Singleton method test
  class << self
    def singleton_method_example
      setup_singleton_context
      process_singleton_data
      validate_singleton_result
      cleanup_singleton_resources
    end
  end

  # Method with rescue and ensure test
  def exception_handling_method
    setup_resources
    process_operation
    validate_results
  rescue StandardError => e
    log_error(e)
    notify_admin(e)
    handle_failure(e)
  ensure
    cleanup_resources
    reset_state
    update_metrics
    log_completion
  end

  # Method alias test
  def original_method_name
    initialize_process
    perform_operation
    validate_results
    generate_output
  end
  alias_method :aliased_method_name, :original_method_name
end

# Module definition test - demonstrating standard and nested modules
module StandardModuleDefinition
  def self.module_class_method
    initialize_module_context
    setup_module_resources
    process_module_data
    cleanup_module_resources
  end

  def standard_module_method
    validate_module_input
    process_module_operation
    generate_module_output
    finalize_module_task
  end

  # Nested module test
  module NestedModuleDefinition
    def self.nested_module_method
      setup_nested_context
      initialize_nested_resources
      process_nested_data
      cleanup_nested_state
    end
  end
end

# Module with nested components test
module ModuleWithComponents
  # Class methods module test
  module ClassMethods
    def class_level_operation
      validate_class_context
      initialize_class_resources
      process_class_data
      cleanup_class_state
    end
  end

  # Instance methods module test
  module InstanceMethods
    def instance_level_operation
      setup_instance_context
      process_instance_data
      validate_instance_result
      cleanup_instance_state
    end
  end

  # Module inclusion hook test
  def self.included(base)
    base.extend(ClassMethods)
    base.include(InstanceMethods)
    base.class_eval do
      setup_inclusion_hooks
      initialize_module_state
      register_callbacks
      finalize_setup
    end
  end
end

# Mixin patterns test - demonstrating include, extend, and prepend
module MixinTestModule
  def mixin_operation
    setup_mixin_context
    process_mixin_data
    validate_mixin_result
    cleanup_mixin_state
  end
end

# Class demonstrating mixin usage
# Mixin test module with comprehensive functionality
module MixinTestModule
  def shared_mixin_method
    setup_mixin_context
    process_mixin_data
    validate_mixin_result
    finalize_mixin_operation
  end
end

# Class demonstrating mixin usage - at least 4 lines per mixin type
class MixinImplementation
  # Include test with method implementation
  include MixinTestModule
  def included_method
    setup_included_context
    process_included_data
    validate_included_result
    finalize_included_operation
  end

  # Extend test with class method implementation
  extend MixinTestModule
  class << self
    def extended_method
      setup_extended_context
      process_extended_data
      validate_extended_result
      finalize_extended_operation
    end
  end

  # Prepend test with method implementation
  prepend MixinTestModule
  def prepended_method
    setup_prepended_context
    process_prepended_data
    validate_prepended_result
    finalize_prepended_operation
  end
end

# Block syntax test - demonstrating do/end and brace blocks
class BlockSyntaxExamples
  # Block with do/end syntax test
  def method_with_do_end_block
    result = [1, 2, 3, 4].map do |number|
      validate_number(number)
      process_number(number)
      transform_number(number)
      format_number(number)
    end
  end

  # Block with brace syntax test
  def method_with_brace_block
    result = [1, 2, 3, 4].select { |number|
      validate_number(number)
      check_conditions(number)
      verify_constraints(number)
      meets_criteria?(number)
    }
  end

  # Lambda definition test
  STANDARD_LAMBDA = lambda { |input|
    validate_lambda_input(input)
    process_lambda_data(input)
    transform_lambda_result(input)
    format_lambda_output(input)
  }

  # Proc definition test
  STANDARD_PROC = Proc.new do |data|
    setup_proc_context(data)
    validate_proc_input(data)
    process_proc_data(data)
    finalize_proc_result(data)
  end
end

# Attribute accessor test
class AttributeAccessorExamples
  # Reader attributes test
  attr_reader :standard_reader,
             :computed_reader,
             :cached_reader,
             :formatted_reader

  # Writer attributes test
  attr_writer :standard_writer,
             :validated_writer,
             :normalized_writer,
             :formatted_writer

  # Full accessor attributes test
  attr_accessor :standard_accessor,
                :validated_accessor,
                :normalized_accessor,
                :formatted_accessor

  def initialize
    initialize_readers
    initialize_writers
    initialize_accessors
    validate_attributes
  end

  private

  def initialize_readers
    @standard_reader = "Standard Read Value"
    @computed_reader = calculate_reader_value
    @cached_reader = fetch_cached_value
    @formatted_reader = format_reader_value
  end
end

# Pattern matching test
class PatternMatchingExamples
  # Case/in pattern matching test
  def process_data_pattern(input)
    case input
    in { type: "record", id: Integer => record_id, data: { name: String => name } }
      process_record_match(record_id)
      validate_record_data(name)
      transform_record_result
      finalize_record_processing
    in { type: "collection", items: Array => items } if items.size > 0
      process_collection_match(items)
      validate_collection_items
      transform_collection_data
      finalize_collection_result
    else
      handle_unknown_pattern
      log_pattern_error
      generate_error_result
      track_pattern_failure
    end
  end

# Rails-style class macro test
class RailsStyleMacroExample < ApplicationRecord
  # Association macros test
  has_many :test_children,
           class_name: 'TestChild',
           foreign_key: 'parent_id',
           dependent: :destroy

  belongs_to :test_parent,
             class_name: 'TestParent',
             foreign_key: 'parent_id',
             optional: true

  # Validation macros test
  validates :test_field,
            presence: true,
            uniqueness: { case_sensitive: false },
            format: { with: /\A[A-Z0-9_]+\z/ }

  # Callback macros test
  before_validation :normalize_test_data,
                   :validate_test_rules,
                   :check_test_state,
                   :ensure_test_valid
end

# Exception handling test
class ExceptionHandlingExample
  # Begin/rescue/ensure block test
  def exception_handling_method
    begin
      setup_test_resources
      perform_test_operation
      validate_test_result
      generate_test_output
    rescue TestError => e
      handle_test_error(e)
      log_test_failure(e)
      notify_test_admin(e)
      track_test_error(e)
    rescue StandardError => e
      handle_standard_error(e)
      log_standard_failure(e)
      notify_system_admin(e)
      track_system_error(e)
    ensure
      cleanup_test_resources
      reset_test_state
      update_test_metrics
      log_test_completion
    end
  end
end

# Hash and symbol definition test
class HashAndSymbolExamples
  # Hash syntax variations test
  HASH_EXAMPLES = {
    symbol_key: 'symbol_value',
    'string_key' => 'string_value',
    :old_symbol_key => 'old_style_value',
    nested_hash: {
      key1: 'value1',
      key2: 'value2'
    }
  }

  # Symbol definition variations test
  SYMBOL_EXAMPLES = [
    :standard_symbol,
    :'quoted_symbol',
    :"interpolated_#{type}_symbol",
    '%s{non_alphanumeric:symbol}'.to_sym
  ]

  # String interpolation test
  def string_interpolation_example(status)
    timestamp = Time.now.strftime('%Y-%m-%d %H:%M:%S')
    <<~MESSAGE
      Test Status [#{timestamp}]
      Current State: #{status.upcase}
      Details: #{fetch_details}
      Metrics: #{calculate_metrics}
    MESSAGE
  end
end

# REGULAR EXPRESSIONS - testing pattern matching
class RegexImplementation
  # Email validation pattern
  EMAIL_PATTERN = %r{
    \A
    [a-zA-Z0-9._%+-]+ # username
    @
    [a-zA-Z0-9.-]+    # domain name
    \.[a-zA-Z]{2,}    # domain extension
    \z
  }x

  # URL validation pattern
  URL_PATTERN = %r{
    \A
    https?://          # protocol
    (?:[\w-]+\.)+     # subdomains
    [\w-]+            # domain
    (?:/[\w- ./?%&=]*)? # path and query
    \z
  }x

  def validate_patterns(input)
    case input
    when EMAIL_PATTERN
      process_email_match(input)
      validate_email_parts(input)
      check_email_availability
      register_email_validation
    when URL_PATTERN
      process_url_match(input)
      validate_url_components(input)
      check_url_accessibility
      register_url_validation
    end
  end
end

# ATTRIBUTE ACCESSORS - testing comprehensive accessor patterns
class ModelAttributeImplementation
  # Reader attributes with validation
  attr_reader :validated_reader_attribute,
             :computed_reader_attribute,
             :cached_reader_attribute,
             :formatted_reader_attribute

  # Writer attributes with preprocessing
  attr_writer :validated_writer_attribute,
             :normalized_writer_attribute,
             :encrypted_writer_attribute,
             :formatted_writer_attribute

  # Full accessors with complex logic
  attr_accessor :managed_accessor_attribute,
               :versioned_accessor_attribute,
               :tracked_accessor_attribute,
               :cached_accessor_attribute

  def initialize(config)
    initialize_reader_attributes(config)
    initialize_writer_attributes(config)
    initialize_accessor_attributes(config)
    validate_all_attributes
  end

  private

  def initialize_reader_attributes(config)
    @validated_reader_attribute = validate_reader_input(config[:reader])
    @computed_reader_attribute = compute_reader_value(config[:compute])
    @cached_reader_attribute = cache_reader_value(config[:cache])
    @formatted_reader_attribute = format_reader_value(config[:format])
  end
end

# CLASS MACROS - testing Rails-style macro implementations
class RailsModelImplementation < ApplicationRecord
  # Association macros with complex options
  has_many :managed_children,
           class_name: 'ManagedChild',
           foreign_key: 'parent_identifier',
           dependent: :destroy,
           counter_cache: true

  belongs_to :managed_parent,
             class_name: 'ManagedParent',
             foreign_key: 'parent_identifier',
             touch: true,
             optional: true

  # Validation macros with custom rules
  validates :identifier_field,
            presence: true,
            uniqueness: { case_sensitive: false },
            format: { with: /\A[A-Z0-9_]+\z/ },
            length: { minimum: 8, maximum: 32 }

  # Callback macros with complex logic
  before_validation :normalize_identifier,
                   :validate_business_rules,
                   :check_dependencies,
                   :ensure_valid_state

  # Scope macros with complex queries
  scope :active_records, -> {
    where(active: true)
      .where.not(deleted_at: nil)
      .order(created_at: :desc)
      .includes(:managed_children)
  }
end

# EXCEPTION HANDLING - testing comprehensive error management
class ErrorHandlingImplementation
  class BusinessLogicError < StandardError; end
  class ValidationError < StandardError; end
  class ProcessingError < StandardError; end
  
  def process_with_error_handling(data)
    begin
      validate_input_data(data)
      process_validated_data(data)
      handle_successful_processing
      generate_success_response
    rescue BusinessLogicError => e
      handle_business_error(e)
      notify_business_stakeholders(e)
      log_business_failure(e)
      raise
    rescue ValidationError => e
      handle_validation_error(e)
      notify_system_admins(e)
      log_validation_failure(e)
      retry if should_retry?
    rescue ProcessingError => e
      handle_processing_error(e)
      attempt_error_recovery(e)
      notify_error_handlers(e)
      raise if critical_error?(e)
    ensure
      cleanup_resources
      reset_processing_state
      update_processing_metrics
      log_processing_completion
    end
  end
end

# METAPROGRAMMING - testing dynamic method generation
class MetaprogrammingImplementation
  # Dynamic method definition with validation
  [:create, :update, :delete, :archive].each do |operation|
    define_method("validate_#{operation}") do |record|
      validate_permissions(operation, record)
      validate_business_rules(operation, record)
      validate_constraints(operation, record)
      log_validation_attempt(operation, record)
    end

    define_method("process_#{operation}") do |record|
      validate_operation = send("validate_#{operation}", record)
      process_operation(operation, record)
      notify_observers(operation, record)
      log_operation_completion(operation, record)
    end
  end

  # Method missing implementation with logging
  def method_missing(method_name, *args, &block)
    if method_name.to_s.start_with?('find_by_')
      attribute = method_name.to_s.sub('find_by_', '')
      log_dynamic_finder(attribute, args)
      find_record_by_attribute(attribute, args.first)
    else
      log_unknown_method(method_name, args)
      super
    end
  end

  def respond_to_missing?(method_name, include_private = false)
    method_name.to_s.start_with?('find_by_') || super
  end
end
`
