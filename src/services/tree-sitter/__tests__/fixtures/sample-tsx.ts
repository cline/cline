// Sample TSX content for testing tree-sitter parsing of React and TypeScript structures
export default String.raw`
// Type Definitions (interfaces and type aliases) - spans 4+ lines
interface StandardInterfaceProps {
  required: string;
  numeric: number;
  callback: () => void;
  complex: { id: string; value: number }[];
}

type StandardTypeAlias = {
  id: string;
  name: string;
  timestamp: Date;
  status: 'active' | 'inactive';
};

// Props Definitions (required and optional props) - spans 4+ lines
interface PropsDefinitionExample {
  // Required props
  requiredString: string;
  requiredNumber: number;
  requiredCallback: (value: string) => void;
  // Optional props
  optionalBoolean?: boolean;
  optionalObject?: { key: string };
  optionalArray?: string[];
}

// Function Components (function declarations and arrow functions) - spans 4+ lines
function StandardFunctionComponent(props: StandardInterfaceProps): JSX.Element {
  const { required, numeric, callback, complex } = props;
  
  return (
    <div className="standard-component">
      {required}: {numeric}
    </div>
  );
}

// Arrow function component - spans 4+ lines
export const ArrowFunctionComponent: React.FC<PropsDefinitionExample> = ({
  requiredString,
  requiredNumber,
  requiredCallback,
  optionalBoolean = false,
  optionalObject,
  optionalArray = []
}) => {
  return (
    <div>
      {requiredString}
      {optionalArray.join(', ')}
    </div>
  );
};

// Class Components (React.Component inheritance) - spans 4+ lines
interface ClassComponentState {
  count: number;
  isActive: boolean;
  data: string[];
  lastUpdated: Date;
}

class StandardClassComponent extends React.Component<StandardInterfaceProps, ClassComponentState> {
  constructor(props: StandardInterfaceProps) {
    super(props);
    this.state = {
      count: 0,
      isActive: true,
      data: [],
      lastUpdated: new Date()
    };
    this.handleClick = this.handleClick.bind(this);
  }

  handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    this.setState(prevState => ({
      count: prevState.count + 1,
      lastUpdated: new Date()
    }));
  };

  render() {
    return (
      <div className="class-component">
        <h2>{this.props.required}</h2>
        <p>Count: {this.state.count}</p>
        <button onClick={this.handleClick}>
          Increment
        </button>
      </div>
    );
  }
}

// Higher Order Components (HOC patterns) - spans 4+ lines
function withLogging<P extends object>(
  Component: React.ComponentType<P>
): React.FC<P> {
  return function WithLoggingComponent(props: P) {
    React.useEffect(() => {
      console.log('Component rendered with props:', props);
      return () => {
        console.log('Component will unmount');
      };
    }, [props]);

    return <Component {...props} />;
  };
}

// Enhanced component with HOC - spans 4+ lines
const EnhancedFunctionComponent = withLogging(
  StandardFunctionComponent
);

// JSX Elements (standard and self-closing) - spans 4+ lines
const JSXElementsExample: React.FC = () => {
  return (
    <div className="jsx-elements-container">
      <h1 className="jsx-heading">
        Standard JSX Element
      </h1>
      <img
        src="/path/to/image.png"
        alt="Self-closing element example"
        className="jsx-image"
      />
      <Input
        type="text"
        placeholder="Self-closing component example"
        onChange={(e) => console.log(e.target.value)}
        className="input-field"
      />
      <UI.Button
        variant="primary"
        size="large"
        onClick={() => alert("Clicked!")}
      >
        Member Expression Component
      </UI.Button>
      <StandardFunctionComponent
        required="test"
        numeric={42}
        callback={() => {}}
        complex={[{ id: '1', value: 1 }]}
      />
    </div>
  );
};

// Event Handlers (synthetic events) - spans 4+ lines
const EventHandlersComponent: React.FC = () => {
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    console.log('Button clicked', event.currentTarget);
    event.preventDefault();
    event.stopPropagation();
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    console.log('Input value changed:', value);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    console.log('Form submitted');
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        onChange={handleChange}
        placeholder="Type something..."
      />
      <button
        onClick={handleClick}
        type="submit"
      >
        Submit
      </button>
    </form>
  );
};

// State Definitions (class and hooks) - spans 4+ lines
const HooksStateComponent: React.FC = () => {
  const [count, setCount] = React.useState<number>(0);
  const [user, setUser] = React.useState<{
    name: string;
    age: number;
    isActive: boolean;
  }>({
    name: 'John',
    age: 30,
    isActive: true
  });
  
  const incrementCount = () => {
    setCount(prevCount => prevCount + 1);
  };

  const updateUser = () => {
    setUser({
      ...user,
      age: user.age + 1,
      isActive: !user.isActive
    });
  };

  return (
    <div>
      <p>Count: {count}</p>
      <p>User: {user.name}, {user.age}, {user.isActive ? 'Active' : 'Inactive'}</p>
      <button onClick={incrementCount}>Increment Count</button>
      <button onClick={updateUser}>Update User</button>
    </div>
  );
};

// Hooks Usage (built-in hooks) - spans 4+ lines
const HooksUsageComponent: React.FC<{ id: string }> = ({ id }) => {
  const [data, setData] = React.useState<string[]>([]);
  const counter = React.useRef<number>(0);
  const prevId = React.useRef<string>();
  
  React.useEffect(() => {
    console.log('Component mounted');
    fetchData(id);
    
    return () => {
      console.log('Component unmounted');
    };
  }, [id]);

  React.useEffect(() => {
    prevId.current = id;
  }, [id]);

  const fetchData = React.useCallback((userId: string) => {
    counter.current += 1;
    // Mock fetch to avoid async/await parsing issues
    setTimeout(() => {
      setData(['user_data_1', 'user_data_2']);
    }, 100);
    setData(data);
  }, []);

  const memoizedValue = React.useMemo(() => {
    return {
      processedData: data.map(item => item.toUpperCase()),
      counter: counter.current
    };
  }, [data]);

  return (
    <div>
      <p>Data loaded: {memoizedValue.processedData.join(', ')}</p>
      <p>Previous ID: {prevId.current}</p>
      <p>Current ID: {id}</p>
      <p>Fetch count: {counter.current}</p>
    </div>
  );
};

// Generic Components (type parameters) - spans 4+ lines
interface GenericComponentProps<T> {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  keyExtractor: (item: T) => string;
  onItemSelect?: (item: T) => void;
}

function GenericListComponent<T>({
  items,
  renderItem,
  keyExtractor,
  onItemSelect
}: GenericComponentProps<T>): JSX.Element {
  return (
    <ul className="generic-list">
      {items.map(item => (
        <li
          key={keyExtractor(item)}
          onClick={() => onItemSelect && onItemSelect(item)}
        >
          {renderItem(item)}
        </li>
      ))}
    </ul>
  );
}

// Usage of generic component - spans 4+ lines
type UserType = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
};

const GenericComponentUsage: React.FC = () => {
  const users: UserType[] = [
    { id: '1', name: 'Alice', email: 'alice@example.com', role: 'admin' },
    { id: '2', name: 'Bob', email: 'bob@example.com', role: 'user' },
    { id: '3', name: 'Charlie', email: 'charlie@example.com', role: 'user' }
  ];

  return (
    <GenericListComponent<UserType>
      items={users}
      keyExtractor={user => user.id}
      renderItem={user => (
        <div className="user-item">
          <strong>{user.name}</strong>
          <span>{user.email}</span>
          <span>{user.role}</span>
        </div>
      )}
      onItemSelect={user => console.log('Selected user:', user)}
    />
  );
};
`
