export default String.raw`
// Module declaration test - at least 4 lines long
module test.module.definition {
    requires java.base;
    requires transitive java.desktop;
    exports test.module.api;
}
package test.package.definition;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.time.LocalDateTime;

// Annotation declaration test - at least 4 lines long
@Target({
    ElementType.TYPE,
    ElementType.METHOD,
    ElementType.FIELD
})
@Retention(RetentionPolicy.RUNTIME)
public @interface TestAnnotationDefinition {
    String value() default "";
    int priority() default 0;
    boolean enabled() default true;
    Class<?>[] types() default {};
}

// Interface declaration test - at least 4 lines long
public interface TestInterfaceDefinition<T extends Comparable<T>> {
    // Interface method declarations
    void testInterfaceMethod(
        String message,
        T data
    );
    
    // Default method in interface - 4+ lines
    default String testInterfaceDefaultMethod(
        String input,
        T data
    ) {
        return String.format("%s: %s", input, data.toString());
    }
}

// Enum declaration test - at least 4 lines long
public enum TestEnumDefinition {
    DEBUG(0, "Debug Level"),
    INFO(1, "Info Level"),
    WARNING(2, "Warning Level"),
    ERROR(3, "Error Level");

    private final int level;
    private final String description;

    TestEnumDefinition(
        int level,
        String description
    ) {
        this.level = level;
        this.description = description;
    }
}

// Class declaration test with generic type and implementation
@TestAnnotationDefinition(
    value = "test",
    priority = 1,
    enabled = true
)
public class TestClassDefinition<T extends Comparable<T>>
        implements TestInterfaceDefinition<T> {
    
    // Field declarations - expanded to 4+ lines with annotations
    @TestAnnotationDefinition(
        value = "field",
        priority = 2
    )
    private final String prefix;
    private static int instanceCount = 0;

    // Constructor - at least 4 lines long
    public TestClassDefinition(
        String prefix,
        T initialData
    ) {
        this.prefix = prefix;
        this.data = initialData;
        instanceCount++;
    }

    // Method implementation - at least 4 lines long
    @Override
    public void testInterfaceMethod(
        String message,
        T data
    ) {
        System.out.println(testInterfaceDefaultMethod(message, data));
    }

    // Generic method test - at least 4 lines long
    public <R extends Comparable<R>> R testGenericMethodDefinition(
        Function<T, R> converter,
        T input,
        R defaultValue
    ) {
        return input != null ? converter.apply(input) : defaultValue;
    }

    // Lambda expression test - at least 4 lines long
    private final Function<String, Integer> testLambdaDefinition = (
        String input
    ) -> {
        if (input == null || input.isEmpty()) {
            return 0;
        }
        return input.length();
    };
}

// Record declaration test - at least 4 lines long
public record TestRecordDefinition(
    String message,
    TestEnumDefinition level,
    LocalDateTime timestamp,
    Map<String, Object> attributes
) {
    // Compact constructor
    public TestRecordDefinition {
        Objects.requireNonNull(message);
        Objects.requireNonNull(level);
    }

    // Method in record - 4+ lines
    public String formatMessage() {
        return String.format(
            "[%s] %s (%s)",
            level,
            message,
            timestamp
        );
    }
}

// Abstract class test - at least 4 lines long
public abstract class TestAbstractClassDefinition<T> {
    protected final T data;

    protected TestAbstractClassDefinition(
        T data
    ) {
        this.data = data;
    }

    // Abstract method
    public abstract String testAbstractMethod(
        String input,
        T data
    );
}

// Inner class test - at least 4 lines long
public class TestOuterClassDefinition {
    private int value;

    public class TestInnerClassDefinition {
        private String innerField;

        public TestInnerClassDefinition(
            String field
        ) {
            this.innerField = field;
        }

        public void testInnerMethod() {
            System.out.println(
                String.format("Value: %d, Inner: %s", value, innerField)
            );
        }
    }

    // Static nested class - 4+ lines
    public static class TestStaticNestedClassDefinition {
        private final String nestedField;

        public TestStaticNestedClassDefinition(
            String field
        ) {
            this.nestedField = field;
        }
    }
}
`
