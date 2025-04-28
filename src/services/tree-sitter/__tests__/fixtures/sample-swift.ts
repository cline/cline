export default String.raw`
// MARK: - Class Definitions

// Standard class definition test - at least 4 lines long
class StandardClassDefinition {
    private var standardProperty: String
    
    func standardMethod() -> String {
        return "Standard class method"
    }
}

// Final class definition test - at least 4 lines long
final class FinalClassDefinition {
    private let finalProperty: Int
    
    func finalClassMethod(
        parameter: String
    ) -> Int {
        return finalProperty
    }
}

// Open class definition test - at least 4 lines long
open class OpenClassDefinition {
    public var openProperty: Double
    
    open func openOverridableMethod(
        parameter1: String,
        parameter2: Int
    ) -> Double {
        return openProperty
    }
}

// Class with inheritance and protocol conformance test - at least 4 lines long
class InheritingClassDefinition: StandardClassDefinition, ProtocolDefinition {
    var protocolRequiredProperty: String = "Required property"
    
    override func standardMethod() -> String {
        return "Overridden method"
    }
    
    func protocolRequiredMethod(
        with parameter: String
    ) -> Bool {
        return !parameter.isEmpty
    }
}

// MARK: - Struct Definitions

// Standard struct definition test - at least 4 lines long
struct StandardStructDefinition {
    private var standardStructProperty: String
    let readOnlyProperty: Int
    
    mutating func modifyingMethod(
        newValue: String
    ) {
        standardStructProperty = newValue
    }
}

// Generic struct definition test - at least 4 lines long
struct GenericStructDefinition<T: Comparable, U> {
    private var items: [T]
    private var mappings: [T: U]
    
    init(
        items: [T] = [],
        mappings: [T: U] = [:]
    ) {
        self.items = items
        self.mappings = mappings
    }
    
    func findMapping(for key: T) -> U? {
        return mappings[key]
    }
}

// MARK: - Protocol Definitions

// Protocol with requirements test - at least 4 lines long
protocol ProtocolDefinition {
    var protocolRequiredProperty: String { get set }
    
    func protocolRequiredMethod(
        with parameter: String
    ) -> Bool
}

// Protocol with associated type test - at least 4 lines long
protocol AssociatedTypeProtocolDefinition {
    associatedtype AssociatedItem
    
    var items: [AssociatedItem] { get set }
    
    func add(
        item: AssociatedItem
    )
    
    func remove(at index: Int)
}

// MARK: - Extension Definitions

// Class extension test - at least 4 lines long
extension StandardClassDefinition {
    func classExtensionMethod(
        parameter1: String,
        parameter2: Int
    ) -> String {
        return "Extended class method: \\(parameter1), \\(parameter2)"
    }
}

// Struct extension test - at least 4 lines long
extension StandardStructDefinition {
    func structExtensionMethod(
        parameter: Double
    ) -> String {
        return "Extended struct method: \\(parameter)"
    }
}

// Protocol extension test - at least 4 lines long
extension ProtocolDefinition {
    func protocolExtensionMethod(
        parameter1: Int,
        parameter2: Bool
    ) -> String {
        return "Protocol extension method"
    }
}

// MARK: - Function Definitions

// Instance method definition test - at least 4 lines long
class MethodContainer {
    func instanceMethodDefinition(
        parameter1: String,
        parameter2: Int,
        parameter3: Double
    ) -> String {
        return "Instance method"
    }
}

// Type method definition test - at least 4 lines long
struct TypeMethodContainer {
    static func typeMethodDefinition(
        parameter1: String,
        parameter2: Int,
        parameter3: Double
    ) -> String {
        return "Type method"
    }
}

// MARK: - Property Definitions

// Stored property definition test - at least 4 lines long
class StoredPropertyContainer {
    // Simple stored property
    private var privateStoredProperty: String = "Private"
    
    // Stored property with property observer
    var storedPropertyWithObserver: Int = 0 {
        willSet {
            print("Will change from \\(storedPropertyWithObserver) to \\(newValue)")
        }
        didSet {
            print("Did change from \\(oldValue) to \\(storedPropertyWithObserver)")
        }
    }
}

// Computed property definition test - at least 4 lines long
class ComputedPropertyContainer {
    private var backingStorage: String = ""
    
    // Full computed property
    var computedProperty: String {
        get {
            return backingStorage.uppercased()
        }
        set {
            backingStorage = newValue.lowercased()
        }
    }
    
    // Read-only computed property
    var readOnlyComputedProperty: Int {
        return backingStorage.count * 2
    }
}

// MARK: - Initializer Definitions

// Designated initializer definition test - at least 4 lines long
class DesignatedInitializerContainer {
    let property1: String
    let property2: Int
    
    // Designated initializer
    init(
        property1: String,
        property2: Int
    ) {
        self.property1 = property1
        self.property2 = property2
    }
}

// Convenience initializer definition test - at least 4 lines long
class ConvenienceInitializerContainer {
    let property1: String
    let property2: Int
    
    // Designated initializer
    init(property1: String, property2: Int) {
        self.property1 = property1
        self.property2 = property2
    }
    
    // Convenience initializer
    convenience init(
        defaultsWithOverride: String = "Default"
    ) {
        self.init(
            property1: defaultsWithOverride,
            property2: 42
        )
    }
}

// MARK: - Deinitializer Definition

// Deinitializer definition test - at least 4 lines long
class DeinitializerDefinition {
    private var resource: String
    
    init(resource: String) {
        self.resource = resource
        print("Initialized with: \\(resource)")
    }
    
    deinit {
        print("Releasing resource: \\(resource)")
        resource = ""
        // Perform cleanup
    }
}

// MARK: - Subscript Definition

// Subscript definition test - at least 4 lines long
class SubscriptDefinition {
    private var items: [String] = []
    
    subscript(
        index: Int,
        default defaultValue: String = ""
    ) -> String {
        get {
            guard index >= 0 && index < items.count else {
                return defaultValue
            }
            return items[index]
        }
        set {
            while items.count <= index {
                items.append(defaultValue)
            }
            items[index] = newValue
        }
    }
}

// MARK: - Type Alias Definition

// Type alias definition test - at least 4 lines long
class TypeAliasContainer {
    // Simple type alias
    typealias SimpleTypeAlias = String
    
    // Complex type alias with generic constraints
    typealias DictionaryOfArrays<
        Key: Hashable,
        Value: Equatable
    > = [Key: [Value]]
    
    // Using the type alias
    var dictionaryOfArrays: DictionaryOfArrays<String, Int> = [:]
}
`
