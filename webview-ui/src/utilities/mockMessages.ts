import { ClaudeMessage } from "@shared/ExtensionMessage";

export const mockMessages: ClaudeMessage[] = [
	{
		ts: Date.now() - 3600000,
		type: "say",
		say: "task",
		text: "Create a React component for a todo list application",
	},
	{
		ts: Date.now() - 3500000,
		type: "say",
		say: "api_req_started",
		text: JSON.stringify({
			request: {
				text: "Create a React component for a todo list application",
				type: "text",
			},
			tokensIn: 10,
			tokensOut: 250,
			cost: 0.0002,
		}),
	},
	{
		ts: Date.now() - 3300000,
		type: "say",
		say: "text",
		text: "Here's a basic React component for a todo list application:",
	},
	{
		ts: Date.now() - 3200000,
		type: "say",
		say: "tool",
		text: JSON.stringify({
			tool: "newFileCreated",
			path: "/src/components/TodoList.tsx",
			content: `import React, { useState } from 'react';
  
  interface Todo {
    id: number;
    text: string;
    completed: boolean;
  }
  
  const TodoList: React.FC = () => {
    const [todos, setTodos] = useState<Todo[]>([]);
    const [inputValue, setInputValue] = useState('');
  
    const addTodo = () => {
      if (inputValue.trim() !== '') {
        setTodos([...todos, { id: Date.now(), text: inputValue, completed: false }]);
        setInputValue('');
      }
    };
  
    const toggleTodo = (id: number) => {
      setTodos(todos.map(todo =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo
      ));
    };
  
    return (
      <div>
        <h1>Todo List</h1>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Add a new todo"
        />
        <button onClick={addTodo}>Add</button>
        <ul>
          {todos.map(todo => (
            <li
              key={todo.id}
              onClick={() => toggleTodo(todo.id)}
              style={{ textDecoration: todo.completed ? 'line-through' : 'none' }}
            >
              {todo.text}
            </li>
          ))}
        </ul>
      </div>
    );
  };
  
  export default TodoList;`,
		}),
	},
	{
		ts: Date.now() - 3100000,
		type: "say",
		say: "text",
		text: "I've created a new file 'TodoList.tsx' in the '/src/components/' directory. This component includes basic functionality for adding and toggling todos. You can further customize and style it as needed.",
	},
	{
		ts: Date.now() - 3000000,
		type: "ask",
		ask: "followup",
		text: "Do you want me to explain the code or add any additional features to the todo list?",
	},
	{
		ts: Date.now() - 2900000,
		type: "say",
		say: "text",
		text: "Let's add a feature to delete todos from the list.",
	},
	{
		ts: Date.now() - 2800000,
		type: "say",
		say: "api_req_started",
		text: JSON.stringify({
			request: {
				text: "Add a feature to delete todos from the list",
				type: "text",
			},
			tokensIn: 8,
			tokensOut: 180,
			cost: 0.0003,
		}),
	},
	{
		ts: Date.now() - 2600000,
		type: "say",
		say: "tool",
		text: JSON.stringify({
			tool: "editedExistingFile",
			path: "/src/components/TodoList.tsx",
			diff: `+ 
+ 
  import React, { useState } from "react"
  
  interface Todo {
  	id: number
  	text: string
  	completed: boolean
  }
  
  const TodoList: React.FC = () => {
  	const [todos, setTodos] = useState<Todo[]>([])
  	const [inputValue, setInputValue] = useState("")
  
  	const addTodo = () => {
  		if (inputValue.trim() !== "") {
  			setTodos([...todos, { id: Date.now(), text: inputValue, completed: false }])
  			setInputValue("")
  		}
  	}
  
  	const toggleTodo = (id: number) => {
  		setTodos(todos.map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo)))
  	}
  
  	return (
  		<div>
  			<h1>Todo List</h1>
  			<input
  				type="text"
  				value={inputValue}
  				onChange={(e) => setInputValue(e.target.value)}
  				placeholder="Add a new todo"
  			/>
  
- 			<button onClick={addTodo}>Add</button>
- 			<ul>
- 				{todos.map((todo) => (
- 					<li
- 						key={todo.id}
- 						onClick={() => toggleTodo(todo.id)}
- 						style={{ textDecoration: todo.completed ? "line-through" : "none" }}>
- 						{todo.text}
- 					</li>
- 				))}
- 			</ul>
- 		</div>
- 
+ 			
+ 
  	)
  }
  
  export default TodoList
  
+ 
+ 		
`,
		}),
	},
	{
		ts: Date.now() - 2500000,
		type: "say",
		say: "text",
		text: "I've updated the TodoList component to include a delete feature. Each todo item now has a 'Delete' button that removes the todo from the list when clicked.",
	},
	{
		ts: Date.now() - 2400000,
		type: "ask",
		ask: "command",
		text: "npm run test\n\nOutput:\nPASS  src/__tests__/TodoList.test.tsx\n  TodoList Component\n    ✓ renders without crashing (23 ms)\n    ✓ adds a new todo when the add button is clicked (34 ms)\n    ✓ toggles a todo when clicked (45 ms)\n    ✓ deletes a todo when the delete button is clicked (28 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       4 passed, 4 total\nSnapshots:   0 total\nTime:        1.234 s\nRan all test suites.",
	},
	{
		ts: Date.now() - 2300000,
		type: "say",
		say: "text",
		text: "Great! The tests for the TodoList component have passed. All functionalities, including the new delete feature, are working as expected.",
	},
	{
		ts: Date.now() - 2200000,
		type: "ask",
		ask: "request_limit_reached",
		text: "You've reached the maximum number of requests for this task. Would you like to continue or start a new task?",
	},
	{
		ts: Date.now() - 2100000,
		type: "say",
		say: "text",
		text: "Let's start a new task. What would you like to work on next?",
	},
	{
		ts: Date.now() - 2000000,
		type: "say",
		say: "task",
		text: "Create a simple API using Express.js",
	},
	{
		ts: Date.now() - 1900000,
		type: "say",
		say: "api_req_started",
		text: JSON.stringify({
			request: {
				text: "Create a simple API using Express.js",
				type: "text",
			},
			tokensIn: 7,
			tokensOut: 220,
			cost: 0.0002,
		}),
	},
	{
		ts: Date.now() - 1700000,
		type: "say",
		say: "tool",
		text: JSON.stringify({
			tool: "newFileCreated",
			path: "/src/app.js",
			content: `const express = require('express');
  const app = express();
  const port = 3000;
  
  app.use(express.json());
  
  let items = [];
  
  app.get('/items', (req, res) => {
    res.json(items);
  });
  
  app.post('/items', (req, res) => {
    const newItem = req.body;
    items.push(newItem);
    res.status(201).json(newItem);
  });
  
  app.get('/items/:id', (req, res) => {
    const item = items.find(i => i.id === parseInt(req.params.id));
    if (item) {
      res.json(item);
    } else {
      res.status(404).send('Item not found');
    }
  });
  
  app.listen(port, () => {
    console.log(\`API running on http://localhost:\${port}\`);
  });`,
		}),
	},
	{
		ts: Date.now() - 1600000,
		type: "say",
		say: "text",
		text: "I've created a simple Express.js API with endpoints for getting all items, adding a new item, and getting a specific item by ID. The API is set up to run on port 3000.",
	},
	{
		ts: Date.now() - 1500000,
		type: "ask",
		ask: "command",
		text: "npm install express\n\nOutput:\nadded 57 packages, and audited 58 packages in 3s\n\n7 packages are looking for funding\n  run `npm fund` for details\n\nfound 0 vulnerabilities",
	},
	{
		ts: Date.now() - 1400000,
		type: "say",
		say: "text",
		text: "Express has been successfully installed. You can now run the API using 'node app.js' in the terminal.",
	},
	{
		ts: Date.now() - 1300000,
		type: "ask",
		ask: "completion_result",
		text: "The API has been successfully created and set up. Is there anything else you'd like me to do with this API?",
	},
	{
		ts: Date.now() - 1200000,
		type: "say",
		say: "error",
		text: "An error occurred while trying to start the server: EADDRINUSE: address already in use :::3000",
	},
	{
		ts: Date.now() - 1100000,
		type: "say",
		say: "text",
		text: "It seems that port 3000 is already in use. Let's modify the code to use a different port.",
	},
	{
		ts: Date.now() - 1000000,
		type: "say",
		say: "tool",
		text: JSON.stringify({
			tool: "editedExistingFile",
			path: "/src/app.js",
			diff: `@@ -1,6 +1,6 @@
   const express = require('express');
   const app = express();
  -const port = 3000;
  +const port = process.env.PORT || 3001;
   
   app.use(express.json());
   `,
		}),
	},
	{
		ts: Date.now() - 900000,
		type: "say",
		say: "text",
		text: "I've updated the code to use port 3001 if port 3000 is not available. You can now try running the server again.",
	},
	{
		ts: Date.now() - 800000,
		type: "ask",
		ask: "command",
		text: "node app.js\n\nOutput:\nAPI running on http://localhost:3001",
	},
	{
		ts: Date.now() - 700000,
		type: "say",
		say: "text",
		text: "Great! The API is now running successfully on port 3001.",
	},
	{
		ts: Date.now() - 600000,
		type: "ask",
		ask: "completion_result",
		text: "The API has been created, set up, and is now running successfully. Is there anything else you'd like me to do?",
	},
]
