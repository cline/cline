export default String.raw`
// Function declaration test - showing prototype over 4 lines
void multiline_function_prototype(
    int parameter1,
    const std::string& parameter2,
    double parameter3 = 0.0,
    bool* optional_param = nullptr
);

// Function implementation test - 4+ lines
void function_with_implementation(
    int value,
    bool debug = false
)
{
    std::cout << "Processing value: " << value << std::endl;
    if (debug) {
        std::cout << "Debug mode enabled" << std::endl;
    }
    value *= 2;
}

// Struct declaration test - 4+ lines
struct four_field_struct
{
    int field1;
    std::string field2;
    double field3;
    bool field4;
};

// Class declaration test - 4+ lines with multiple features
class base_class_definition
{
public:
    virtual void virtual_method() = 0;
    virtual ~base_class_definition() = default;
protected:
    int protected_member;
};

// Union declaration test - 4+ lines
union four_member_union
{
    int integer_value;
    float float_value;
    char char_value;
    double double_value;
};

// Enum declaration test - 4+ lines
enum class scoped_enumeration : uint8_t
{
    Value1,
    Value2,
    Value3,
    Value4
};

// Typedef test - 4+ lines with template
typedef std::vector<
    std::pair<
        std::string,
        int
    >
> complex_type_definition;

// Namespace test - 4+ lines
namespace deeply_nested_namespace
{
    namespace inner
    {
        void nested_function();
    }
}

// Template class test - 4+ lines
template<
    typename T,
    typename U = int,
    template<typename> class Container = std::vector
>
class template_class_definition
{
public:
    T template_method(
        U value,
        Container<T> container
    );
private:
    Container<T> data;
};

// Macro definition test - 4+ lines
#define MULTI_LINE_MACRO(x, y) \\
    do { \\
        statement1(x); \\
        if (x > 0) { \\
            statement2(y); \\
        } else { \\
            statement3(y); \\
        } \\
    } while(0)

// Variable declaration test - 4+ lines
static const std::map<
    std::string,
    std::vector<int>
> global_variable_definition = {
    {"test", {1, 2, 3, 4}}
};

// Constructor test - 4+ lines
class constructor_test
{
public:
    constructor_test(
        int param1,
        std::string param2
    ) : member1(param1),
        member2(std::move(param2)) {}
private:
    int member1;
    std::string member2;
};

// Destructor test - 4+ lines
class destructor_test
{
public:
    ~destructor_test()
    {
        cleanup_resources();
    }
};

// Operator overload test - 4+ lines
class operator_test
{
public:
    bool operator==(
        const operator_test& other
    ) const
    {
        if (value == other.value) {
            return true;
        }
        return false;
    }

    bool operator<(
        const operator_test& other
    ) const
    {
        return value < other.value;
    }
private:
    int value;
};

// Friend declaration test - 4+ lines
class friendship_class
{
private:
    friend class friend_class;
    friend void friend_function(
        friendship_class&
    );
};

// Using declaration test - 4+ lines
class using_declaration_test :
    private base_class_definition
{
public:
    using base_class_definition::virtual_method;
    using size_type = std::size_t;
};
`
