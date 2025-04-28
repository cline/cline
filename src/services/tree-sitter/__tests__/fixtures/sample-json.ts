export default String.raw`{
  // Basic value types object
  "basic_value_types": {
    "string_value": "This is a string with escapes: \n\t\"",
    "integer_value": 1000000,
    "float_value": 42.5,
    "boolean_value": true,
    "null_value": null
  },

  // Deeply nested object structure
  "nested_object_structure": {
    "level1": {
      "level2": {
        "level3": {
          "string_key": "nested_string_value",
          "number_key": 12345,
          "object_key": {
            "inner_key": "inner_value"
          }
        }
      }
    }
  },

  // Array structures
  "array_structures": {
    "string_array": [
      "value1",
      "value2",
      "value3",
      "value4",
      "value5"
    ],
    "mixed_type_array": [
      100,
      "string_value",
      false,
      null,
      { "object_key": "object_value" }
    ]
  },

  // Array of objects
  "object_array": [
    {
      "object_id": 1,
      "object_data": {
        "timestamp": "2024-01-01",
        "updated_at": "2024-01-02"
      },
      "object_state": "active"
    },
    {
      "object_id": 2,
      "object_data": {
        "timestamp": "2024-01-03",
        "updated_at": "2024-01-04"
      },
      "object_state": "inactive"
    }
  ],

  // Mixed nesting with arrays and objects
  "mixed_nesting_structure": {
    "config": {
      "items": [
        {
          "item_name": "item1",
          "item_enabled": true,
          "item_settings": {
            "options": ["opt1", "opt2"],
            "timeout_sec": 3600
          }
        },
        {
          "item_name": "item2",
          "item_enabled": false,
          "item_settings": {
            "options": ["opt3", "opt4"],
            "timeout_sec": 7200
          }
        }
      ]
    }
  },

  // All value types in one object
  "all_value_types": {
    "string_key": "string_value",
    "number_key": 123.45,
    "boolean_key": true,
    "null_key": null,
    "array_key": [1, 2, 3],
    "object_key": {
      "nested_key": "nested_value"
    }
  },

  // Special string content
  "string_special_content": {
    "newlines": "Line 1\nLine 2\tTabbed\rCarriage Return",
    "unicode": "Unicode chars: 世界",
    "quoted": "Text with \"quoted content\"",
    "windows_path": "C:\\Program Files\\App",
    "url_path": "http://example.com/path/to/resource"
  }
}`
