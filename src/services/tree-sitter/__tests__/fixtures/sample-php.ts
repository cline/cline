export default String.raw`<?php
declare(strict_types=1);

// Namespace declaration test - at least 4 lines long
namespace StandardNamespaceDefinition\\Core\\Testing {
    // Namespace-level constants and functions can go here
    const NAMESPACE_VERSION = '1.0.0';
}

// Use statement declarations test - at least 4 lines long
use StandardNamespaceDefinition\\Interfaces\\{
    StandardInterfaceDefinition,
    AnotherInterfaceDefinition
};
use StandardNamespaceDefinition\\Traits\\{
    StandardTraitDefinition,
    LoggableTraitDefinition
};
use StandardNamespaceDefinition\\Enums\\StandardEnumDefinition;
use StandardNamespaceDefinition\\Attributes\\StandardAttributeDefinition;

// Attribute declaration test - at least 4 lines long
#[Attribute(Attribute::TARGET_CLASS | Attribute::TARGET_METHOD)]
class StandardAttributeDefinition
{
    public function __construct(
        private string $description,
        private int $priority = 0,
        private array $tags = []
    ) {
        // Validate inputs
        if (empty($description)) {
            throw new InvalidArgumentException('Description cannot be empty');
        }
    }
}

// Standard class declaration test - at least 4 lines long
#[StandardAttributeDefinition(
    description: 'Standard class implementation',
    priority: 1,
    tags: ['core', 'standard']
)]
class StandardClassDefinition
{
    // Property declarations with type hints and nullability
    private string $standardPrivateProperty;
    protected int $standardProtectedProperty;
    public ?array $standardNullableProperty;
    
    // Constructor with property promotion
    public function __construct(
        private readonly string $standardPromotedProperty,
        protected int $standardPromotedProtected = 0,
        public array $standardPromotedPublic = []
    ) {
        $this->standardPrivateProperty = $standardPromotedProperty;
        $this->standardProtectedProperty = $standardPromotedProtected;
    }

    // Standard method with multiple parameters and return type
    public function standardMethodDefinition(
        string $standardParam1,
        array $standardParam2 = [],
        ?int $standardParam3 = null
    ): void {
        $this->standardPrivateProperty = $standardParam1;
        $this->standardNullableProperty = $standardParam2;
    }
}

// Interface declaration test - at least 4 lines long
interface StandardInterfaceDefinition
{
    // Method with class type hint
    public function standardInterfaceMethodWithClass(
        StandardClassDefinition $standardParam1,
        string $standardParam2
    ): array;
    
    // Method with nullable return
    public function standardInterfaceMethodNullable(
        int $standardParam1,
        bool $standardParam2 = true
    ): ?string;
    
    // Method with void return
    public function standardInterfaceMethodVoid(
        string $standardParam
    ): void;
    
    // Method with mixed return (PHP 8.0+)
    public function standardInterfaceMethodMixed(
        mixed $standardParam
    ): mixed;
}

// Trait declaration test - at least 4 lines long
trait StandardTraitDefinition
{
    // Trait properties
    private string $standardTraitProperty = '';
    protected array $standardTraitConfig = [];
    
    // Trait method with visibility modifier
    protected function standardTraitMethod(
        int $standardParam = 0,
        bool $standardFlag = false,
        ?string $standardOptional = null
    ): string {
        // Method implementation
        $this->standardTraitProperty = (string)$standardParam;
        return $this->standardTraitProperty;
    }
    
    // Abstract method in trait
    abstract protected function standardTraitAbstractMethod(): void;
}

// Enum declaration test (PHP 8.1+) - at least 4 lines long
enum StandardEnumDefinition: string
{
    // Enum cases with values
    case PERMISSION_READ = 'read';
    case PERMISSION_WRITE = 'write';
    case PERMISSION_EXECUTE = 'execute';
    case PERMISSION_DELETE = 'delete';
    
    // Enum method using match expression
    public function standardEnumMethod(): array
    {
        return match($this) {
            self::PERMISSION_READ => ['read'],
            self::PERMISSION_WRITE => ['read', 'write'],
            self::PERMISSION_EXECUTE => ['read', 'execute'],
            self::PERMISSION_DELETE => ['read', 'write', 'delete'],
        };
    }
    
    // Static enum method
    public static function standardEnumFromString(
        string $permission
    ): ?self {
        return match($permission) {
            'read' => self::PERMISSION_READ,
            'write' => self::PERMISSION_WRITE,
            'execute' => self::PERMISSION_EXECUTE,
            'delete' => self::PERMISSION_DELETE,
            default => null
        };
    }
}

// Abstract class declaration test - at least 4 lines long
#[StandardAttributeDefinition(
    description: 'Abstract base class',
    priority: 2,
    tags: ['abstract', 'base']
)]
abstract class StandardAbstractClassDefinition
{
    // Class constants
    protected const STANDARD_STATUS_ACTIVE = 'active';
    protected const STANDARD_STATUS_INACTIVE = 'inactive';
    
    // Static property with type
    private static string $standardStaticProperty = '';
    
    // Constructor with promoted properties
    public function __construct(
        private string $standardPromotedProperty,
        protected readonly int $standardReadonlyProperty,
        public array $standardConfig = []
    ) {
        self::$standardStaticProperty = $standardPromotedProperty;
        $this->validateConfig();
    }
    
    // Abstract method declaration
    abstract public function standardAbstractMethod(
        string $standardParam,
        array $standardOptions = []
    ): string;
    
    // Static method with return type
    public static function standardStaticMethod(
        string $standardValue
    ): string {
        self::$standardStaticProperty = $standardValue;
        return self::$standardStaticProperty;
    }
    
    // Protected validation method
    protected function validateConfig(): void
    {
        if (empty($this->standardConfig)) {
            throw new InvalidArgumentException('Config cannot be empty');
        }
    }
}

// Final class declaration test - at least 4 lines long
#[StandardAttributeDefinition(
    description: 'Final implementation class',
    priority: 3,
    tags: ['final', 'implementation']
)]
final class StandardFinalClassDefinition extends StandardAbstractClassDefinition
{
    // Implementation of abstract method
    public function standardAbstractMethod(
        string $standardParam,
        array $standardOptions = []
    ): string {
        return sprintf(
            '%s: %s',
            $this->standardPromotedProperty,
            $standardParam
        );
    }
    
    // Method with union types (PHP 8.0+)
    public function standardUnionTypesMethod(
        string|int|float $standardParam,
        bool $standardFlag = false
    ): string|int {
        return $standardFlag ? (string)$standardParam : (int)$standardParam;
    }
    
    // Method with intersection types (PHP 8.1+)
    public function standardIntersectionTypesMethod(
        Countable&Iterator $standardParam,
        bool $standardReturnCount = true
    ): int {
        return $standardReturnCount ?
            count($standardParam) :
            iterator_count($standardParam);
    }
}

// Anonymous class declaration test - at least 4 lines long
$standardAnonymousClass = new class(
    standardId: 'anonymous_1',
    standardConfig: ['type' => 'anonymous']
) extends StandardClassDefinition
{
    public function __construct(
        private string $standardId,
        private array $standardConfig
    ) {
        parent::__construct(
            standardPromotedProperty: $standardId,
            standardPromotedPublic: $standardConfig
        );
    }

    public function standardAnonymousMethod(): string
    {
        return sprintf(
            'Anonymous[%s]: %s',
            $this->standardId,
            json_encode($this->standardConfig)
        );
    }
};

// Global function declaration test - at least 4 lines long
function standardGlobalFunction(
    string $standardParam1,
    ?array $standardParam2 = null,
    int $standardParam3 = 0,
    bool $standardFlag = false
): mixed {
    // Function implementation with multiple returns
    if ($standardFlag) {
        return array_merge(
            [$standardParam1],
            $standardParam2 ?? []
        );
    }
    
    return $standardParam2 ?? $standardParam1;
}

// Arrow function declaration test - at least 4 lines long
$standardArrowFunction = fn(
    int $standardX,
    int $standardY,
    float $standardMultiplier = 1.0
): float =>
    ($standardX + $standardY) * $standardMultiplier;

// Heredoc syntax test - at least 4 lines long
$standardHeredocContent = <<<HTML
<div class="standard-component">
    <header class="standard-header">
        <h1>Standard Component Title</h1>
        <nav class="standard-navigation">
            <ul>
                <li><a href="#section1">Section 1</a></li>
                <li><a href="#section2">Section 2</a></li>
            </ul>
        </nav>
    </header>
    <main class="standard-content">
        <p>Standard paragraph with multiple lines
           to ensure proper parsing of heredoc
           syntax in PHP code samples</p>
    </main>
</div>
HTML;

// Nowdoc syntax test - at least 4 lines long
$standardNowdocContent = <<<'SQL'
WITH standard_cte AS (
    SELECT
        column1,
        column2,
        COUNT(*) as record_count,
        MAX(updated_at) as last_update
    FROM standard_table
    WHERE status = 'active'
        AND created_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY
        column1,
        column2
    HAVING COUNT(*) > 1
)
SELECT
    s.*,
    t.related_data
FROM standard_cte s
JOIN another_table t ON t.id = s.column1
ORDER BY s.record_count DESC, s.last_update DESC
SQL;`
