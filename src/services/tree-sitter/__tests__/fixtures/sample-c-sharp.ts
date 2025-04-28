export default String.raw`
// Using directives test - at least 4 lines long
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

// Attribute declaration test - at least 4 lines long
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public class TestAttributeDefinition : Attribute
{
    // Attribute properties
    public string Category { get; }
    public int Priority { get; }

    // Constructor
    public TestAttributeDefinition(string category, int priority = 0)
    {
        Category = category;
        Priority = priority;
    }
}

// Namespace declaration test
namespace TestNamespaceDefinition
{
    // Interface declaration test - at least 4 lines long
    public interface ITestInterfaceDefinition
    {
        // Interface method declarations
        void TestInterfaceMethod(string message);
        string TestInterfaceFormatMethod(string message, TestEnumDefinition level);
        int TestInterfaceCalculateMethod(int x, int y);
    }

    // Enum declaration test - at least 4 lines long
    public enum TestEnumDefinition
    {
        Debug,
        Info,
        Warning,
        Error,
        Critical
    }

    // Class declaration test
    public class TestClassDefinition : ITestInterfaceDefinition
    {
        // Fields
        private readonly string _prefix;
        private static int _instanceCount = 0;

        // Property declaration tests - each property has clear naming and spans 4+ lines
        public string TestPropertyDefinition
        {
            get;
            set;
        }

        public TestEnumDefinition TestPropertyWithAccessor
        {
            get;
            private set;
        }

        // Auto-implemented property with init accessor (C# 9.0+)
        public string TestPropertyWithInit
        {
            get;
            init;
        }
        
        // Required member (C# 11.0+)
        public required string TestRequiredProperty
        {
            get;
            set;
        }

        // Event declaration test with custom accessors - at least 4 lines long
        private EventHandler<TestEventArgsDefinition> _testEvent;
        public event EventHandler<TestEventArgsDefinition> TestEventDefinition
        {
            add
            {
                _testEvent += value;
                Console.WriteLine("Event handler added");
            }
            remove
            {
                _testEvent -= value;
                Console.WriteLine("Event handler removed");
            }
        }

        // Delegate declaration test - at least 4 lines long
        public delegate void TestDelegateDefinition(
            string message,
            TestEnumDefinition level,
            DateTime timestamp
        );

        // Constructor - at least 4 lines long
        public TestClassDefinition(string prefix)
        {
            _prefix = prefix;
            TestPropertyWithAccessor = TestEnumDefinition.Info;
            _instanceCount++;
            TestPropertyDefinition = "Default Value";
        }

        // Method declaration test - standard method with block body
        [TestAttributeDefinition("Interface", 2)]
        public void TestInterfaceMethod(string message)
        {
            var formattedMessage = TestInterfaceFormatMethod(message, TestPropertyWithAccessor);
            Console.WriteLine(formattedMessage);
            
            // Raise event
            _testEvent?.Invoke(this, new TestEventArgsDefinition(formattedMessage));
        }

        // Method with expression body - expanded to 4 lines with comments
        // This tests expression-bodied methods which have a different syntax
        // The => syntax is important to test separately
        public string TestInterfaceFormatMethod(string message, TestEnumDefinition level) =>
            $"[{level}] {_prefix}: {message}";

        // Static method test - expanded to 4 lines
        // This tests static methods which have different modifiers
        // Also tests expression-bodied implementation
        public static int TestStaticMethodDefinition() =>
            _instanceCount;

        // Implementation of interface method
        public int TestInterfaceCalculateMethod(int x, int y)
        {
            // Simple calculation
            return x + y;
        }

        // Generic method test - already 4+ lines
        public T TestGenericMethodDefinition<T>(string message) where T : class
        {
            // Implementation would go here
            Console.WriteLine($"Generic method called with: {message}");
            return null;
        }
    }

    // Event args class
    public class TestEventArgsDefinition : EventArgs
    {
        // Property with only getter
        public string Message { get; }
        
        // Constructor - at least 4 lines
        public TestEventArgsDefinition(string message)
        {
            Message = message;
            Console.WriteLine($"Event args created: {message}");
        }
    }

    // Struct declaration test - already 4+ lines
    public struct TestStructDefinition
    {
        // Fields
        public DateTime Timestamp;
        public string Message;
        public TestEnumDefinition Level;

        // Constructor
        public TestStructDefinition(string message, TestEnumDefinition level)
        {
            Timestamp = DateTime.Now;
            Message = message;
            Level = level;
        }

        // Method
        public override string ToString()
        {
            return $"{Timestamp:yyyy-MM-dd HH:mm:ss} [{Level}] {Message}";
        }
    }

    // Record declaration test (C# 9.0+) - expanded to ensure 4+ lines
    public record TestRecordDefinition(string Message, TestEnumDefinition Level, DateTime Timestamp)
    {
        // Additional members can be added to records
        public string FormattedTimestamp => Timestamp.ToString("yyyy-MM-dd HH:mm:ss");
        
        // Method in record
        public string TestRecordMethodDefinition()
        {
            return $"{FormattedTimestamp} [{Level}] {Message}";
        }
    }

    // Partial class test (first part) - expanded to 4+ lines
    public partial class TestPartialClassDefinition
    {
        // Field in partial class
        private Dictionary<string, string> _storage = new Dictionary<string, string>();
        
        public string TestPartialMethod1(string key)
        {
            // Implementation would go here
            return _storage.ContainsKey(key) ? _storage[key] : string.Empty;
        }
    }

    // Partial class test (second part) - expanded to 4+ lines
    public partial class TestPartialClassDefinition
    {
        // Another field in partial class
        private bool _modified = false;
        
        public void TestPartialMethod2(string key, string value)
        {
            // Implementation would go here
            _storage[key] = value;
            _modified = true;
        }
    }

    // Static class test - already 4+ lines
    public static class TestStaticClassDefinition
    {
        // Extension method test
        public static void TestExtensionMethod1(this ITestInterfaceDefinition logger, string message)
        {
            logger.TestInterfaceMethod($"DEBUG: {message}");
        }
        
        // Another extension method
        public static void TestExtensionMethod2(this ITestInterfaceDefinition logger, Exception ex)
        {
            logger.TestInterfaceMethod($"ERROR: {ex.Message}");
        }
    }

    // Generic class test - already 4+ lines
    public class TestGenericClassDefinition<T> where T : class, new()
    {
        private List<T> _items = new List<T>();
        
        public void TestGenericClassMethod1(T item)
        {
            _items.Add(item);
        }
        
        public List<T> TestGenericClassMethod2()
        {
            return _items;
        }
        
        public T TestGenericMethodWithConstraint<TId>(TId id) where TId : IEquatable<TId>
        {
            // Implementation would go here
            return new T();
        }
    }

    // Nested class test - already 4+ lines
    public class TestOuterClassDefinition
    {
        private int _value;
        
        public TestOuterClassDefinition(int value)
        {
            _value = value;
        }
        
        // Nested class - expanded to 4+ lines
        public class TestNestedClassDefinition
        {
            private string _nestedField = "Nested";
            
            public void TestNestedMethod()
            {
                Console.WriteLine("Nested class method");
            }
        }
    }

    // Async method test - already 4+ lines
    public class TestAsyncClassDefinition
    {
        public async Task TestAsyncMethodDefinition(string data)
        {
            await Task.Delay(100); // Simulate async work
            
            // Process the data
            var result = await TestAsyncPrivateMethod1(data);
            
            // More async operations
            await TestAsyncPrivateMethod2(result);
        }
        
        private async Task<string> TestAsyncPrivateMethod1(string data)
        {
            await Task.Delay(50); // Simulate async work
            return data.ToUpper();
        }
        
        private async Task TestAsyncPrivateMethod2(string result)
        {
            await Task.Delay(50); // Simulate async work
            // Save the result
        }
    }

    // Abstract class test - expanded to 4+ lines
    public abstract class TestAbstractClassDefinition
    {
        // Abstract property
        public abstract string TestAbstractProperty { get; }
        
        // Abstract method
        public abstract double TestAbstractMethod();
    }

    // Derived classes test - already 4+ lines
    public class TestDerivedClass1 : TestAbstractClassDefinition
    {
        public double TestProperty1 { get; set; }
        
        // Implementation of abstract property
        public override string TestAbstractProperty => "Derived1";
        
        public TestDerivedClass1(double value)
        {
            TestProperty1 = value;
        }
        
        public override double TestAbstractMethod() => Math.PI * TestProperty1 * TestProperty1;
    }

    public class TestDerivedClass2 : TestAbstractClassDefinition
    {
        public double TestProperty2 { get; set; }
        public double TestProperty3 { get; set; }
        
        // Implementation of abstract property
        public override string TestAbstractProperty => "Derived2";
        
        public TestDerivedClass2(double width, double height)
        {
            TestProperty2 = width;
            TestProperty3 = height;
        }
        
        public override double TestAbstractMethod() => TestProperty2 * TestProperty3;
    }
}

// File-scoped namespace test (C# 10.0+) - expanded to 4+ lines
namespace TestFileScopedNamespaceDefinition
{
    // Class in file-scoped namespace
    public class TestFileScopedClassDefinition
    {
        private string _scopedField = "Scoped";
        
        public void TestFileScopedMethod()
        {
            Console.WriteLine("File-scoped namespace class");
        }
    }
}
    // LINQ expression test - expanded to 4+ lines
    public class TestLinqExpressionDefinition
    {
        private readonly List<int> _numbers = new List<int> { 1, 2, 3, 4, 5 };
        
        public IEnumerable<int> TestLinqMethod()
        {
            // Multi-line LINQ query expression
            var result = from num in _numbers
                        where num % 2 == 0
                        orderby num descending
                        select num * num;
            
            return result;
        }
    }
}
`
