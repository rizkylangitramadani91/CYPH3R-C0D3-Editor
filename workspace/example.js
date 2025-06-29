// Example JavaScript file
console.log('Hello from Web Code Editor!');

// Function to greet user
function greetUser(name) {
    return `Hello, ${name}! Welcome to the web-based code editor.`;
}

// Example of async function
async function fetchData(url) {
    try {
        const response = await fetch(url);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching data:', error);
        return null;
    }
}

// Class example
class WebEditor {
    constructor(name) {
        this.name = name;
        this.version = '1.0.0';
    }
    
    getInfo() {
        return {
            name: this.name,
            version: this.version,
            features: [
                'Code editing with syntax highlighting',
                'File management',
                'Terminal access',
                'Multi-tab support'
            ]
        };
    }
}

// Usage example
const editor = new WebEditor('Web Code Editor');
console.log(editor.getInfo());

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { greetUser, fetchData, WebEditor };
} 