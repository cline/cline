export default String.raw`
// Package declaration test - at least 4 lines long
@file:JvmName("TestFileDefinition")
package com.example.test.definitions

// Import declarations test - at least 4 lines long
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlin.math.sqrt
import kotlin.properties.Delegates

// Abstract class declaration test - at least 4 lines long
abstract class TestAbstractClassDefinition {
    // Abstract property test
    abstract val abstractPropertyDefinition: String
    
    // Abstract method test
    abstract fun abstractMethodDefinition(): String
    
    // Open method test with implementation
    open fun concreteMethodDefinition(
        param1: String,
        param2: Int
    ): Int {
        return param2 + param1.length
    }
}

// Interface declaration test - at least 4 lines long
interface TestInterfaceDefinition {
    // Interface property test
    val interfacePropertyDefinition: String
    
    // Required method test
    fun requiredMethodDefinition(
        param1: String,
        param2: Int
    ): Boolean
    
    // Default method test
    fun defaultMethodDefinition(
        message: String = "default"
    ): String {
        return "Default implementation: $message"
    }
}

// Enum class declaration test - at least 4 lines long
enum class TestEnumClassDefinition(
    val enumValue: Int,
    val enumDescription: String
) {
    FIRST_ENUM(1, "First") {
        override fun describeEnumDefinition(): String {
            return "Enum value: $enumValue, Description: $enumDescription"
        }
    },
    SECOND_ENUM(2, "Second") {
        override fun describeEnumDefinition(): String {
            return "Enum value: $enumValue, Description: $enumDescription"
        }
    };
    
    abstract fun describeEnumDefinition(): String
    
    fun getEnumValueDefinition(): Int = enumValue
}

// Type alias declaration test - at least 4 lines long
typealias TestTypeAliasDefinition<T> = (
    data: T,
    metadata: Map<String, Any>
) -> Unit where T : Any

// Annotation class declaration test - at least 4 lines long
@Target(
    AnnotationTarget.CLASS,
    AnnotationTarget.FUNCTION,
    AnnotationTarget.PROPERTY
)
annotation class TestAnnotationClassDefinition(
    val annotationName: String,
    val annotationValue: Int = 0,
    val annotationEnabled: Boolean = true
)

// Constructor declaration test - at least 4 lines long
@TestAnnotationClassDefinition("constructor-test")
class TestConstructorDefinition(
    val constructorParam1: String,
    private val constructorParam2: Int
) {
    private var constructorField1: String? = null
    private var constructorField2: Int = 0
    
    // Secondary constructor test
    constructor(
        param1: String,
        param2: Int,
        param3: String
    ) : this(param1, param2) {
        this.constructorField1 = param3
        this.constructorField2 = param2 * 2
    }
    
    // Another secondary constructor test
    constructor(
        param1: String,
        param2: Int,
        param3: String,
        param4: Boolean
    ) : this(param1, param2, param3) {
        if (param4) {
            constructorField2 *= 2
        }
    }
}

// Property declaration test with accessors - at least 4 lines long
class TestPropertyDefinition {
    // Property with private setter
    var propertyWithPrivateSetter: Int = 0
        private set(value) {
            if (value >= 0) {
                field = value
            }
        }
    
    // Property with custom accessors
    var propertyWithCustomAccessors: String = ""
        get() = field.uppercase()
        set(value) {
            field = "Custom: $value"
        }
    
    // Property with backing field
    private var _propertyWithBackingField: String = "inactive"
    var propertyWithBackingField: String
        get() = "Status: $_propertyWithBackingField"
        set(value) {
            _propertyWithBackingField = value.lowercase()
        }
    
    // Delegated property test
    var delegatedPropertyDefinition: Int by Delegates.observable(0) {
        property, oldValue, newValue ->
        println("$property changed from $oldValue to $newValue")
    }
}

// Nested class declaration test - at least 4 lines long
class TestOuterClassDefinition(
    private val outerParam1: String,
    private val outerParam2: Int
) {
    private val outerPropertyDefinition: String = "outer"
    
    // Inner class test
    inner class TestInnerClassDefinition(
        private val innerParam: String
    ) {
        fun innerMethodDefinition(): String {
            return "$innerParam: $outerPropertyDefinition"
        }
    }
    
    // Nested class test
    class TestNestedClassDefinition(
        private val nestedParam: String
    ) {
        fun nestedMethodDefinition(): String {
            return "Nested: $nestedParam"
        }
    }
    
    // Companion object test
    companion object TestCompanionDefinition {
        const val COMPANION_CONSTANT = "constant"
        
        fun companionMethodDefinition(): String {
            return "Companion method"
        }
    }
}

// Data class declaration test - at least 4 lines long
data class TestDataClassDefinition<T, R>(
    val dataClassParam1: T,
    val dataClassParam2: (T) -> R,
    val dataClassParam3: Map<String, Any> = mapOf(),
    val dataClassParam4: List<T> = listOf()
) where T : Any, R : Any {
    
    fun dataClassMethodDefinition(): R {
        return dataClassParam2(dataClassParam1)
    }
    
    fun dataClassListMethodDefinition(): List<R> {
        return dataClassParam4.map(dataClassParam2)
    }
}

// Extension function declaration test - at least 4 lines long
fun String.testExtensionFunctionDefinition(
    extensionParam1: String,
    extensionParam2: String = "",
    extensionParam3: (String) -> String = { it }
): String {
    val modified = "$extensionParam1$this$extensionParam2"
    return extensionParam3(modified).trim()
}

// Infix function declaration test - at least 4 lines long
infix fun Int.testInfixFunctionDefinition(
    infixParam: Int
): Int {
    val multiplier = if (infixParam > 0) 2 else 1
    return this + infixParam * multiplier
}

// Flow class declaration test - at least 4 lines long
class TestFlowClassDefinition {
    private val _stateFlowDefinition = MutableStateFlow<String>("")
    val stateFlowDefinition: StateFlow<String> = _stateFlowDefinition.asStateFlow()
    
    fun testFlowCollectionDefinition(
        count: Int = 5,
        delayTime: Long = 100
    ): Flow<Int> = flow {
        for (i in 1..count) {
            emit(i)
            delay(delayTime)
        }
    }
    
    fun updateStateFlowDefinition(
        newValue: String
    ) {
        _stateFlowDefinition.value = newValue
    }
}

// Suspend function declaration test - at least 4 lines long
class TestCoroutineClassDefinition {
    private val coroutineScope = CoroutineScope(
        Dispatchers.Default + SupervisorJob()
    )
    
    suspend fun testSuspendFunctionDefinition(
        items: List<String>,
        processDelay: Long = 100
    ): List<String> = coroutineScope {
        items.map { item ->
            async {
                processSuspendItemDefinition(
                    item,
                    processDelay
                )
            }
        }.awaitAll()
    }
    
    private suspend fun processSuspendItemDefinition(
        item: String,
        delay: Long
    ): String {
        delay(delay)
        return "Processed suspend item: $item"
    }
}

// Sealed interface declaration test - at least 4 lines long
sealed interface TestSealedInterfaceDefinition<T> {
    val interfaceMetadata: Map<String, Any>
    
    data class SealedSuccess<T>(
        val successData: T,
        override val interfaceMetadata: Map<String, Any>
    ) : TestSealedInterfaceDefinition<T>
    
    data class SealedError<T>(
        val errorData: Throwable,
        override val interfaceMetadata: Map<String, Any>
    ) : TestSealedInterfaceDefinition<T>
    
    class SealedLoading<T>(
        override val interfaceMetadata: Map<String, Any> = mapOf()
    ) : TestSealedInterfaceDefinition<T>
}

// Object declaration test - at least 4 lines long
object TestObjectDefinition {
    private var objectCount: Int by lazy {
        calculateObjectCountDefinition()
    }
    
    private fun calculateObjectCountDefinition(): Int {
        return (1..10).sum()
    }
    
    val objectDelegatedString by lazy {
        val prefix = "Computed"
        val value = objectCount * 2
        "$prefix string value: $value"
    }
    
    fun getObjectCountDefinition(): Int {
        return objectCount
    }
}

// Operator overloading test - at least 4 lines long
data class TestOperatorDefinition(
    val operatorValue: Int,
    val operatorName: String = "default"
) {
    operator fun plus(
        other: TestOperatorDefinition
    ): TestOperatorDefinition {
        val otherName = other.operatorName
        return TestOperatorDefinition(
            operatorValue + other.operatorValue,
            "$operatorName + $otherName"
        )
    }
    
    operator fun invoke(
        multiplier: Int
    ): TestOperatorDefinition {
        return TestOperatorDefinition(
            operatorValue * multiplier,
            "$operatorName * $multiplier"
        )
    }
}

// Higher-order function declaration test - at least 4 lines long
fun TestOperatorDefinition.testHigherOrderFunctionDefinition(
    param1: String,
    param2: Int,
    operation: TestOperatorDefinition.(String, Int) -> Int
): Int {
    return this.operation(param1, param2)
}

// Suspend function with Flow declaration test - at least 4 lines long
suspend fun testSuspendFlowFunctionDefinition(
    scope: CoroutineScope,
    timeout: Long = 1000L,
    maxCount: Int = 10
): Flow<String> = flow {
    var count = 0
    while (currentCoroutineContext().isActive && count < maxCount) {
        val message = buildString {
            append("Count: ")
            append(count)
            append(", Timeout: ")
            append(timeout)
        }
        emit(message)
        count++
        delay(timeout)
    }
}

// Sealed class declaration test - at least 4 lines long
sealed class TestSealedClassDefinition {
    abstract val sealedProperty: String
    
    data class SealedSubclassOneDefinition(
        val subclassValue: String,
        override val sealedProperty: String
    ) : TestSealedClassDefinition()
    
    class SealedSubclassTwoDefinition(
        override val sealedProperty: String
    ) : TestSealedClassDefinition() {
        fun subclassMethod(): String {
            return "Subclass Two: $sealedProperty"
        }
    }
    
    object SealedSubclassThreeDefinition : TestSealedClassDefinition() {
        override val sealedProperty: String = "Object Subclass"
        
        fun objectMethod(): String {
            return "Subclass Three: $sealedProperty"
        }
    }
}

// Function type with receiver declaration test - at least 4 lines long
fun TestSealedClassDefinition.testReceiverFunctionDefinition(
    receiverParam1: String,
    receiverParam2: Int,
    block: TestSealedClassDefinition.(
        String,
        Int
    ) -> String
): String {
    return this.block(receiverParam1, receiverParam2)
}
`
