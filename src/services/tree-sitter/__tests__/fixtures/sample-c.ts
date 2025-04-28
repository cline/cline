export default String.raw`
// ===== PREPROCESSOR DEFINITIONS =====

// Testing preprocessor conditional blocks - at least 4 lines
#ifdef _WIN32
    #define TEST_PATH_SEPARATOR "\\"
    #define TEST_LINE_ENDING "\r\n"
    #define TEST_OS "windows"
#else
    #define TEST_PATH_SEPARATOR "/"
    #define TEST_LINE_ENDING "\n"
    #define TEST_OS "unix"
#endif

// Testing nested conditional compilation - at least 4 lines
#if defined(TEST_DEBUG)
    #if TEST_DEBUG_LEVEL >= 2
        #define TEST_VERBOSE_LOG 1
        #define TEST_TRACE_ENABLED 1
    #else
        #define TEST_VERBOSE_LOG 0
        #define TEST_TRACE_ENABLED 0
    #endif
#endif

// Testing object-like macro definitions
#define MAX_SIZE 1024        /* Basic size constant */
#define BUFFER_SIZE ( \
    MAX_SIZE * 2             /* Double the max size */ \
)                           /* for safety margin */

#define TIMEOUT_MS ( \
    1000 *                  /* One second */ \
    60 *                   /* One minute */ \
    5                     /* Five minutes total */ \
)

// Testing feature-based conditional compilation
#ifndef TEST_FEATURE_DISABLE
    #if defined(TEST_FEATURE_ADVANCED) && \
        defined(TEST_FEATURE_EXPERIMENTAL) && \
        (TEST_VERSION_MAJOR > 2)
        #define TEST_ENABLE_ADVANCED_FEATURES
    #endif
#endif

// Testing function-like macro - at least 4 lines
#define TEST_MIN(a,b) ( \
    (a) < (b) ? \
    (a) : \
    (b) \
)

#define TEST_MAX(a,b) ( \
    (a) > (b) ? \
    (a) : \
    (b) \
)

// Testing multi-line macro with conditional compilation
#ifdef TEST_ENABLE_LOGGING
    #define TEST_DEBUG_LOG(level, msg, ...) do { \
        if (debug_level >= level) { \
            if (TEST_LOG_TIMESTAMP) { \
                printf("[%s][%lu] " msg "\n", #level, time(NULL), ##__VA_ARGS__); \
            } else { \
                printf("[%s] " msg "\n", #level, ##__VA_ARGS__); \
            } \
        } \
    } while(0)
#else
    #define TEST_DEBUG_LOG(level, msg, ...) do {} while(0)
#endif

// ===== GLOBAL VARIABLES =====

// Testing global constant declarations
static const int MAGIC_NUMBER = (
    0x1234 << 16 |        /* High word */
    0xABCD               /* Low word */
);

static const char* const BUILD_INFO[] = {
    __DATE__,           /* Compilation date */
    __TIME__,           /* Compilation time */
    "1.0.0",           /* Version string */
    "DEBUG"            /* Build type */
};

// Testing global struct initialization
static struct config_struct {
    int max_connections;    /* Connection limit */
    char host[256];        /* Host address */
    double timeout_sec;    /* Timeout in seconds */
    int flags;            /* Configuration flags */
} DEFAULT_CONFIG = {
    .max_connections = 100,
    .host = "localhost",
    .timeout_sec = 30.0,
    .flags = 0x0F
};

// ===== FUNCTION DECLARATIONS =====

// Testing function prototype with multiple parameters across lines
void multiline_prototype(
    int param1,
    char* param2,
    float param3,
    double param4
);

// Testing function prototype with void parameter
/**
 * Function prototype that takes no parameters
 * Demonstrates void parameter usage
 * @return void No return value
 */
void void_param_prototype(
    void    /* Explicit void parameter */
);


// Testing function prototype with function pointer parameter
void function_pointer_prototype(
    void (*callback)(void*),
    int priority
);

// Testing variadic function prototype
int variadic_prototype(
    const char* format,
    int count,
    ...
);

 * Validates the provided configuration structure
 * @param config Pointer to configuration structure
 * @return int Status code (0 for success)
 */
int test_validate_config(const struct TestConfig* config);

// Testing function pointer declarations
typedef int (*TEST_COMPARE_FUNC)(const void*, const void*);
extern TEST_COMPARE_FUNC test_get_comparator(int type);

// Testing variadic function declaration
int test_format_message(const char* format, ...);

// ===== UNION DEFINITIONS =====

// Testing union with multiple data type interpretations
/**
 * Union demonstrating type punning and data reinterpretation
 * Each field represents a different view of the same memory
 */
union multitype_data_union {
    int as_integer;              /* Integer view */
    float as_float;              /* Float view */
    char as_bytes[4];           /* Raw byte array view */
    void* as_pointer;           /* Pointer view */
    double as_double;           /* Double view */
};

// Testing union with embedded bitfield struct
union bitfield_union {
    struct {
        unsigned int flag_one : 1;
        unsigned int flag_two : 1;
        unsigned int reserved_bits : 30;
    } bit_fields;
    unsigned int raw_value;
};

// ===== STRUCT DEFINITIONS =====

// Testing struct with basic field types
/**
 * Structure containing fields of different primitive types
 * Demonstrates basic field type support
 */
union basic_types_struct {
    int integer_field;           /* Integer type */
    char string_field[20];       /* Fixed-size array */
    float float_field;          /* Float type */
    double double_field;        /* Double type */
    void* pointer_field;        /* Pointer type */
    unsigned long ulong_field;  /* Unsigned long */
};

// Testing struct with nested anonymous struct
struct nested_struct {
    char outer_name[50];
    int outer_id;
    struct {
        char street_name[100];
        char city_name[50];
        int postal_code;
        float coordinates[2];
    } address_info;
};

// Testing struct with bitfield members
struct bitfield_struct {
    unsigned int flag_one : 1;
    unsigned int flag_two : 1;
    unsigned int value_bits : 6;
    unsigned int reserved_bits : 24;
};

// Testing struct with function pointer callbacks
struct callback_struct {
    void (*test_callback)(const char* message);
    int test_priority;
    char test_name[32];
    void (*test_error_handler)(int code);
};

// ===== FUNCTION DEFINITIONS =====
// Testing basic function definition with multiple parameter types
int basic_multitype_function(
    int param1,
    char* param2,
    float param3,
    double param4
) {
    int result = param1;
    return result;
}

// Testing function with array parameters of different dimensions
void array_param_function(
    int single_dim[],
    char fixed_size[50],
    float multi_dim[4][4],
    int size
) {
    for (int i = 0; i < size; i++) {
        single_dim[i] *= 2;
    }
}

// Testing function with pointer parameters
void pointer_param_function(
    int* direct_ptr,
    char** ptr_to_ptr,
    void* void_ptr,
    const int* const_ptr
) {
    if (direct_ptr) {
        *direct_ptr = 42;
    }
}

// Testing variadic function implementation
int variadic_impl_function(
    const char* format,
    int count,
    ...
) {
    va_list args;
    va_start(args, count);
    int sum = 0;
    va_end(args);
    return sum;
}

// Testing function with pointer parameters
void test_pointer_function(
    int* test_ptr1,
    char** test_ptr2,
    struct TestBasicStruct* test_ptr3,
    void (*test_callback)(void*)
) {
    if (test_ptr1 && test_ptr3) {
        test_ptr3->test_field_int = *test_ptr1;
    }
}

// Testing variadic function
#include <stdarg.h>
int test_variadic_function(
    int test_count,
    const char* test_format,
    ...
) {
    va_list args;
    va_start(args, test_format);
    int sum = 0;
    for (int i = 0; i < test_count; i++) {
        sum += va_arg(args, int);
    }
    va_end(args);
    return sum;
}

// ===== ENUM DEFINITIONS =====

// Testing enum with sequential values
/**
 * Enumeration demonstrating sequential value assignment
 * Each value is implicitly incremented from the previous
 */
enum sequential_value_enum {
    FIRST = 0,          /* Base value */
    SECOND,             /* Implicit 1 */
    THIRD,              /* Implicit 2 */
    FOURTH,             /* Implicit 3 */
    LAST = -1          /* Explicit value */
};

// Testing enum with explicit values
enum explicit_value_enum {
    ONE = 1,
    TEN = 10,
    HUNDRED = 100,
    THOUSAND = 1000
};

// Testing enum with mixed values
enum mixed_value_enum {
    AUTO_FIRST,         /* Implicit 0 */
    EXPLICIT_TEN = 10,  /* Explicit 10 */
    AUTO_ELEVEN,        /* Implicit 11 */
    EXPLICIT_TWENTY = 20/* Explicit 20 */
};
enum TestBasicEnum {
    TEST_ENUM_FIRST = 0,          /* Initial state */
    TEST_ENUM_SECOND = 1,         /* Processing state */
    TEST_ENUM_THIRD = 2,          /* Validation state */
    TEST_ENUM_FOURTH = 3,         /* Completion state */
};

// ===== TYPEDEF DECLARATIONS =====

// Testing typedef for struct with multiple fields
typedef struct {
    double x;                /* X coordinate */
    double y;                /* Y coordinate */
    double z;                /* Z coordinate */
    char label[32];          /* Point label */
    unsigned int flags;      /* Point flags */
} point3d_struct_typedef;

// Testing typedef for function pointer with multiple parameters
typedef void (*event_callback_typedef)(
    int event_code,          /* Event identifier */
    const char* message,     /* Event description */
    void* user_data,        /* User context */
    unsigned int flags       /* Event flags */
);

// Testing typedef for simple type alias
typedef unsigned long long timestamp_typedef;

// Testing typedef for function pointer array
typedef int (*operation_array_typedef[4])(
    int a,
    int b,
    void* context
);
    TEST_ENUM_ERROR = -1          /* Error state */
};

// Testing enum with explicit values
enum TestValuedEnum {
    TEST_VALUED_ONE = 1,
    TEST_VALUED_TEN = 10,
    TEST_VALUED_HUNDRED = 100,
    TEST_VALUED_THOUSAND = 1000
};

// ===== TYPEDEF DECLARATIONS =====

// Testing typedef for 3D point structure
typedef struct {
    double x;                /* X coordinate */
    double y;                /* Y coordinate */
    double z;                /* Z coordinate */
    char label[32];          /* Point label */
    unsigned int flags;      /* Point flags */
} point3d_struct_typedef;

// Testing typedef for event callback function
typedef void (*event_callback_typedef)(
    int event_code,          /* Event identifier */
    const char* message,     /* Event description */
    void* user_data,        /* User context */
    unsigned int flags       /* Event flags */
);

// Testing typedef for simple type alias
typedef unsigned long long timestamp_typedef;

// Testing typedef for function pointer array
typedef int (*operation_array_typedef[4])(
    int a,
    int b,
    void* context
);

// Testing typedef for struct - at least 4 lines
/**
 * Typedef struct for metadata
 * Used for testing purposes
 */
typedef struct {
    double test_x;                /* X coordinate */
    double test_y;                /* Y coordinate */
    double test_z;                /* Z coordinate */
    char test_label[32];          /* Point label */
    unsigned int test_flags;      /* Point flags */
    float test_weight;            /* Point weight */
} TestTypedefStruct;

// Testing typedef for function pointer - at least 4 lines
/**
 * Callback function type for event handling
 * Used for registering event handlers with configurable parameters
 */
typedef void (*TestTypedefCallback)(
    int test_code,                /* Event code */
    const char* test_message,     /* Event message */
    void* test_data,             /* User data */
    unsigned int test_flags,      /* Event flags */
    double test_timestamp         /* Event timestamp */
);

// ===== C11 FEATURES =====

// Testing anonymous union in struct
struct anonymous_union_struct {
    int type_field;
    struct {
        union {
            struct {
                unsigned char blue;
                unsigned char green;
                unsigned char red;
                unsigned char alpha;
            };
            unsigned int color;
        };
    };
};

// Testing struct with alignment
struct aligned_struct {
    char unaligned_field;
    _Alignas(8) int aligned_int;
    double normal_double;
    _Alignas(16) float aligned_float;
};`
