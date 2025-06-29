// Global variables
let socket;
let monacoEditor;
let terminals = {};
let activeTerminalId = null;
let terminalCounter = 0;
let currentFile = null;
let openTabs = [];
let activeTabIndex = -1;
let fileTree = [];
let contextMenuTarget = null;

// Utility functions
function generateSessionId() {
    return Math.floor(Math.random() * 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    console.log('[INIT] Starting application initialization...');
    
    // Check authentication status
    checkAuthStatus();
    
    // Initialize core systems
    initializeSocket();
    initializeMonacoEditor();
    initializeUI();
    loadFileTree();
    
    // Initialize terminal after socket is ready
    setTimeout(() => {
        console.log('[INIT] Initializing terminal system...');
        initializeTerminal();
    }, 1500);
    
    // Initialize hacker effects if function exists
    if (typeof initializeHackerEffects === 'function') {
        initializeHackerEffects();
    }
});

// Authentication functions
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();
        
        if (data.authEnabled && data.authenticated) {
            // Show logout button
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) {
                logoutBtn.style.display = 'inline-flex';
            }
            
            // Show username in header
            const accessLevel = document.querySelector('.access-level');
            if (accessLevel && data.username) {
                accessLevel.textContent = `USER: ${data.username.toUpperCase()}`;
            }
        }
    } catch (error) {
        console.error('[AUTH] Failed to check auth status:', error);
    }
}

async function logout() {
    if (!confirm('Are you sure you want to logout?')) {
        return;
    }
    
    try {
        const response = await fetch('/api/auth/logout', {
            method: 'POST'
        });
        
        if (response.ok) {
            showNotification('LOGGING OUT...', 'success');
            setTimeout(() => {
                window.location.href = '/login.html';
            }, 1000);
        } else {
            showNotification('LOGOUT FAILED', 'error');
        }
    } catch (error) {
        console.error('[AUTH] Logout error:', error);
        showNotification('LOGOUT ERROR', 'error');
    }
}

// Socket.IO initialization
function initializeSocket() {
    console.log('[SOCKET] Initializing Socket.IO...');
    
    // Check if Socket.IO is loaded
    if (typeof io === 'undefined') {
        console.error('[SOCKET] Socket.IO library not loaded! Retrying...');
        setTimeout(initializeSocket, 500);
        return;
    }
    
    // Get the current host for proper connection
    const host = window.location.protocol + '//' + window.location.host;
    console.log('[SOCKET] Connecting to:', host);
    
    socket = io(host, {
        path: '/socket.io/',
        transports: ['websocket', 'polling'], // Allow fallback to polling
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionDelayMax: 3000,
        reconnectionAttempts: Infinity, // Keep trying forever
        timeout: 10000,
        autoConnect: true,
        forceNew: true, // Force new connection
        query: {
            timestamp: Date.now() // Prevent caching issues
        }
    });
    
    socket.on('connect', () => {
        console.log('[SOCKET] Connected to server with ID:', socket.id);
        updateConnectionStatus('connected');
    });
    
    socket.on('connection-success', (data) => {
        console.log('[SOCKET] Connection confirmed:', data);
        showNotification(`Connected via ${data.transport.toUpperCase()}`, 'success');
        
        // Recreate terminals after successful connection
        setTimeout(() => {
            Object.keys(terminals).forEach(terminalId => {
                createTerminalSession(terminalId);
            });
        }, 100);
    });
    
    socket.on('disconnect', (reason) => {
        console.log('[SOCKET] Disconnected from server. Reason:', reason);
        updateConnectionStatus('disconnected');
        showNotification('LOST SERVER CONNECTION: ' + reason, 'error');
    });
    
    socket.on('connect_error', (error) => {
        console.error('[SOCKET] Connection error:', error.message);
        console.error('[SOCKET] Error type:', error.type);
        
        // Check if error is due to authentication
        if (error.message === 'Authentication required') {
            console.log('[SOCKET] Authentication required, redirecting to login...');
            showNotification('AUTHENTICATION REQUIRED - REDIRECTING TO LOGIN', 'error');
            setTimeout(() => {
                window.location.href = '/login.html';
            }, 1500);
        } else {
            showNotification('CONNECTION ERROR: ' + error.message, 'error');
        }
    });
    
    socket.on('reconnect_attempt', (attemptNumber) => {
        console.log('[SOCKET] Reconnection attempt #' + attemptNumber);
    });
    
    socket.on('reconnect_failed', () => {
        console.error('[SOCKET] Failed to reconnect after all attempts');
        showNotification('FAILED TO RECONNECT TO SERVER', 'error');
    });
    
    socket.on('terminal:created', (data) => {
        console.log('[TERMINAL] Session created:', data);
        if (terminals[data.clientTerminalId]) {
            terminals[data.clientTerminalId].socketId = data.terminalId;
            
            // Send terminal ready message
            const terminal = terminals[data.clientTerminalId].terminal;
            if (terminal) {
                terminal.writeln('\x1b[32m[SYSTEM] Terminal connection established\x1b[0m');
                terminal.writeln('\x1b[36m[INFO] Session ID: ' + data.terminalId + '\x1b[0m');
                terminal.writeln('');
                
                // Focus the terminal
                terminal.focus();
            }
            
            // Update status bar with performance info
            const statusBar = document.querySelector(`#${data.clientTerminalId} .terminal-status-bar`);
            if (statusBar && !statusBar.querySelector('.terminal-performance')) {
                const performanceContainer = document.createElement('div');
                performanceContainer.className = 'terminal-performance';
                performanceContainer.innerHTML = `
                    <div class="status-item">
                        <i class="fas fa-tachometer-alt"></i>
                        <span class="throughput">0 KB/s</span>
                    </div>
                    <div class="status-item">
                        <i class="fas fa-exchange-alt"></i>
                        <span class="messages">0 msg</span>
                    </div>
                `;
                statusBar.querySelector('.status-right').appendChild(performanceContainer);
            }
        }
        showNotification('TERMINAL SESSION READY', 'success');
    });
    
    // Optimized data handler with binary support and batching
    const terminalWriteQueues = new Map();
    
    socket.on('terminal:data', (data) => {
        const terminal = Object.values(terminals).find(t => t.socketId === data.terminalId);
        if (terminal && terminal.terminal) {
            // Get or create write queue for this terminal
            if (!terminalWriteQueues.has(data.terminalId)) {
                terminalWriteQueues.set(data.terminalId, {
                    queue: [],
                    processing: false
                });
            }
            
            const queue = terminalWriteQueues.get(data.terminalId);
            
            // Add data to queue
            if (data.binary && data.data) {
                queue.queue.push(new Uint8Array(data.data));
            } else {
                queue.queue.push(data.data);
            }
            
            // Process queue if not already processing
            if (!queue.processing) {
                queue.processing = true;
                requestAnimationFrame(() => processTerminalQueue(terminal.terminal, queue));
            }
        }
    });
    
    // Efficient queue processor using requestAnimationFrame
    function processTerminalQueue(terminal, queue) {
        const startTime = performance.now();
        const maxProcessTime = 16; // Target 60fps
        
        while (queue.queue.length > 0 && (performance.now() - startTime) < maxProcessTime) {
            const data = queue.queue.shift();
            terminal.write(data);
        }
        
        if (queue.queue.length > 0) {
            // More data to process, schedule next frame
            requestAnimationFrame(() => processTerminalQueue(terminal, queue));
        } else {
            queue.processing = false;
        }
    }
    
    // Performance stats handler
    socket.on('terminal:stats', (data) => {
        const terminal = Object.values(terminals).find(t => t.socketId === data.terminalId);
        if (terminal && terminal.element) {
            const throughputElement = terminal.element.querySelector('.throughput');
            const messagesElement = terminal.element.querySelector('.messages');
            
            if (throughputElement) {
                const throughputKB = (data.throughput / 1024).toFixed(2);
                throughputElement.textContent = `${throughputKB} KB/s`;
            }
            
            if (messagesElement) {
                messagesElement.textContent = `${data.messages} msg`;
            }
        }
    });

    socket.on('terminal:exit', (data) => {
        console.log('Terminal exited:', data);
        // Find and handle terminal exit
        const terminalEntry = Object.entries(terminals).find(([id, term]) => term.socketId === data.terminalId);
        if (terminalEntry) {
            const [terminalId, terminal] = terminalEntry;
            terminal.terminal.writeln('');
            terminal.terminal.writeln('\x1b[31m╔═══════════════════════════════════════════════════════════════╗\x1b[0m');
            terminal.terminal.writeln('\x1b[31m║\x1b[0m               \x1b[1;31mTERMINAL SESSION TERMINATED\x1b[0m                \x1b[31m║\x1b[0m');
            terminal.terminal.writeln('\x1b[31m║\x1b[0m                  \x1b[33mRefresh to reconnect\x1b[0m                     \x1b[31m║\x1b[0m');
            terminal.terminal.writeln('\x1b[31m╚═══════════════════════════════════════════════════════════════╝\x1b[0m');
            showNotification(`TERMINAL SESSION ${data.terminalId} ENDED`, 'warning');
        }
    });
    
    // Duplicate handler removed - already handled above
}

// Monaco Editor initialization
function initializeMonacoEditor() {
    require.config({ 
        paths: { 
            'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.34.1/min/vs' 
        } 
    });

    require(['vs/editor/editor.main'], function() {
        const editorContainer = document.getElementById('editor');
        const welcomeScreen = editorContainer.querySelector('.welcome-screen');
        
        monacoEditor = monaco.editor.create(editorContainer, {
            value: '',
            language: 'javascript',
            theme: 'vs-dark',
            automaticLayout: true,
            fontSize: 14,
            lineNumbers: 'on',
            roundedSelection: false,
            scrollBeyondLastLine: false,
            minimap: { enabled: true },
            folding: true,
            bracketMatching: 'always',
            wordWrap: 'on'
        });

        // Keep welcome screen visible until a file is opened
        // welcomeScreen.style.display = 'none';

        monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function() {
            saveCurrentFile();
        });

        monacoEditor.onDidChangeModelContent(function() {
            markCurrentTabAsModified();
        });
        
        // Setup preview auto-refresh
        setupPreviewAutoRefresh();
    });
}

// Terminal initialization
function initializeTerminal() {
    console.log('[TERMINAL] Initializing terminal system...');
    
    // Check if xterm is loaded
    if (typeof window.Terminal === 'undefined' && !window.xtermLoaded) {
        console.log('[TERMINAL] Waiting for xterm.js to load...');
        
        // Listen for xterm loaded event
        window.addEventListener('xterm-loaded', () => {
            console.log('[TERMINAL] xterm-loaded event received');
            initializeTerminalSystem();
        });
        
        // Also try periodic check as backup
        let retryCount = 0;
        const checkXterm = setInterval(() => {
            retryCount++;
            if (typeof window.Terminal !== 'undefined' || window.xtermLoaded) {
                clearInterval(checkXterm);
                console.log('[TERMINAL] xterm.js loaded successfully (via check)');
                initializeTerminalSystem();
            } else if (retryCount > 20) {
                clearInterval(checkXterm);
                console.error('[TERMINAL] Failed to load xterm.js after 20 attempts');
                showNotification('TERMINAL LIBRARY LOAD FAILED - CHECK CONSOLE', 'error');
                
                // Show detailed error
                const errorMsg = document.createElement('div');
                errorMsg.style.cssText = 'position: fixed; bottom: 20px; right: 20px; background: #ff0040; color: white; padding: 15px; z-index: 10000; max-width: 400px;';
                errorMsg.innerHTML = '<h4>Terminal Error</h4><p>xterm.js failed to load. Try:</p><ul><li>Refresh page (Ctrl+F5)</li><li>Check browser console (F12)</li><li>Try different browser</li></ul>';
                document.body.appendChild(errorMsg);
            }
        }, 500);
        return;
    }
    
    console.log('[TERMINAL] xterm.js already loaded, initializing...');
    initializeTerminalSystem();
}

function initializeTerminalSystem() {
    // Check for FitAddon
    if (typeof FitAddon === 'undefined' && window.FitAddon) {
        window.FitAddon = window.FitAddon;
    }
    
    // Initialize with first terminal
    createNewTerminal();
    
    // Setup event listeners
    setupTerminalEventListeners();
    
    console.log('[TERMINAL] Terminal system initialized successfully');
}

function createNewTerminal() {
    terminalCounter++;
    const terminalId = `terminal-${terminalCounter}`;
    
    console.log(`[TERMINAL] Creating new terminal: ${terminalId}`);
    console.log('[TERMINAL] Terminal constructor available:', typeof window.Terminal !== 'undefined');
    console.log('[TERMINAL] FitAddon available:', typeof window.FitAddon !== 'undefined');
    
    // Ultra-optimized terminal configuration
    const terminalConfig = {
        cursorBlink: true,
        cursorStyle: 'underline',
        fontSize: 13,
        fontFamily: 'Fira Code, Consolas, Monaco, "Courier New", monospace',
        fontWeight: 'normal',
        fontWeightBold: 'bold',
        lineHeight: 1.1,
        letterSpacing: 0,
        scrollback: 5000, // Reduced from 10000 for better performance
        tabStopWidth: 4,
        bellStyle: 'visual',
        macOptionIsMeta: true,
        rightClickSelectsWord: true,
        disableStdin: false,
        allowTransparency: false,
        // Performance optimizations
        fastScrollModifier: 'shift', // Fast scroll with shift
        fastScrollSensitivity: 5,
        scrollSensitivity: 1,
        rendererType: 'canvas', // Canvas is faster than DOM
        drawBoldTextInBrightColors: true,
        // Disable features that impact performance
        windowsMode: false,
        convertEol: true,
        termName: 'xterm-256color',
        screenReaderMode: false,
        // Buffer optimizations
        cols: 80,
        rows: 24,
        // Theme optimized for performance
        theme: {
            background: '#000000',
            foreground: '#00ff41',
            cursor: '#39ff14',
            cursorAccent: '#39ff14',
            selection: 'rgba(0, 255, 65, 0.3)',
            black: '#000000',
            red: '#ff0040',
            green: '#00ff41',
            yellow: '#ffff00',
            blue: '#0080ff',
            magenta: '#ff00ff',
            cyan: '#00ffff',
            white: '#00ff41',
            brightBlack: '#808080',
            brightRed: '#ff4040',
            brightGreen: '#40ff40',
            brightYellow: '#ffff40',
            brightBlue: '#4080ff',
            brightMagenta: '#ff40ff',
            brightCyan: '#40ffff',
            brightWhite: '#00ff41'
        }
    };
    
    let terminal;
    try {
        terminal = new window.Terminal(terminalConfig);
    } catch (error) {
        console.error('[TERMINAL] Error creating terminal:', error);
        showNotification('TERMINAL CREATION ERROR', 'error');
        return null;
    }

    // Create terminal instance container
    const terminalContent = document.getElementById('terminal-content');
    if (!terminalContent) {
        console.error('[TERMINAL] Terminal content container not found');
        return null;
    }
    
    const terminalInstance = document.createElement('div');
    terminalInstance.className = 'terminal-instance';
    terminalInstance.id = terminalId;
    terminalInstance.style.width = '100%';
    terminalInstance.style.height = '100%';
    
    // Create terminal container with status bar
    const terminalContainer = document.createElement('div');
    terminalContainer.className = 'terminal-xterm-container';
    terminalContainer.style.width = '100%';
    terminalContainer.style.flex = '1';
    terminalContainer.style.overflow = 'hidden';
    terminalContainer.style.position = 'relative';
    terminalContainer.style.backgroundColor = '#000';
    
    // Create status bar
    const statusBar = document.createElement('div');
    statusBar.className = 'terminal-status-bar';
    statusBar.innerHTML = `
        <div class="status-left">
            <div class="status-item">
                <i class="fas fa-terminal"></i>
                <span class="terminal-type">bash</span>
            </div>
            <div class="status-item">
                <i class="fas fa-server"></i>
                <span class="terminal-host">localhost</span>
            </div>
            <div class="status-item">
                <i class="fas fa-folder"></i>
                <span class="terminal-cwd">~/workspace</span>
            </div>
        </div>
        <div class="status-right">
            <div class="status-item">
                <span class="terminal-size">80x24</span>
            </div>
            <div class="encoding">UTF-8</div>
        </div>
    `;
    
    terminalInstance.appendChild(terminalContainer);
    terminalInstance.appendChild(statusBar);
    terminalContent.appendChild(terminalInstance);
    
    try {
        terminal.open(terminalContainer);
        console.log(`[TERMINAL] Terminal ${terminalId} opened successfully`);
    } catch (error) {
        console.error('[TERMINAL] Error opening terminal:', error);
        terminalInstance.remove();
        return null;
    }
    
    // Add click handler for focus
    terminalContainer.addEventListener('click', () => {
        terminal.focus();
        console.log(`[TERMINAL] Terminal ${terminalId} focused on click`);
    });
    
    // Add focus handler
    terminalContainer.addEventListener('mouseenter', () => {
        if (activeTerminalId === terminalId) {
            terminal.focus();
        }
    });
    
    // Simple fit function that always works
    const fitTerminal = () => {
        if (terminalContainer.offsetWidth > 0 && terminalContainer.offsetHeight > 0) {
            try {
                const padding = 20; // Increased padding
                const containerWidth = terminalContainer.clientWidth - (padding * 2);
                const containerHeight = terminalContainer.clientHeight - (padding * 2) - 24; // Subtract status bar
                
                // Better character dimension estimation
                const cellWidth = 8.5;
                const cellHeight = 16;
                
                const cols = Math.max(80, Math.floor(containerWidth / cellWidth));
                const rows = Math.max(10, Math.floor(containerHeight / cellHeight));
                
                // Ensure reasonable terminal size
                const finalCols = Math.min(cols, 200);
                const finalRows = Math.min(rows, 50);
                
                if (terminal.cols !== finalCols || terminal.rows !== finalRows) {
                    terminal.resize(finalCols, finalRows);
                    console.log(`[TERMINAL] Resized to ${finalCols}x${finalRows}`);
                    
                    const sizeDisplay = statusBar.querySelector('.terminal-size');
                    if (sizeDisplay) {
                        sizeDisplay.textContent = `${finalCols}x${finalRows}`;
                    }
                }
            } catch (e) {
                console.warn('[TERMINAL] Fit error:', e);
            }
        }
    };
    
    // Fit terminal after a short delay
    setTimeout(() => {
        fitTerminal();
        // Force a refresh
        terminal.refresh(0, terminal.rows - 1);
    }, 300);
    
    // Add resize observer for automatic fitting
    const resizeObserver = new ResizeObserver(() => {
        if (terminalContainer.offsetWidth > 0 && terminalContainer.offsetHeight > 0) {
            setTimeout(fitTerminal, 100);
        }
    });
    resizeObserver.observe(terminalContainer);
    
    // Also observe the terminal instance container
    resizeObserver.observe(terminalInstance);
    
    // Store references
    terminal.fitFunction = fitTerminal;
    
    // Store terminal data
    terminals[terminalId] = {
        terminal: terminal,
        sessionId: generateSessionId(),
        name: `bash-${terminalCounter}`,
        socketId: null,
        fitFunction: fitTerminal,
        resizeObserver: resizeObserver,
        element: terminalInstance,
        commandHistory: [],
        historyIndex: 0
    };
    
    // Set as active terminal
    setActiveTerminal(terminalId);
    
    // Focus the terminal immediately
    terminal.focus();
    
    // Modern terminal event handlers
    terminal.onData(data => {
        console.log(`[TERMINAL] Data from terminal ${terminalId}:`, data);
        if (socket && socket.connected && terminals[terminalId] && terminals[terminalId].socketId) {
            console.log(`[TERMINAL] Sending data to socket ${terminals[terminalId].socketId}`);
            socket.emit('terminal:data', { 
                data, 
                terminalId: terminals[terminalId].socketId 
            });
            
            // Force refresh to ensure typed text is visible
            setTimeout(() => {
                terminal.refresh(terminal.buffer.active.cursorY, terminal.buffer.active.cursorY);
            }, 10);
        } else {
            console.warn('[TERMINAL] Cannot send data - no socket connection or session ID');
            console.log('Socket connected:', socket?.connected);
            console.log('Terminal socketId:', terminals[terminalId]?.socketId);
        }
    });

    terminal.onResize(({ cols, rows }) => {
        if (socket && socket.connected && terminals[terminalId] && terminals[terminalId].socketId) {
            socket.emit('terminal:resize', { 
                cols, 
                rows, 
                terminalId: terminals[terminalId].socketId 
            });
        }
    });
    
    // Add keyboard shortcuts
    terminal.attachCustomKeyEventHandler((event) => {
        // Ctrl+Shift+C for copy
        if (event.ctrlKey && event.shiftKey && event.key === 'C') {
            const selection = terminal.getSelection();
            if (selection) {
                navigator.clipboard.writeText(selection);
                showNotification('TEXT COPIED TO CLIPBOARD', 'success');
            }
            return false;
        }
        // Ctrl+Shift+V for paste
        if (event.ctrlKey && event.shiftKey && event.key === 'V') {
            navigator.clipboard.readText().then(text => {
                if (text && terminals[terminalId] && terminals[terminalId].socketId) {
                    socket.emit('terminal:data', { 
                        data: text, 
                        terminalId: terminals[terminalId].socketId 
                    });
                }
            });
            return false;
        }
        return true;
    });
    
    // Create terminal session after setup
    setTimeout(() => {
        createTerminalSession(terminalId);
        
        // Force refresh after session creation to ensure colors are correct
        setTimeout(() => {
            if (terminals[terminalId] && terminals[terminalId].terminal) {
                terminals[terminalId].terminal.refresh(0, terminals[terminalId].terminal.rows - 1);
            }
        }, 500);
    }, 300);
    
    // Add modern terminal features
    terminal.options.convertEol = true;
    terminal.options.scrollOnUserInput = true;
    terminal.options.screenReaderMode = false;
    terminal.options.minimumContrastRatio = 1; // Disable contrast checking
    
    // Add custom key bindings
    terminal.attachCustomKeyEventHandler((event) => {
        // Ctrl+L to clear
        if (event.ctrlKey && event.key === 'l') {
            clearActiveTerminal();
            return false;
        }
        return true;
    });
    
    // Add welcome message with ASCII art
    const welcomeMessage = [
        '\x1b[32m╔═══════════════════════════════════════════════════════════════╗\x1b[0m',
        '\x1b[32m║\x1b[0m                  \x1b[1;32mH4CK3R T3RM1N4L ACCESS\x1b[0m                    \x1b[32m║\x1b[0m',
        '\x1b[32m║\x1b[0m                                                               \x1b[32m║\x1b[0m',
        '\x1b[32m║\x1b[0m  \x1b[1;36m    ██╗  ██╗ █████╗  ██████╗██╗  ██╗███████╗██████╗\x1b[0m      \x1b[32m║\x1b[0m',
        '\x1b[32m║\x1b[0m  \x1b[1;36m    ██║  ██║██╔══██╗██╔════╝██║ ██╔╝██╔════╝██╔══██╗\x1b[0m     \x1b[32m║\x1b[0m',
        '\x1b[32m║\x1b[0m  \x1b[1;36m    ███████║███████║██║     █████╔╝ █████╗  ██████╔╝\x1b[0m      \x1b[32m║\x1b[0m',
        '\x1b[32m║\x1b[0m  \x1b[1;36m    ██╔══██║██╔══██║██║     ██╔═██╗ ██╔══╝  ██╔══██╗\x1b[0m     \x1b[32m║\x1b[0m',
        '\x1b[32m║\x1b[0m  \x1b[1;36m    ██║  ██║██║  ██║╚██████╗██║  ██╗███████╗██║  ██║\x1b[0m     \x1b[32m║\x1b[0m',
        '\x1b[32m║\x1b[0m  \x1b[1;36m    ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝\x1b[0m     \x1b[32m║\x1b[0m',
        '\x1b[32m║\x1b[0m                                                               \x1b[32m║\x1b[0m',
        `\x1b[32m║\x1b[0m     \x1b[33mTerminal ${terminalCounter} | Session: ${terminals[terminalId].sessionId}\x1b[0m         \x1b[32m║\x1b[0m`,
        '\x1b[32m║\x1b[0m     \x1b[90mType \'help\' for commands | Ctrl+Shift+C/V to copy/paste\x1b[0m \x1b[32m║\x1b[0m',
        '\x1b[32m╚═══════════════════════════════════════════════════════════════╝\x1b[0m',
        ''
    ];
    
    welcomeMessage.forEach(line => terminal.writeln(line));
    
    // Force a prompt to appear
    terminal.writeln('\x1b[32m[SYSTEM]\x1b[0m Waiting for shell initialization...');
    
    // Update UI
    renderTerminalTabs();
    updateTerminalCount();
    
    showNotification(`NEW TERMINAL ${terminals[terminalId].name.toUpperCase()} CREATED`, 'success');
    
    return terminalId;
}

function createTerminalSession(terminalId) {
    if (!terminals[terminalId]) {
        console.error(`[TERMINAL] Terminal ${terminalId} not found`);
        return;
    }
    
    if (socket && socket.connected) {
        console.log(`[TERMINAL] Creating session for terminal ${terminalId}`);
        
        const terminal = terminals[terminalId].terminal;
        const cols = terminal.cols || 80;
        const rows = terminal.rows || 24;
        
        socket.emit('terminal:create', {
            cols: cols,
            rows: rows,
            terminalId: terminalId
        });
    } else {
        console.warn('[TERMINAL] Socket not connected, waiting for connection...');
        showNotification('WAITING FOR SERVER CONNECTION...', 'warning');
    }
}

function setActiveTerminal(terminalId) {
    // Hide all terminals
    Object.keys(terminals).forEach(id => {
        const instance = document.getElementById(id);
        if (instance) {
            instance.classList.remove('active');
        }
    });
    
    // Show active terminal
    activeTerminalId = terminalId;
    const activeInstance = document.getElementById(terminalId);
    if (activeInstance) {
        activeInstance.classList.add('active');
        
        // Fit terminal to container
        if (terminals[terminalId].fitFunction) {
            setTimeout(() => {
                terminals[terminalId].fitFunction();
                // Focus the terminal after fitting
                if (terminals[terminalId] && terminals[terminalId].terminal) {
                    terminals[terminalId].terminal.focus();
                    console.log(`[TERMINAL] Terminal ${terminalId} focused after switching`);
                }
            }, 100);
        }
    }
    
    renderTerminalTabs();
}

function closeTerminal(terminalId) {
    if (Object.keys(terminals).length <= 1) {
        showNotification('CANNOT CLOSE LAST TERMINAL', 'warning');
        return;
    }
    
    const terminal = terminals[terminalId];
    if (terminal) {
        console.log(`[TERMINAL] Closing terminal ${terminalId}`);
        
        // Stop resize observer
        if (terminal.resizeObserver) {
            terminal.resizeObserver.disconnect();
        }
        
        // Destroy terminal
        try {
            terminal.terminal.dispose();
        } catch (e) {
            console.warn('[TERMINAL] Error disposing terminal:', e);
        }
        
        // Remove from DOM
        const instance = document.getElementById(terminalId);
        if (instance) {
            instance.remove();
        }
        
        // Emit close to server
        if (socket && socket.connected && terminal.socketId) {
            socket.emit('terminal:close', { terminalId: terminal.socketId });
        }
        
        // Remove from terminals object
        delete terminals[terminalId];
        
        // Set new active terminal if needed
        if (activeTerminalId === terminalId) {
            const remainingTerminals = Object.keys(terminals);
            if (remainingTerminals.length > 0) {
                setActiveTerminal(remainingTerminals[0]);
            }
        }
        
        renderTerminalTabs();
        updateTerminalCount();
        
        showNotification(`TERMINAL ${terminal.name.toUpperCase()} CLOSED`, 'warning');
    }
}

function renderTerminalTabs() {
    const tabsContainer = document.getElementById('terminal-tabs-container');
    tabsContainer.innerHTML = '';
    
    Object.keys(terminals).forEach(terminalId => {
        const terminal = terminals[terminalId];
        const tabElement = document.createElement('div');
        tabElement.className = 'terminal-tab';
        if (terminalId === activeTerminalId) {
            tabElement.classList.add('active');
        }
        
        tabElement.innerHTML = `
            <i class="fas fa-terminal"></i>
            <span class="terminal-name">${terminal.name}</span>
            <button class="tab-close">×</button>
        `;
        
        // Tab click to switch
        tabElement.addEventListener('click', (e) => {
            if (!e.target.classList.contains('tab-close')) {
                setActiveTerminal(terminalId);
            }
        });
        
        // Close button click
        const closeBtn = tabElement.querySelector('.tab-close');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTerminal(terminalId);
        });
        
        tabsContainer.appendChild(tabElement);
    });
}

function updateTerminalCount() {
    const activeCount = Object.keys(terminals).length;
    document.getElementById('active-terminal-count').textContent = activeCount;
}

function setupTerminalEventListeners() {
    // New terminal button
    const newTerminalBtn = document.getElementById('new-terminal-btn');
    if (newTerminalBtn) {
        newTerminalBtn.addEventListener('click', createNewTerminal);
    }
    
    // Toggle terminal footer
    const toggleBtn = document.getElementById('toggle-terminal-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleTerminalFooter();
        });
    }
    
    // Clear terminal button
    const clearBtn = document.getElementById('clear-terminal-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearActiveTerminal();
        });
    }
    
    // Terminal footer header click to minimize/maximize (excluding buttons)
    const footerHeader = document.querySelector('.terminal-footer-header');
    if (footerHeader) {
        footerHeader.addEventListener('click', (e) => {
            // Only toggle if clicking on header itself, not buttons
            if (e.target.closest('.terminal-controls')) {
                return;
            }
            toggleTerminalFooter();
        });
    }
}

function toggleTerminalFooter() {
    const footer = document.getElementById('terminal-footer');
    const toggleBtn = document.getElementById('toggle-terminal-btn');
    const toggleIcon = toggleBtn.querySelector('i');
    
    if (footer.classList.contains('minimized')) {
        footer.classList.remove('minimized');
        toggleIcon.className = 'fas fa-chevron-down';
        showNotification('TERMINAL EXPANDED', 'info');
    } else {
        footer.classList.add('minimized');
        toggleIcon.className = 'fas fa-chevron-up';
        showNotification('TERMINAL MINIMIZED', 'info');
    }
}

function clearActiveTerminal() {
    if (activeTerminalId && terminals[activeTerminalId]) {
        const terminal = terminals[activeTerminalId].terminal;
        terminal.clear();
        // Add header after clear
        terminal.writeln('\x1b[32m╔═══════════════════════════════════════════════════════════════╗\x1b[0m');
        terminal.writeln('\x1b[32m║\x1b[0m                  \x1b[1;32mH4CK3R T3RM1N4L ACCESS\x1b[0m                    \x1b[32m║\x1b[0m');
        terminal.writeln('\x1b[32m║\x1b[0m                     \x1b[33mTERMINAL CLEARED\x1b[0m                       \x1b[32m║\x1b[0m');
        terminal.writeln('\x1b[32m╚═══════════════════════════════════════════════════════════════╝\x1b[0m');
        terminal.writeln('');
        
        // Send a newline to trigger bash prompt
        if (socket && socket.connected && terminals[activeTerminalId].socketId) {
            socket.emit('terminal:data', { 
                data: '\n', 
                terminalId: terminals[activeTerminalId].socketId 
            });
        }
        
        showNotification('TERMINAL CLEARED', 'info');
    }
}

// UI initialization
function initializeUI() {
    document.getElementById('new-file-btn').addEventListener('click', createNewFile);
    document.getElementById('new-folder-btn').addEventListener('click', createNewFolder);
    document.getElementById('upload-btn').addEventListener('click', () => {
        document.getElementById('upload-input').click();
    });
    document.getElementById('save-btn').addEventListener('click', saveCurrentFile);
    document.getElementById('refresh-btn').addEventListener('click', () => loadFileTree());
    document.getElementById('upload-input').addEventListener('change', handleFileUpload);
    document.getElementById('modal-confirm-btn').addEventListener('click', handleModalConfirm);
    document.getElementById('modal-cancel-btn').addEventListener('click', hideModal);
    document.addEventListener('click', hideContextMenu);
    document.addEventListener('contextmenu', handleRightClick);
    document.addEventListener('keydown', handleKeyboardShortcuts);
    // Remove default drag/drop prevention - we'll handle it properly
    // document.addEventListener('dragover', e => e.preventDefault());
    // document.addEventListener('drop', e => e.preventDefault());
    
    // Initialize external file drop zone
    initializeExternalDropZone();
}

// File tree operations
async function loadFileTree(path = 'workspace') {
    try {
        const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
        const files = await response.json();
        
        if (response.ok) {
            fileTree = files;
            renderFileTree(files);
        } else {
            showNotification('Error loading files: ' + files.error, 'error');
        }
    } catch (error) {
        showNotification('Error loading files: ' + error.message, 'error');
    }
}

function renderFileTree(files) {
    const fileTreeElement = document.getElementById('file-tree');
    fileTreeElement.innerHTML = '';
    
    files.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
    });
    
    files.forEach(file => {
        const fileItem = createFileItem(file);
        fileTreeElement.appendChild(fileItem);
    });
}

function createFileItem(file) {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.dataset.path = file.path;
    item.dataset.isDirectory = file.isDirectory;
    
    if (file.isDirectory) {
        item.classList.add('directory');
    }
    
    const icon = document.createElement('i');
    icon.className = file.isDirectory ? 'fas fa-folder' : getFileIcon(file.name);
    
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = file.name;
    
    const size = document.createElement('span');
    size.className = 'file-size';
    if (!file.isDirectory) {
        size.textContent = formatFileSize(file.size);
    }
    
    item.appendChild(icon);
    item.appendChild(name);
    item.appendChild(size);
    
    // Add event listeners
    item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        
        const isMultiSelectKey = event.ctrlKey || event.metaKey;
        console.log('[DEBUG] File clicked:', file.name, 'Ctrl:', event.ctrlKey, 'Cmd:', event.metaKey, 'Shift:', event.shiftKey);
        
        toggleFileSelection(file.path, event);
        if (!isMultiSelectKey && !event.shiftKey) {
            handleFileClick(file);
        }
    });
    
    item.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleFileDoubleClick(file);
    });
    
    // Initialize drag and drop
    initializeDragDrop(item, file);
    
    return item;
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const iconMap = {
        js: 'fab fa-js-square',
        html: 'fab fa-html5',
        css: 'fab fa-css3-alt',
        json: 'fas fa-code',
        md: 'fab fa-markdown',
        txt: 'fas fa-file-alt',
        py: 'fab fa-python',
        java: 'fab fa-java',
        cpp: 'fas fa-code',
        c: 'fas fa-code',
        php: 'fab fa-php',
        rb: 'fas fa-gem'
    };
    
    return iconMap[ext] || 'fas fa-file';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// File operations
async function handleFileClick(file) {
    // Hide welcome screen when clicking on any file
    hideWelcomeScreen();
    
    document.querySelectorAll('.file-item.selected').forEach(item => {
        item.classList.remove('selected');
    });
    
    const fileItem = document.querySelector(`[data-path="${file.path}"]`);
    if (fileItem) {
        fileItem.classList.add('selected');
    }
}

async function handleFileDoubleClick(file) {
    if (file.isDirectory) {
        await loadFileTree(file.path);
    } else {
        await openFileInEditor(file.path);
    }
}

async function openFileInEditor(filePath) {
    try {
        const response = await fetch(`/api/file/read?path=${encodeURIComponent(filePath)}`);
        const fileData = await response.json();
        
        if (response.ok) {
            // Hide welcome screen when opening a file
            hideWelcomeScreen();
            
            const existingTabIndex = openTabs.findIndex(tab => tab.path === filePath);
            
            if (existingTabIndex !== -1) {
                switchToTab(existingTabIndex);
                return;
            }
            
            const tab = {
                path: filePath,
                filename: fileData.filename,
                content: fileData.content,
                modified: false,
                language: detectLanguage(fileData.filename)
            };
            
            openTabs.push(tab);
            activeTabIndex = openTabs.length - 1;
            currentFile = filePath;
            
            monacoEditor.setValue(fileData.content);
            monaco.editor.setModelLanguage(monacoEditor.getModel(), tab.language);
            
            renderTabs();
            showNotification(`Opened ${fileData.filename}`, 'success');
            
            // Check if HTML file and show preview options
            if (fileData.filename.toLowerCase().endsWith('.html')) {
                showPreviewButtons();
            } else {
                hidePreviewButtons();
            }
            
        } else {
            showNotification('Error opening file: ' + fileData.error, 'error');
        }
    } catch (error) {
        showNotification('Error opening file: ' + error.message, 'error');
    }
}

function detectLanguage(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const languageMap = {
        js: 'javascript',
        ts: 'typescript',
        html: 'html',
        css: 'css',
        json: 'json',
        xml: 'xml',
        yaml: 'yaml',
        yml: 'yaml',
        md: 'markdown',
        py: 'python',
        java: 'java',
        cpp: 'cpp',
        c: 'c',
        php: 'php',
        rb: 'ruby',
        go: 'go',
        rs: 'rust',
        sh: 'shell'
    };
    
    return languageMap[ext] || 'plaintext';
}

// Basic implementations for required functions
function renderTabs() {
    const tabsContainer = document.getElementById('editor-tabs');
    tabsContainer.innerHTML = '';
    
    openTabs.forEach((tab, index) => {
        const tabElement = document.createElement('div');
        tabElement.className = 'editor-tab';
        if (index === activeTabIndex) {
            tabElement.classList.add('active');
        }
        
        const filename = document.createElement('span');
        filename.textContent = tab.filename + (tab.modified ? ' •' : '');
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'close-btn';
        closeBtn.innerHTML = '×';
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            closeTab(index);
        };
        
        tabElement.appendChild(filename);
        tabElement.appendChild(closeBtn);
        
        tabElement.onclick = () => switchToTab(index);
        
        tabsContainer.appendChild(tabElement);
    });
}

function switchToTab(index) {
    if (index < 0 || index >= openTabs.length) {
        // If no valid tab, clear the editor
        if (monacoEditor) {
            monacoEditor.setValue('');
            monacoEditor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
        }
        return;
    }
    
    // Hide welcome screen when switching to a tab
    hideWelcomeScreen();
    
    if (activeTabIndex !== -1 && openTabs[activeTabIndex]) {
        openTabs[activeTabIndex].content = monacoEditor.getValue();
    }
    
    activeTabIndex = index;
    const tab = openTabs[index];
    currentFile = tab.path;
    
    monacoEditor.setValue(tab.content);
    monaco.editor.setModelLanguage(monacoEditor.getModel(), tab.language);
    
    renderTabs();
    
    // Check if HTML file and show/hide preview buttons
    if (tab.filename.toLowerCase().endsWith('.html')) {
        showPreviewButtons();
    } else {
        hidePreviewButtons();
        // If preview is open and we switch to non-HTML file, close preview
        if (isPreviewMode) {
            closePreview();
        }
    }
}

function closeTab(index) {
    const tab = openTabs[index];
    
    if (tab.modified) {
        if (!confirm(`${tab.filename} has unsaved changes. Close anyway?`)) {
            return;
        }
    }
    
    // If closing the current preview file, close preview
    if (isPreviewMode && currentPreviewFile === tab.path) {
        closePreview();
    }
    
    openTabs.splice(index, 1);
    
    if (activeTabIndex === index) {
        if (openTabs.length === 0) {
            activeTabIndex = -1;
            currentFile = null;
            // Clear the editor when all tabs are closed
            if (monacoEditor) {
                monacoEditor.setValue(''); // Clear editor content
                monacoEditor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
            }
            // DO NOT show welcome screen when closing tabs
            // We want it hidden by default
            // showWelcomeScreen();
        } else if (activeTabIndex >= openTabs.length) {
            activeTabIndex = openTabs.length - 1;
            switchToTab(activeTabIndex);
        } else {
            switchToTab(activeTabIndex);
        }
    } else if (activeTabIndex > index) {
        activeTabIndex--;
    }
    
    renderTabs();
    
    // Extra check: If no tabs left, ensure editor is cleared
    if (openTabs.length === 0 && monacoEditor) {
        monacoEditor.setValue('');
        monacoEditor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
    }
}

function showWelcomeScreen() {
    const editorContainer = document.getElementById('editor');
    const welcomeScreen = editorContainer.querySelector('.welcome-screen');
    if (welcomeScreen) {
        welcomeScreen.classList.add('show');
        welcomeScreen.style.display = 'flex';
        // Restart typing animation
        if (window.startTypingAnimation) {
            window.startTypingAnimation();
        }
    }
    if (monacoEditor) {
        monacoEditor.setValue('');
    }
}

function hideWelcomeScreen() {
    const editorContainer = document.getElementById('editor');
    const welcomeScreen = editorContainer.querySelector('.welcome-screen');
    if (welcomeScreen) {
        welcomeScreen.classList.remove('show');
        welcomeScreen.style.display = 'none';
    }
}

function markCurrentTabAsModified() {
    if (activeTabIndex !== -1 && openTabs[activeTabIndex]) {
        openTabs[activeTabIndex].modified = true;
        renderTabs();
    }
}

async function saveCurrentFile() {
    if (!currentFile || activeTabIndex === -1) {
        showNotification('No file to save', 'warning');
        return;
    }
    
    try {
        const content = monacoEditor.getValue();
        const response = await fetch('/api/file/write', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: currentFile,
                content: content
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            if (openTabs[activeTabIndex]) {
                openTabs[activeTabIndex].modified = false;
                openTabs[activeTabIndex].content = content;
            }
            renderTabs();
            showNotification('File saved successfully', 'success');
        } else {
            showNotification('Error saving file: ' + result.error, 'error');
        }
    } catch (error) {
        showNotification('Error saving file: ' + error.message, 'error');
    }
}

async function createNewFile() {
    hideWelcomeScreen(); // Make sure welcome is hidden
    showModal('Create New File', 'Enter filename:', (filename) => {
        if (filename) {
            createFile(filename);
        }
    });
}

async function createNewFolder() {
    hideWelcomeScreen(); // Make sure welcome is hidden
    showModal('Create New Folder', 'Enter folder name:', (foldername) => {
        if (foldername) {
            createDirectory(foldername);
        }
    });
}

async function createFile(filename) {
    try {
        const workspacePath = 'workspace';
        const filePath = `${workspacePath}/${filename}`;
        
        const response = await fetch('/api/file/write', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: filePath,
                content: ''
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            await loadFileTree();
            await openFileInEditor(filePath);
            showNotification('File created successfully', 'success');
        } else {
            showNotification('Error creating file: ' + result.error, 'error');
        }
    } catch (error) {
        showNotification('Error creating file: ' + error.message, 'error');
    }
}

async function createDirectory(dirname) {
    try {
        const workspacePath = 'workspace';
        const dirPath = `${workspacePath}/${dirname}`;
        
        const response = await fetch('/api/directory/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: dirPath
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            await loadFileTree();
            showNotification('Folder created successfully', 'success');
        } else {
            showNotification('Error creating folder: ' + result.error, 'error');
        }
    } catch (error) {
        showNotification('Error creating folder: ' + error.message, 'error');
    }
}

async function handleFileUpload(event) {
    const files = event.target.files;
    if (!files.length) return;
    
    // Hide welcome screen when uploading files
    hideWelcomeScreen();
    
    for (const file of files) {
        await uploadFile(file);
    }
    
    event.target.value = '';
    await loadFileTree();
}

async function uploadFile(file) {
    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', 'workspace');
        
        const response = await fetch('/api/file/upload', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showNotification(`Uploaded ${file.name}`, 'success');
        } else {
            showNotification(`Error uploading ${file.name}: ${result.error}`, 'error');
        }
    } catch (error) {
        showNotification(`Error uploading ${file.name}: ${error.message}`, 'error');
    }
}

function toggleTerminal() {
    toggleTerminalFooter();
}

function showTerminal() {
    hideWelcomeScreen(); // Make sure welcome is hidden
    const footer = document.getElementById('terminal-footer');
    footer.classList.remove('hidden');
    footer.classList.remove('minimized');
    
    if (activeTerminalId && terminals[activeTerminalId]) {
        terminals[activeTerminalId].terminal.focus();
    }
}

function hideTerminal() {
    const footer = document.getElementById('terminal-footer');
    footer.classList.add('minimized');
}

function clearTerminal() {
    clearActiveTerminal();
}

function handleRightClick(event) {
    const fileItem = event.target.closest('.file-item');
    const fileTree = event.target.closest('.file-tree');
    
    if (fileItem) {
        // Right-click on file/folder
        event.preventDefault();
        contextMenuTarget = fileItem;
        showContextMenu(event.clientX, event.clientY, 'file');
    } else if (fileTree) {
        // Right-click on empty space in file explorer
        event.preventDefault();
        contextMenuTarget = null;
        showContextMenu(event.clientX, event.clientY, 'empty');
    }
}

function showContextMenu(x, y, type = 'file') {
    const contextMenu = document.getElementById('context-menu');
    
    // Update context menu content based on type
    updateContextMenuContent(type);
    
    contextMenu.style.display = 'block';
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    
    // Add event listeners for context menu items
    contextMenu.querySelectorAll('.context-item').forEach(item => {
        item.onclick = () => handleContextMenuAction(item.dataset.action, type);
    });
}

function updateContextMenuContent(type) {
    const contextMenu = document.getElementById('context-menu');
    const contextHeader = contextMenu.querySelector('.context-header span');
    
    if (type === 'empty') {
        contextHeader.textContent = 'CREATE';
        let menuContent = `
            <div class="context-header">
                <span>CREATE</span>
            </div>
            <div class="context-item" data-action="new-file">
                <i class="fas fa-file-plus"></i> NEW FILE
            </div>
            <div class="context-item" data-action="new-folder">
                <i class="fas fa-folder-plus"></i> NEW FOLDER
            </div>
            <div class="context-separator"></div>
            <div class="context-item" data-action="upload">
                <i class="fas fa-upload"></i> UPLOAD FILES
            </div>
            <div class="context-item" data-action="refresh">
                <i class="fas fa-sync"></i> REFRESH
            </div>
        `;
        
        if (selectedFiles.size > 0) {
            menuContent += `
                <div class="context-separator"></div>
                <div class="context-item" data-action="zip">
                    <i class="fas fa-file-archive"></i> CREATE ZIP (${selectedFiles.size})
                </div>
                <div class="context-item" data-action="clear-selection">
                    <i class="fas fa-times"></i> CLEAR SELECTION
                </div>
            `;
        }
        
        contextMenu.innerHTML = menuContent;
    } else {
        const targetFile = contextMenuTarget;
        const filePath = targetFile ? targetFile.dataset.path : '';
        const isZipFile = filePath.toLowerCase().endsWith('.zip');
        const selectedCount = selectedFiles.size;
        
        contextHeader.textContent = selectedCount > 1 ? `${selectedCount} ITEMS` : 'ACTIONS';
        
        let menuContent = `
            <div class="context-header">
                <span>${selectedCount > 1 ? selectedCount + ' ITEMS' : 'ACTIONS'}</span>
            </div>
        `;
        
        if (selectedCount <= 1) {
            menuContent += `
                <div class="context-item" data-action="open">
                    <i class="fas fa-folder-open"></i> EXECUTE
                </div>
                <div class="context-item" data-action="rename">
                    <i class="fas fa-edit"></i> RENAME
                </div>
            `;
        }
        
        menuContent += `
            <div class="context-item" data-action="copy">
                <i class="fas fa-copy"></i> DUPLICATE
            </div>
            <div class="context-item" data-action="delete">
                <i class="fas fa-trash"></i> DELETE
            </div>
        `;
        
        if (selectedCount > 0) {
            menuContent += `
                <div class="context-separator"></div>
                <div class="context-item" data-action="zip">
                    <i class="fas fa-file-archive"></i> CREATE ZIP
                </div>
            `;
        }
        
        if (isZipFile && selectedCount === 1) {
            menuContent += `
                <div class="context-item" data-action="unzip">
                    <i class="fas fa-file-archive"></i> EXTRACT HERE
                </div>
            `;
        }
        
        if (selectedCount <= 1) {
            menuContent += `
                <div class="context-separator"></div>
                <div class="context-item" data-action="download">
                    <i class="fas fa-download"></i> DOWNLOAD
                </div>
                <div class="context-item" data-action="properties">
                    <i class="fas fa-info-circle"></i> PROPERTIES
                </div>
            `;
        }
        
        contextMenu.innerHTML = menuContent;
    }
}

function hideContextMenu() {
    const contextMenu = document.getElementById('context-menu');
    contextMenu.style.display = 'none';
    contextMenuTarget = null;
}

async function handleContextMenuAction(action, type) {
    if (type === 'empty') {
        // Actions for empty space in file explorer
        switch (action) {
            case 'new-file':
                createNewFile();
                break;
            case 'new-folder':
                createNewFolder();
                break;
            case 'upload':
                document.getElementById('upload-input').click();
                break;
            case 'paste':
                showNotification('PASTE FUNCTIONALITY COMING SOON', 'info');
                break;
            case 'refresh':
                showLoadingOverlay('REFRESHING FILE SYSTEM');
                setTimeout(() => {
                    loadFileTree();
                    hideLoadingOverlay();
                }, 800);
                break;
        }
    } else {
        // Actions for files/folders
        if (!contextMenuTarget) return;
        
        const filePath = contextMenuTarget.dataset.path;
        const isDirectory = contextMenuTarget.dataset.isDirectory === 'true';
        
        switch (action) {
            case 'open':
                if (isDirectory) {
                    await loadFileTree(filePath);
                } else {
                    await openFileInEditor(filePath);
                }
                break;
            case 'rename':
                showModal('RENAME FILE', 'ENTER NEW NAME:', (newName) => {
                    if (newName) {
                        renameFile(filePath, newName);
                    }
                });
                break;
            case 'copy':
                showNotification('COPY FUNCTIONALITY COMING SOON', 'info');
                break;
            case 'delete':
                if (confirm('ARE YOU SURE YOU WANT TO DELETE THIS ITEM?')) {
                    await deleteFile(filePath);
                }
                break;
            case 'download':
                if (!isDirectory) {
                    downloadFile(filePath);
                }
                break;
            case 'properties':
                showFileProperties(filePath);
                break;
            case 'zip':
                console.log('[DEBUG] ZIP action triggered, selected files:', Array.from(selectedFiles));
                
                // DEBUG: Log what we have in context
                console.log('DEBUG - Context Menu ZIP Action - Files:', Array.from(selectedFiles), 'Count:', selectedFiles.size);
                
                if (selectedFiles.size === 0) {
                    showNotification('SELECT FILES TO ZIP FIRST', 'warning');
                } else {
                    showZipPreview();
                }
                break;
            case 'unzip':
                if (filePath && filePath.toLowerCase().endsWith('.zip')) {
                    extractZip(filePath);
                }
                break;
            case 'clear-selection':
                clearSelection();
                break;
        }
    }
    
    hideContextMenu();
}

async function renameFile(oldPath, newName) {
    showLoadingOverlay('RENAMING FILE');
    try {
        const pathParts = oldPath.split('/');
        pathParts[pathParts.length - 1] = newName;
        const newPath = pathParts.join('/');
        
        const response = await fetch('/api/file/rename', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                oldPath: oldPath,
                newPath: newPath
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            await loadFileTree();
            showNotification(`FILE RENAMED TO ${newName.toUpperCase()} SUCCESSFULLY`, 'success');
        } else {
            showNotification('ERROR RENAMING FILE: ' + result.error.toUpperCase(), 'error');
        }
    } catch (error) {
        showNotification('ERROR RENAMING FILE: ' + error.message.toUpperCase(), 'error');
    } finally {
        hideLoadingOverlay();
    }
}

async function deleteFile(filePath) {
    showLoadingOverlay('DELETING FILE');
    try {
        const response = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            await loadFileTree();
            showNotification('FILE DELETED SUCCESSFULLY', 'success');
        } else {
            showNotification('ERROR DELETING FILE: ' + result.error.toUpperCase(), 'error');
        }
    } catch (error) {
        showNotification('ERROR DELETING FILE: ' + error.message.toUpperCase(), 'error');
    } finally {
        hideLoadingOverlay();
    }
}

function downloadFile(filePath) {
    showNotification('DOWNLOADING FILE...', 'info');
    window.open(`/api/file/download?path=${encodeURIComponent(filePath)}`, '_blank');
}

function showFileProperties(filePath) {
    const fileName = filePath.split('/').pop();
    const fileExtension = fileName.split('.').pop() || 'NO EXTENSION';
    
    showNotification(`FILE: ${fileName.toUpperCase()} | TYPE: ${fileExtension.toUpperCase()}`, 'info');
}

function showModal(title, placeholder, callback) {
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modal-title');
    const modalInput = document.getElementById('modal-input');
    
    modalTitle.textContent = title;
    modalInput.placeholder = placeholder;
    modalInput.value = '';
    
    modal.style.display = 'flex';
    modalInput.focus();
    
    window.modalCallback = callback;
}

function hideModal() {
    const modal = document.getElementById('modal');
    modal.style.display = 'none';
}

function handleModalConfirm() {
    const modalInput = document.getElementById('modal-input');
    
    if (window.modalCallback) {
        window.modalCallback(modalInput.value.trim());
    }
    
    hideModal();
}

function handleKeyboardShortcuts(event) {
    if (event.ctrlKey || event.metaKey) {
        switch (event.key) {
            case 's':
                event.preventDefault();
                saveCurrentFile();
                break;
            case 'n':
                event.preventDefault();
                createNewFile();
                break;
            case '`':
                event.preventDefault();
                toggleTerminalFooter();
                break;
            case 'T':
                if (event.shiftKey) {
                    event.preventDefault();
                    createNewTerminal();
                }
                break;
        }
    }
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    Object.assign(notification.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '12px 20px',
        borderRadius: '4px',
        color: '#fff',
        fontWeight: '500',
        zIndex: '9999',
        maxWidth: '400px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        transform: 'translateX(100%)',
        transition: 'transform 0.3s ease'
    });
    
    const colors = {
        success: '#28a745',
        error: '#dc3545',
        warning: '#ffc107',
        info: '#17a2b8'
    };
    notification.style.backgroundColor = colors[type] || colors.info;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// Global functions
window.createNewFile = createNewFile;
window.createNewFolder = createNewFolder;
window.showTerminal = showTerminal;

// File statistics tracking
let fileStats = {
    fileCount: 0,
    dirCount: 0,
    totalSize: 0
};

// Update file statistics
function updateFileStats(files) {
    fileStats.fileCount = files.filter(f => !f.isDirectory).length;
    fileStats.dirCount = files.filter(f => f.isDirectory).length;
    fileStats.totalSize = files.reduce((total, f) => total + (f.size || 0), 0);
    
    document.getElementById('file-count').textContent = fileStats.fileCount;
    document.getElementById('dir-count').textContent = fileStats.dirCount;
    document.getElementById('total-size').textContent = formatFileSize(fileStats.totalSize);
}

// Enhanced file tree loading with stats
async function loadFileTreeEnhanced(path = 'workspace') {
    try {
        const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
        const files = await response.json();
        
        if (response.ok) {
            fileTree = files;
            renderFileTree(files);
            updateFileStats(files);
        } else {
            showNotification('Error loading files: ' + files.error, 'error');
        }
    } catch (error) {
        showNotification('Error loading files: ' + error.message, 'error');
    }
}

// Override the original loadFileTree
loadFileTree = loadFileTreeEnhanced;

// Enhanced notification system
function showHackerNotification(message, type = 'info') {
    const notificationArea = document.getElementById('notification-area');
    const notification = document.createElement('div');
    
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <i class="fas fa-${getNotificationIcon(type)}"></i>
            <span>${message}</span>
        </div>
    `;
    
    // Style the notification
    Object.assign(notification.style, {
        padding: '12px 20px',
        marginBottom: '10px',
        fontSize: '12px',
        transform: 'translateX(100%)',
        transition: 'transform 0.3s ease',
        cursor: 'pointer'
    });
    
    notificationArea.appendChild(notification);
    
    // Slide in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Click to dismiss
    notification.onclick = () => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    };
    
    // Auto remove after 4 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }
    }, 4000);
}

function getNotificationIcon(type) {
    const icons = {
        success: 'check-circle',
        error: 'exclamation-triangle',
        warning: 'exclamation-circle',
        info: 'info-circle'
    };
    return icons[type] || icons.info;
}

// Override the original showNotification
showNotification = showHackerNotification;

// Cursor position tracking for Monaco Editor
function trackCursorPosition() {
    if (monacoEditor) {
        monacoEditor.onDidChangeCursorPosition((e) => {
            const position = e.position;
            document.getElementById('cursor-position').textContent = 
                `Ln ${position.lineNumber}, Col ${position.column}`;
        });
    }
}

// Enhanced tab rendering with file type icons
function renderTabsEnhanced() {
    const tabsContainer = document.getElementById('editor-tabs');
    tabsContainer.innerHTML = '';
    
    openTabs.forEach((tab, index) => {
        const tabElement = document.createElement('div');
        tabElement.className = 'editor-tab';
        if (index === activeTabIndex) {
            tabElement.classList.add('active');
        }
        
        const icon = document.createElement('i');
        icon.className = getFileIcon(tab.filename);
        
        const filename = document.createElement('span');
        filename.textContent = tab.filename;
        if (tab.modified) {
            filename.textContent += ' •';
            filename.style.color = '#ff0040';
        }
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'close-btn';
        closeBtn.innerHTML = '×';
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            closeTab(index);
        };
        
        tabElement.appendChild(icon);
        tabElement.appendChild(filename);
        tabElement.appendChild(closeBtn);
        
        tabElement.onclick = () => switchToTab(index);
        
        tabsContainer.appendChild(tabElement);
    });
}

// Override original renderTabs
renderTabs = renderTabsEnhanced;

// Enhanced loading overlay
function showLoadingOverlay(message = 'ACCESSING MAINFRAME') {
    const overlay = document.getElementById('loading-overlay');
    const loadingText = overlay.querySelector('.loading-text span');
    loadingText.textContent = message;
    overlay.style.display = 'flex';
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = 'none';
}

// Enhanced file operations with loading
async function createFileEnhanced(filename) {
    showLoadingOverlay('CREATING FILE');
    try {
        const workspacePath = 'workspace';
        const filePath = `${workspacePath}/${filename}`;
        
        const response = await fetch('/api/file/write', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: filePath,
                content: ''
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            await loadFileTree();
            await openFileInEditor(filePath);
            showNotification(`FILE ${filename.toUpperCase()} CREATED SUCCESSFULLY`, 'success');
        } else {
            showNotification('ERROR CREATING FILE: ' + result.error.toUpperCase(), 'error');
        }
    } catch (error) {
        showNotification('ERROR CREATING FILE: ' + error.message.toUpperCase(), 'error');
    } finally {
        hideLoadingOverlay();
    }
}

// Override original createFile
createFile = createFileEnhanced;

// Keyboard shortcuts with hacker style
function handleKeyboardShortcutsEnhanced(event) {
    if (event.ctrlKey || event.metaKey) {
        switch (event.key) {
            case 's':
                event.preventDefault();
                showLoadingOverlay('SAVING TO SECURE STORAGE');
                setTimeout(() => {
                    saveCurrentFile();
                    hideLoadingOverlay();
                }, 500);
                break;
            case 'n':
                event.preventDefault();
                createNewFile();
                break;
            case '`':
                event.preventDefault();
                toggleTerminal();
                break;
            case 'f':
                event.preventDefault();
                showNotification('SEARCH FUNCTIONALITY COMING SOON', 'info');
                break;
        }
    }
    
    // F5 for refresh
    if (event.key === 'F5') {
        event.preventDefault();
        showLoadingOverlay('REFRESHING FILE SYSTEM');
        setTimeout(() => {
            loadFileTree();
            hideLoadingOverlay();
        }, 800);
    }
}

// Override original keyboard shortcuts
handleKeyboardShortcuts = handleKeyboardShortcutsEnhanced;

// Initialize hacker effects
function initializeHackerEffects() {
    // Track cursor position when Monaco is ready
    setTimeout(() => {
        trackCursorPosition();
    }, 2000);
    
    // Add sound effects (optional)
    function playHackerSound(type) {
        // You can add actual sound files here
        console.log(`[SOUND] ${type.toUpperCase()}`);
    }
    
    // Override terminal show/hide with effects
    const originalShowTerminal = showTerminal;
    const originalHideTerminal = hideTerminal;
    
    window.showTerminal = function() {
        showNotification('TERMINAL ACCESS GRANTED', 'success');
        playHackerSound('terminal_access');
        return originalShowTerminal();
    };
    
    window.hideTerminal = function() {
        showNotification('TERMINAL SESSION TERMINATED', 'warning');
        return originalHideTerminal();
    };
}

// ===== UX IMPROVEMENT FUNCTIONS =====

// Current directory path for breadcrumb
let currentPath = 'workspace';

// Multi-selection and drag & drop state
let selectedFiles = new Set();
let draggedElement = null;
let dragGhost = null;
let isMultiSelecting = false;
let lastSelectedFile = null; // Track last selected file for Shift selection

// HTML Preview state
let isPreviewMode = false;
let isSplitView = false;
let currentPreviewFile = null;

// Help Panel Management
function toggleHelpPanel() {
    const helpPanel = document.getElementById('help-panel');
    if (helpPanel.classList.contains('show')) {
        helpPanel.classList.remove('show');
    } else {
        helpPanel.classList.add('show');
    }
}

// Operation Status Management
function showOperationStatus(title, detail, progress = 0) {
    const statusPanel = document.getElementById('operation-status');
    const titleElement = statusPanel.querySelector('.operation-title');
    const detailElement = statusPanel.querySelector('.operation-detail');
    const progressFill = statusPanel.querySelector('.progress-fill');
    
    titleElement.textContent = title.toUpperCase();
    detailElement.textContent = detail;
    progressFill.style.width = progress + '%';
    
    statusPanel.classList.add('show');
    
    return {
        update: (newTitle, newDetail, newProgress) => {
            if (newTitle) titleElement.textContent = newTitle.toUpperCase();
            if (newDetail) detailElement.textContent = newDetail;
            if (newProgress !== undefined) progressFill.style.width = newProgress + '%';
        },
        hide: () => {
            statusPanel.classList.remove('show');
        }
    };
}

function hideOperationStatus() {
    const statusPanel = document.getElementById('operation-status');
    statusPanel.classList.remove('show');
}

// Breadcrumb Navigation
function updateBreadcrumb(path = 'workspace') {
    const breadcrumbNav = document.getElementById('breadcrumb-nav');
    const pathParts = path.split('/').filter(part => part !== '');
    
    breadcrumbNav.innerHTML = '';
    
    // Home item
    const homeItem = document.createElement('div');
    homeItem.className = 'breadcrumb-item';
    if (pathParts.length === 0 || (pathParts.length === 1 && pathParts[0] === 'workspace')) {
        homeItem.classList.add('active');
    }
    homeItem.innerHTML = `
        <i class="fas fa-home"></i>
        <span>workspace</span>
    `;
    homeItem.onclick = () => navigateToPath('workspace');
    breadcrumbNav.appendChild(homeItem);
    
    // Path items
    let currentBreadcrumbPath = 'workspace';
    for (let i = 0; i < pathParts.length; i++) {
        if (pathParts[i] === 'workspace' && i === 0) continue;
        
        // Add separator
        const separator = document.createElement('span');
        separator.className = 'breadcrumb-separator';
        separator.textContent = '>';
        breadcrumbNav.appendChild(separator);
        
        currentBreadcrumbPath += '/' + pathParts[i];
        
        const item = document.createElement('div');
        item.className = 'breadcrumb-item';
        if (i === pathParts.length - 1) {
            item.classList.add('active');
        }
        
        item.innerHTML = `
            <i class="fas fa-folder"></i>
            <span>${pathParts[i]}</span>
        `;
        
        const pathToNavigate = currentBreadcrumbPath;
        item.onclick = () => navigateToPath(pathToNavigate);
        breadcrumbNav.appendChild(item);
    }
}

async function navigateToPath(path) {
    currentPath = path;
    updateBreadcrumb(path);
    await loadFileTree(path);
    showNotification(`NAVIGATED TO ${path.toUpperCase()}`, 'info');
}

// Enhanced File Tree Loading with Status
async function loadFileTreeWithStatus(path = 'workspace') {
    const status = showOperationStatus('Loading Files', 'Scanning directory structure...', 10);
    
    try {
        status.update(null, 'Establishing secure connection...', 30);
        await new Promise(resolve => setTimeout(resolve, 200)); // Small delay for UX
        
        status.update(null, 'Reading file system...', 60);
        const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
        const files = await response.json();
        
        status.update(null, 'Processing file data...', 80);
        
        if (response.ok) {
            fileTree = files;
            renderFileTree(files);
            updateFileStats(files);
            updateBreadcrumb(path);
            currentPath = path;
            
            status.update('Complete', 'Files loaded successfully', 100);
            setTimeout(() => status.hide(), 1000);
            
            showNotification(`LOADED ${files.length} ITEMS FROM ${path.toUpperCase()}`, 'success');
        } else {
            status.hide();
            showNotification('ERROR LOADING FILES: ' + files.error.toUpperCase(), 'error');
        }
    } catch (error) {
        status.hide();
        showNotification('ERROR LOADING FILES: ' + error.message.toUpperCase(), 'error');
    }
}

// Quick Actions Functions
function refreshFileTree() {
    loadFileTreeWithStatus(currentPath);
}

function toggleTerminal() {
    toggleTerminalFooter();
}

// Enhanced Keyboard Shortcuts
function handleEnhancedKeyboardShortcuts(event) {
    // F1 for help
    if (event.key === 'F1') {
        event.preventDefault();
        toggleHelpPanel();
        return;
    }
    
    // ESC to close modals/panels
    if (event.key === 'Escape') {
        const helpPanel = document.getElementById('help-panel');
        if (helpPanel.classList.contains('show')) {
            toggleHelpPanel();
            return;
        }
        
        const modal = document.getElementById('modal');
        if (modal.style.display === 'flex') {
            hideModal();
            return;
        }
        
        hideContextMenu();
    }
    
    if (event.ctrlKey || event.metaKey) {
        switch (event.key) {
            case 's':
                event.preventDefault();
                const saveStatus = showOperationStatus('Saving File', 'Writing to secure storage...', 0);
                setTimeout(() => {
                    saveStatus.update(null, 'Encrypting data...', 50);
                    setTimeout(() => {
                        saveCurrentFile().then(() => {
                            saveStatus.update('Saved', 'File secured successfully', 100);
                            setTimeout(() => saveStatus.hide(), 1000);
                        });
                    }, 300);
                }, 200);
                break;
            case 'n':
                event.preventDefault();
                createNewFile();
                break;
            case '`':
                event.preventDefault();
                toggleTerminal();
                break;
            case 'f':
                event.preventDefault();
                showNotification('SEARCH FUNCTIONALITY COMING SOON', 'info');
                break;
            case 'r':
                if (event.shiftKey) {
                    event.preventDefault();
                    refreshFileTree();
                }
                break;
        }
    }
    
    // F5 for refresh
    if (event.key === 'F5') {
        event.preventDefault();
        if (isPreviewMode) {
            refreshPreview();
        } else {
            refreshFileTree();
        }
    }
}

// Enhanced File Operations with Status Feedback
async function createFileWithStatus(filename) {
    const status = showOperationStatus('Creating File', 'Initializing secure file system...', 10);
    
    try {
        status.update(null, 'Generating file structure...', 30);
        await new Promise(resolve => setTimeout(resolve, 200));
        
        const workspacePath = currentPath;
        const filePath = `${workspacePath}/${filename}`;
        
        status.update(null, 'Writing to secure storage...', 60);
        
        const response = await fetch('/api/file/write', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: filePath,
                content: ''
            })
        });
        
        const result = await response.json();
        
        status.update(null, 'Finalizing file creation...', 90);
        
        if (response.ok) {
            await loadFileTreeWithStatus(currentPath);
            await openFileInEditor(filePath);
            
            status.update('Complete', 'File created successfully', 100);
            setTimeout(() => status.hide(), 1000);
            
            showNotification(`FILE ${filename.toUpperCase()} CREATED SUCCESSFULLY`, 'success');
        } else {
            status.hide();
            showNotification('ERROR CREATING FILE: ' + result.error.toUpperCase(), 'error');
        }
    } catch (error) {
        status.hide();
        showNotification('ERROR CREATING FILE: ' + error.message.toUpperCase(), 'error');
    }
}

// Enhanced Directory Operations
async function createDirectoryWithStatus(dirname) {
    const status = showOperationStatus('Creating Directory', 'Preparing directory structure...', 10);
    
    try {
        status.update(null, 'Establishing directory permissions...', 40);
        await new Promise(resolve => setTimeout(resolve, 200));
        
        const workspacePath = currentPath;
        const dirPath = `${workspacePath}/${dirname}`;
        
        status.update(null, 'Creating secure directory...', 70);
        
        const response = await fetch('/api/directory/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                path: dirPath
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            status.update('Complete', 'Directory created successfully', 100);
            setTimeout(() => status.hide(), 1000);
            
            await loadFileTreeWithStatus(currentPath);
            showNotification(`DIRECTORY ${dirname.toUpperCase()} CREATED SUCCESSFULLY`, 'success');
        } else {
            status.hide();
            showNotification('ERROR CREATING DIRECTORY: ' + result.error.toUpperCase(), 'error');
        }
    } catch (error) {
        status.hide();
        showNotification('ERROR CREATING DIRECTORY: ' + error.message.toUpperCase(), 'error');
    }
}

// Enhanced File Upload with Progress
async function uploadFileWithStatus(file) {
    const status = showOperationStatus('Uploading File', `Preparing ${file.name}...`, 0);
    
    try {
        status.update(null, 'Establishing secure connection...', 20);
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', currentPath);
        
        status.update(null, 'Transferring encrypted data...', 50);
        
        const response = await fetch('/api/file/upload', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        status.update(null, 'Finalizing upload...', 90);
        
        if (response.ok) {
            status.update('Complete', 'Upload successful', 100);
            setTimeout(() => status.hide(), 1000);
            showNotification(`UPLOADED ${file.name.toUpperCase()}`, 'success');
        } else {
            status.hide();
            showNotification(`ERROR UPLOADING ${file.name.toUpperCase()}: ${result.error.toUpperCase()}`, 'error');
        }
    } catch (error) {
        status.hide();
        showNotification(`ERROR UPLOADING ${file.name.toUpperCase()}: ${error.message.toUpperCase()}`, 'error');
    }
}

// Override existing functions with enhanced versions
const originalCreateFile = createFile;
const originalCreateDirectory = createDirectory;
const originalHandleFileUpload = handleFileUpload;
const originalHandleKeyboardShortcuts = handleKeyboardShortcuts;

createFile = createFileWithStatus;
createDirectory = createDirectoryWithStatus;
handleKeyboardShortcuts = handleEnhancedKeyboardShortcuts;

// Enhanced file upload handler
handleFileUpload = async function(event) {
    const files = event.target.files;
    if (!files.length) return;
    
    for (const file of files) {
        await uploadFileWithStatus(file);
    }
    
    event.target.value = '';
    await loadFileTreeWithStatus(currentPath);
};

// Enhanced double-click handler for directories
const originalHandleFileDoubleClick = handleFileDoubleClick;
handleFileDoubleClick = async function(file) {
    if (file.isDirectory) {
        await navigateToPath(file.path);
    } else {
        await openFileInEditor(file.path);
    }
};

// Add visual feedback for file operations
function markFileAsModified(filePath) {
    const fileItems = document.querySelectorAll('.file-item');
    fileItems.forEach(item => {
        if (item.dataset.path === filePath) {
            item.classList.add('modified');
        }
    });
}

function markFileAsSaved(filePath) {
    const fileItems = document.querySelectorAll('.file-item');
    fileItems.forEach(item => {
        if (item.dataset.path === filePath) {
            item.classList.remove('modified');
        }
    });
}

// ===== MULTI-SELECTION FUNCTIONS =====

// Get files between two files in the sorted file tree
function getFilesBetween(filePath1, filePath2) {
    const fileItems = Array.from(document.querySelectorAll('.file-item'));
    const paths = fileItems.map(item => item.dataset.path);
    
    const index1 = paths.indexOf(filePath1);
    const index2 = paths.indexOf(filePath2);
    
    if (index1 === -1 || index2 === -1) return [];
    
    const startIndex = Math.min(index1, index2);
    const endIndex = Math.max(index1, index2);
    
    return paths.slice(startIndex, endIndex + 1);
}

// Toggle file selection
function toggleFileSelection(filePath, event) {
    // Support both Ctrl (Windows/Linux) and Cmd (macOS)
    const isMultiSelectKey = event?.ctrlKey || event?.metaKey;
    
    console.log('[DEBUG] toggleFileSelection called:', filePath, 'Ctrl:', event?.ctrlKey, 'Cmd:', event?.metaKey, 'Shift:', event?.shiftKey);
    
    if (event && event.shiftKey && lastSelectedFile) {
        // Shift-click: Range selection
        console.log('[DEBUG] Shift-select mode - selecting range');
        
        // Clear current selection if not holding Ctrl/Cmd
        if (!isMultiSelectKey) {
            selectedFiles.clear();
        }
        
        // Get all files between last selected and current
        const filesInRange = getFilesBetween(lastSelectedFile, filePath);
        console.log('[DEBUG] Files in range:', filesInRange);
        
        // Add all files in range to selection
        filesInRange.forEach(file => selectedFiles.add(file));
        
        isMultiSelecting = true;
        
        // Show helpful notification for first-time shift selection
        if (filesInRange.length > 2) {
            showNotification(`RANGE SELECTED: ${filesInRange.length} FILES`, 'success');
        }
    } else if (event && isMultiSelectKey) {
        // Ctrl/Cmd-click: Toggle individual file
        console.log('[DEBUG] Multi-select mode - toggling file');
        isMultiSelecting = true;
        
        if (selectedFiles.has(filePath)) {
            selectedFiles.delete(filePath);
            console.log('[DEBUG] Removed from selection:', filePath);
        } else {
            selectedFiles.add(filePath);
            console.log('[DEBUG] Added to selection:', filePath);
        }
        
        lastSelectedFile = filePath;
    } else {
        // Single click: Select only this file
        console.log('[DEBUG] Single select mode');
        selectedFiles.clear();
        selectedFiles.add(filePath);
        isMultiSelecting = false;
        lastSelectedFile = filePath;
    }
    
    console.log('[DEBUG] Selected files:', Array.from(selectedFiles));
    updateFileSelection();
    updateSelectionCounter();
}

// Update visual selection state
function updateFileSelection() {
    console.log('[DEBUG] updateFileSelection called, selectedFiles:', Array.from(selectedFiles));
    document.querySelectorAll('.file-item').forEach(item => {
        const filePath = item.dataset.path;
        item.classList.remove('selected', 'multi-selected');
        
        if (selectedFiles.has(filePath)) {
            if (selectedFiles.size > 1) {
                item.classList.add('multi-selected');
                console.log('[DEBUG] Marking as multi-selected:', filePath);
            } else {
                item.classList.add('selected');
                console.log('[DEBUG] Marking as selected:', filePath);
            }
        }
    });
}

// Update selection counter
function updateSelectionCounter() {
    const counter = document.getElementById('selection-counter');
    const countElement = document.getElementById('selection-count');
    const debugElement = document.getElementById('debug-selection-info');
    
    console.log('[DEBUG] updateSelectionCounter - selectedFiles.size:', selectedFiles.size);
    
    if (selectedFiles.size > 0) {
        countElement.textContent = selectedFiles.size;
        counter.classList.add('show');
        
        // Update debug info
        if (debugElement) {
            debugElement.textContent = `DEBUG: ${selectedFiles.size} files - ${Array.from(selectedFiles).map(f => f.split('/').pop()).join(', ')}`;
        }
        
        console.log('[DEBUG] Showing selection counter with count:', selectedFiles.size);
    } else {
        counter.classList.remove('show');
        isMultiSelecting = false;
        
        // Update debug info
        if (debugElement) {
            debugElement.textContent = 'DEBUG: 0 files';
        }
        
        console.log('[DEBUG] Hiding selection counter');
    }
}

// Clear all selections
function clearSelection() {
    selectedFiles.clear();
    lastSelectedFile = null;
    updateFileSelection();
    updateSelectionCounter();
}

// Select all files in current view
function selectAllFiles() {
    const fileItems = document.querySelectorAll('.file-item');
    selectedFiles.clear();
    
    fileItems.forEach(item => {
        selectedFiles.add(item.dataset.path);
    });
    
    if (fileItems.length > 0) {
        lastSelectedFile = fileItems[fileItems.length - 1].dataset.path;
    }
    
    isMultiSelecting = true;
    updateFileSelection();
    updateSelectionCounter();
    
    showNotification(`SELECTED ALL ${selectedFiles.size} ITEMS`, 'info');
}

// ===== DRAG & DROP FUNCTIONS =====

// Initialize drag and drop for file item
function initializeDragDrop(fileItem, file) {
    fileItem.draggable = true;
    
    fileItem.addEventListener('dragstart', (event) => {
        draggedElement = fileItem;
        fileItem.classList.add('dragging');
        
        // If file is not selected, select it
        if (!selectedFiles.has(file.path)) {
            toggleFileSelection(file.path, null);
        }
        
        // Create drag ghost
        createDragGhost(event);
        
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', file.path);
    });
    
    fileItem.addEventListener('dragend', () => {
        fileItem.classList.remove('dragging');
        if (dragGhost) {
            dragGhost.remove();
            dragGhost = null;
        }
        draggedElement = null;
        
        // Remove drag-over classes from all items
        document.querySelectorAll('.file-item').forEach(item => {
            item.classList.remove('drag-over', 'cannot-drop');
        });
    });
    
    // Only allow drop on directories
    if (file.isDirectory) {
        fileItem.addEventListener('dragover', (event) => {
            event.preventDefault();
            
            // Don't allow drop on selected files
            if (selectedFiles.has(file.path)) {
                fileItem.classList.add('cannot-drop');
                event.dataTransfer.dropEffect = 'none';
                return;
            }
            
            fileItem.classList.add('drag-over');
            event.dataTransfer.dropEffect = 'move';
        });
        
        fileItem.addEventListener('dragleave', () => {
            fileItem.classList.remove('drag-over', 'cannot-drop');
        });
        
        fileItem.addEventListener('drop', (event) => {
            event.preventDefault();
            fileItem.classList.remove('drag-over', 'cannot-drop');
            
            if (selectedFiles.has(file.path)) {
                return; // Can't drop on self
            }
            
            handleFileDrop(file.path);
        });
    }
}

// Create drag ghost element
function createDragGhost(event) {
    dragGhost = document.createElement('div');
    dragGhost.className = 'drag-ghost';
    
    const count = selectedFiles.size;
    dragGhost.textContent = count > 1 ? `${count} files` : 'Moving file...';
    
    document.body.appendChild(dragGhost);
    
    // Position ghost near cursor
    const updateGhostPosition = (e) => {
        dragGhost.style.left = (e.clientX + 10) + 'px';
        dragGhost.style.top = (e.clientY - 10) + 'px';
    };
    
    document.addEventListener('dragover', updateGhostPosition);
    updateGhostPosition(event);
}

// Handle file drop
async function handleFileDrop(targetPath) {
    const filesToMove = Array.from(selectedFiles);
    const status = showOperationStatus('Moving Files', `Moving ${filesToMove.length} items...`, 0);
    
    try {
        for (let i = 0; i < filesToMove.length; i++) {
            const sourcePath = filesToMove[i];
            const fileName = sourcePath.split('/').pop();
            const newPath = `${targetPath}/${fileName}`;
            
            status.update(null, `Moving ${fileName}...`, (i / filesToMove.length) * 100);
            
            const response = await fetch('/api/file/move', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sourcePath: sourcePath,
                    targetPath: newPath
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error);
            }
        }
        
        status.update('Complete', 'Files moved successfully', 100);
        setTimeout(() => status.hide(), 1000);
        
        clearSelection();
        await loadFileTreeWithStatus(currentPath);
        showNotification(`MOVED ${filesToMove.length} ITEMS SUCCESSFULLY`, 'success');
        
    } catch (error) {
        status.hide();
        showNotification(`ERROR MOVING FILES: ${error.message.toUpperCase()}`, 'error');
    }
}

// ===== ZIP OPERATIONS =====

// Show zip preview modal
function showZipPreview() {
    const selectedPaths = Array.from(selectedFiles);
    console.log('[DEBUG] showZipPreview called with:', selectedPaths);
    
    // DEBUG: Log what we have
    console.log('DEBUG - showZipPreview called! Files:', selectedPaths, 'Count:', selectedPaths.length);
    
    if (selectedPaths.length === 0) {
        showNotification('SELECT FILES TO ZIP FIRST', 'warning');
        return;
    }
    
    const modal = document.getElementById('zip-preview');
    const fileList = document.getElementById('zip-file-list');
    const zipNameInput = document.getElementById('zip-name-input');
    
    if (!modal || !fileList || !zipNameInput) {
        console.error('[ERROR] ZIP preview elements not found');
        showNotification('ZIP PREVIEW ERROR: MISSING ELEMENTS', 'error');
        return;
    }
    
    // Clear previous list
    fileList.innerHTML = '';
    
    // Populate file list
    selectedPaths.forEach(filePath => {
        const fileName = filePath.split('/').pop();
        const fileElement = document.querySelector(`[data-path="${filePath}"]`);
        const isDirectory = fileElement ? fileElement.dataset.isDirectory === 'true' : false;
        
        console.log('[DEBUG] Adding to ZIP preview:', fileName, 'isDirectory:', isDirectory);
        
        const listItem = document.createElement('div');
        listItem.className = 'zip-file-item';
        listItem.innerHTML = `
            <i class="fas fa-${isDirectory ? 'folder' : 'file'}"></i>
            <span>${fileName}</span>
            <small style="opacity: 0.7; margin-left: 10px;">${filePath}</small>
        `;
        fileList.appendChild(listItem);
    });
    
    // Set default zip name
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:\-]/g, '').replace('T', '_');
    zipNameInput.value = `archive_${timestamp}.zip`;
    
    console.log('[DEBUG] Showing ZIP preview modal');
    modal.classList.add('show');
    
    // DEBUG: Confirm modal is shown
    console.log('DEBUG - ZIP Preview Modal visible! Modal classList:', modal.className);
}

// Hide zip preview modal
function hideZipPreview() {
    const modal = document.getElementById('zip-preview');
    modal.classList.remove('show');
}

// Confirm create zip
async function confirmCreateZip() {
    console.log('DEBUG - confirmCreateZip() called!');
    
    const selectedPaths = Array.from(selectedFiles);
    const zipName = document.getElementById('zip-name-input').value.trim();
    
    // Clean paths to remove any workspace prefix duplication
    const cleanPaths = selectedPaths.map(filePath => {
        // Convert absolute paths to relative paths from workspace
        if (filePath.includes('/workspace/')) {
            const workspaceIndex = filePath.indexOf('/workspace/');
            return filePath.substring(workspaceIndex + '/workspace/'.length);
        }
        return filePath;
    });
    
    console.log('[DEBUG] Original paths:', selectedPaths);
    console.log('[DEBUG] Clean paths for ZIP:', cleanPaths);
    console.log('[DEBUG] ZIP name:', zipName);
    
    // DEBUG: Show path cleaning result
    console.log('DEBUG - Path Cleaning Results:', {
        original: selectedPaths, 
        cleaned: cleanPaths, 
        zipName: zipName
    });
    
    if (!zipName) {
        showNotification('ZIP NAME CANNOT BE EMPTY', 'error');
        return;
    }
    
    if (cleanPaths.length === 0) {
        showNotification('NO FILES SELECTED FOR ZIP', 'error');
        return;
    }
    
    hideZipPreview();
    
    const status = showOperationStatus('Creating ZIP', 'Preparing archive...', 10);
    
    try {
        status.update(null, 'Compressing files...', 50);
        
        console.log('[DEBUG] Sending ZIP request to server...');
        
        const response = await fetch('/api/file/zip', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: cleanPaths,
                zipName: zipName
            })
        });
        
        console.log('[DEBUG] ZIP response status:', response.status);
        
        const result = await response.json();
        console.log('[DEBUG] ZIP response data:', result);
        
        if (response.ok) {
            status.update('Complete', 'ZIP archive created', 100);
            setTimeout(() => status.hide(), 1000);
            
            clearSelection();
            await loadFileTreeWithStatus(currentPath);
            showNotification(`ZIP ARCHIVE ${zipName.toUpperCase()} CREATED SUCCESSFULLY`, 'success');
        } else {
            status.hide();
            console.error('[ERROR] ZIP creation failed:', result);
            showNotification(`ERROR CREATING ZIP: ${result.error.toUpperCase()}`, 'error');
        }
        
    } catch (error) {
        status.hide();
        console.error('[ERROR] ZIP creation exception:', error);
        showNotification(`ERROR CREATING ZIP: ${error.message.toUpperCase()}`, 'error');
    }
}

// Extract ZIP file
async function extractZip(zipPath) {
    const status = showOperationStatus('Extracting ZIP', 'Extracting archive...', 10);
    
    try {
        status.update(null, 'Reading ZIP contents...', 50);
        
        const response = await fetch('/api/file/unzip', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                zipPath: zipPath,
                extractTo: currentPath
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            status.update('Complete', 'ZIP extracted successfully', 100);
            setTimeout(() => status.hide(), 1000);
            
            await loadFileTreeWithStatus(currentPath);
            showNotification(`ZIP ARCHIVE EXTRACTED SUCCESSFULLY`, 'success');
        } else {
            status.hide();
            showNotification(`ERROR EXTRACTING ZIP: ${result.error.toUpperCase()}`, 'error');
        }
        
    } catch (error) {
        status.hide();
        showNotification(`ERROR EXTRACTING ZIP: ${error.message.toUpperCase()}`, 'error');
    }
}

// Delete multiple files
async function deleteMultipleFiles(filePaths) {
    const status = showOperationStatus('Deleting Files', `Deleting ${filePaths.length} items...`, 0);
    
    try {
        for (let i = 0; i < filePaths.length; i++) {
            const filePath = filePaths[i];
            const fileName = filePath.split('/').pop();
            
            status.update(null, `Deleting ${fileName}...`, (i / filePaths.length) * 100);
            
            const response = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error);
            }
        }
        
        status.update('Complete', 'Files deleted successfully', 100);
        setTimeout(() => status.hide(), 1000);
        
        clearSelection();
        await loadFileTreeWithStatus(currentPath);
        showNotification(`DELETED ${filePaths.length} ITEMS SUCCESSFULLY`, 'success');
        
    } catch (error) {
        status.hide();
        showNotification(`ERROR DELETING FILES: ${error.message.toUpperCase()}`, 'error');
    }
}

// Initialize UX improvements
function initializeUXImprovements() {
    // Add keyboard shortcut hints to buttons
    const shortcuts = {
        'new-file-btn': 'Ctrl+N',
        'save-btn': 'Ctrl+S',
        'refresh-btn': 'F5'
    };
    
    Object.entries(shortcuts).forEach(([btnId, shortcut]) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            const existingTitle = btn.getAttribute('title') || '';
            btn.setAttribute('title', `${existingTitle} [${shortcut}]`);
        }
    });
    
    // Initialize breadcrumb
    updateBreadcrumb('workspace');
    
    // Add enhanced keyboard event listener
    document.removeEventListener('keydown', handleKeyboardShortcuts);
    document.addEventListener('keydown', handleEnhancedKeyboardShortcuts);
    
    // Add click outside to close panels
    document.addEventListener('click', (event) => {
        const helpPanel = document.getElementById('help-panel');
        const zipPreview = document.getElementById('zip-preview');
        const quickActionBtn = event.target.closest('.quick-action-btn');
        
        // Close help panel
        if (helpPanel.classList.contains('show') && 
            !helpPanel.contains(event.target) && 
            !quickActionBtn) {
            toggleHelpPanel();
        }
        
        // Close zip preview when clicking background
        if (zipPreview.classList.contains('show') && 
            event.target === zipPreview) {
            hideZipPreview();
        }
        
        // Clear selection if clicking on empty space (but not on file tree itself)
        const isMultiSelectKey = event.ctrlKey || event.metaKey;
        if (!event.target.closest('.file-item') && 
            !event.target.closest('.context-menu') && 
            !event.target.closest('.zip-preview') &&
            !isMultiSelectKey) {
            const fileTree = event.target.closest('.file-tree');
            if (!fileTree) {
                console.log('[DEBUG] Clearing selection - clicked outside file area');
                clearSelection();
            }
        }
    });
    
    // Add ESC key handling
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            // First check if welcome screen is visible
            const welcomeScreen = document.querySelector('.welcome-screen');
            if (welcomeScreen && welcomeScreen.style.display !== 'none') {
                hideWelcomeScreen();
                showNotification('PRESS ANY KEY TO START HACKING', 'success');
            } else if (document.getElementById('zip-preview').classList.contains('show')) {
                hideZipPreview();
            } else if (selectedFiles.size > 0) {
                clearSelection();
            }
        }
        
        // Delete key to delete selected files
        if (event.key === 'Delete' && selectedFiles.size > 0) {
            const files = Array.from(selectedFiles);
            if (confirm(`DELETE ${files.length} SELECTED ITEMS?`)) {
                deleteMultipleFiles(files);
            }
        }
        
        // Ctrl+A to select all files
        if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
            const fileTree = document.getElementById('file-tree');
            if (fileTree && document.activeElement.closest('.file-explorer')) {
                event.preventDefault();
                selectAllFiles();
            }
        }
    });
    
    console.log('[UX] Enhanced UX features with multi-selection and drag & drop initialized');
}

// Platform detection
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const modifierKeyName = isMac ? 'Cmd' : 'Ctrl';
const modifierKeySymbol = isMac ? '⌘' : 'Ctrl';

// ===== HTML PREVIEW FUNCTIONS =====

function showPreviewButtons() {
    const previewBtn = document.getElementById('preview-btn');
    const splitViewBtn = document.getElementById('split-view-btn');
    if (previewBtn) previewBtn.classList.add('show');
    if (splitViewBtn) splitViewBtn.classList.add('show');
}

function hidePreviewButtons() {
    const previewBtn = document.getElementById('preview-btn');
    const splitViewBtn = document.getElementById('split-view-btn');
    if (previewBtn) previewBtn.classList.remove('show');
    if (splitViewBtn) splitViewBtn.classList.remove('show');
    closePreview();
}

function togglePreview() {
    if (isPreviewMode) {
        closePreview();
    } else {
        showPreview();
    }
}

function showPreview() {
    if (!currentFile || !currentFile.toLowerCase().endsWith('.html')) {
        showNotification('NO HTML FILE TO PREVIEW', 'warning');
        return;
    }
    
    isPreviewMode = true;
    currentPreviewFile = currentFile;
    
    const editorContainer = document.getElementById('editor-container');
    const previewContainer = document.getElementById('preview-container');
    const editor = document.getElementById('editor');
    
    if (isSplitView) {
        editorContainer.classList.add('split-view');
        editorContainer.style.display = 'grid'; // Change to grid for split view
        editor.style.display = 'flex';
        editor.style.width = ''; // Remove width constraint
    } else {
        editor.style.display = 'none';
    }
    
    previewContainer.style.display = 'flex';
    
    updatePreview();
    showNotification('HTML PREVIEW MODE ACTIVATED', 'success');
}

function closePreview() {
    isPreviewMode = false;
    currentPreviewFile = null;
    
    const editorContainer = document.getElementById('editor-container');
    const previewContainer = document.getElementById('preview-container');
    const editor = document.getElementById('editor');
    
    // Remove all preview-related classes and styles
    editorContainer.classList.remove('split-view');
    editorContainer.style.display = 'block'; // Reset to default display
    editor.style.display = 'flex';
    editor.style.width = '100%'; // Ensure editor takes full width
    previewContainer.style.display = 'none';
    
    isSplitView = false;
    
    // Force Monaco editor to resize
    if (monacoEditor) {
        setTimeout(() => {
            monacoEditor.layout();
        }, 100);
    }
}

function toggleSplitView() {
    if (!isPreviewMode) {
        isSplitView = true;
        showPreview();
    } else {
        isSplitView = !isSplitView;
        const editorContainer = document.getElementById('editor-container');
        const editor = document.getElementById('editor');
        
        if (isSplitView) {
            editorContainer.classList.add('split-view');
            editorContainer.style.display = 'grid';
            editor.style.display = 'flex';
            editor.style.width = ''; // Remove width constraint
            showNotification('SPLIT VIEW ENABLED', 'success');
            
            // Force Monaco editor to resize
            if (monacoEditor) {
                setTimeout(() => {
                    monacoEditor.layout();
                }, 100);
            }
        } else {
            editorContainer.classList.remove('split-view');
            editorContainer.style.display = 'block';
            editor.style.display = 'none';
            showNotification('FULL PREVIEW MODE', 'info');
        }
    }
}

async function updatePreview() {
    const iframe = document.getElementById('preview-iframe');
    if (!iframe || !currentPreviewFile) return;
    
    try {
        // Get current content from editor
        const content = monacoEditor.getValue();
        
        // Create blob URL for iframe
        const blob = new Blob([content], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        
        // Add loading indicator
        const previewContainer = document.getElementById('preview-container');
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'preview-loading';
        loadingDiv.innerHTML = '<i class="fas fa-spinner"></i><br>LOADING PREVIEW...';
        previewContainer.appendChild(loadingDiv);
        
        // Load in iframe
        iframe.onload = () => {
            if (loadingDiv.parentNode) {
                loadingDiv.remove();
            }
        };
        
        iframe.src = url;
        
        // Clean up blob URL after load
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        
    } catch (error) {
        showNotification('ERROR LOADING PREVIEW: ' + error.message, 'error');
    }
}

function refreshPreview() {
    if (isPreviewMode) {
        updatePreview();
        showNotification('PREVIEW REFRESHED', 'success');
    }
}

function openInNewTab() {
    if (!currentPreviewFile) return;
    
    try {
        const content = monacoEditor.getValue();
        const blob = new Blob([content], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        
        window.open(url, '_blank');
        
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showNotification('OPENED IN NEW TAB', 'success');
    } catch (error) {
        showNotification('ERROR OPENING NEW TAB: ' + error.message, 'error');
    }
}

// Auto-refresh preview on content change
let previewUpdateTimeout;
function setupPreviewAutoRefresh() {
    if (monacoEditor) {
        monacoEditor.onDidChangeModelContent(() => {
            if (isPreviewMode && currentFile && currentFile.toLowerCase().endsWith('.html')) {
                clearTimeout(previewUpdateTimeout);
                previewUpdateTimeout = setTimeout(() => {
                    updatePreview();
                }, 1000); // Debounce 1 second
            }
        });
    }
}

// Global functions for HTML buttons
window.togglePreview = togglePreview;
window.toggleSplitView = toggleSplitView;
window.refreshPreview = refreshPreview;
window.openInNewTab = openInNewTab;
window.closePreview = closePreview;

// Global function to hide welcome screen
window.hideWelcomeScreen = hideWelcomeScreen;
window.showWelcomeScreen = showWelcomeScreen;

// Terminal resize handling
let isResizingTerminal = false;
let terminalHeight = 200;

function initializeTerminalResize() {
    const terminalFooter = document.getElementById('terminal-footer');
    const mainContent = document.querySelector('.main-content');
    
    if (!terminalFooter || !mainContent) return;
    
    // Create resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'terminal-resize-handle';
    resizeHandle.innerHTML = '<i class="fas fa-grip-lines"></i>';
    terminalFooter.insertBefore(resizeHandle, terminalFooter.firstChild);
    
    let startY, startHeight;
    
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizingTerminal = true;
        startY = e.clientY;
        startHeight = terminalFooter.offsetHeight;
        document.body.style.cursor = 'ns-resize';
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizingTerminal) return;
        
        const deltaY = startY - e.clientY;
        const newHeight = Math.min(Math.max(startHeight + deltaY, 40), window.innerHeight * 0.7);
        
        terminalFooter.style.height = newHeight + 'px';
        mainContent.style.marginBottom = newHeight + 'px';
        
        // Resize terminal instances
        Object.values(terminals).forEach(terminal => {
            if (terminal.fitFunction) {
                terminal.fitFunction();
            }
        });
        
        // Resize Monaco editor
        if (monacoEditor) {
            monacoEditor.layout();
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizingTerminal) {
            isResizingTerminal = false;
            document.body.style.cursor = '';
            terminalHeight = terminalFooter.offsetHeight;
        }
    });
    
    // Handle terminal minimize/maximize
    const originalToggleTerminalFooter = toggleTerminalFooter;
    window.toggleTerminalFooter = function() {
        originalToggleTerminalFooter();
        const footer = document.getElementById('terminal-footer');
        if (footer.classList.contains('minimized')) {
            mainContent.style.marginBottom = '40px';
        } else {
            mainContent.style.marginBottom = terminalHeight + 'px';
        }
        
        // Force editor resize
        if (monacoEditor) {
            setTimeout(() => monacoEditor.layout(), 300);
        }
    };
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(initializeHackerEffects, 1000);
    setTimeout(initializeUXImprovements, 1500);
    
    // Ensure welcome screen is hidden on load
    setTimeout(() => {
        hideWelcomeScreen();
    }, 100);
    
    // Final fail-safe: Check periodically if welcome screen is showing when it shouldn't
    setInterval(() => {
        const welcomeScreen = document.querySelector('.welcome-screen');
        if (welcomeScreen && welcomeScreen.style.display !== 'none' && openTabs.length > 0) {
            console.log('[FIX] Force hiding welcome screen - tabs are open');
            hideWelcomeScreen();
        }
    }, 1000);
    
    // Click anywhere on welcome screen to close it
    const welcomeScreen = document.querySelector('.welcome-screen');
    if (welcomeScreen) {
        welcomeScreen.addEventListener('click', (e) => {
            // If clicked outside the content box, close welcome screen
            if (e.target === welcomeScreen || e.target.classList.contains('welcome-content')) {
                hideWelcomeScreen();
                showNotification('SYSTEM READY - ACCESS GRANTED', 'success');
            }
        });
    }
    
    // Show terminal by default
    setTimeout(() => {
        const terminalContainer = document.getElementById('terminal-container');
        if (terminalContainer && terminalContainer.classList.contains('hidden')) {
            terminalContainer.classList.remove('hidden');
        }
    }, 2000);
    
    // Show platform-specific hint on first load
    if (isMac && !localStorage.getItem('macHintShown')) {
        setTimeout(() => {
            showNotification(`MAC DETECTED: USE ${modifierKeySymbol}+CLICK FOR MULTI-SELECT`, 'info');
            localStorage.setItem('macHintShown', 'true');
        }, 3000);
    }
    
    // Initialize terminal resize
    setTimeout(() => {
        initializeTerminalResize();
    }, 1000);
    
    // Always hide welcome screen on startup - we want it hidden by default
    hideWelcomeScreen();
    
    // Initialize preview button handlers
    const previewBtn = document.getElementById('preview-btn');
    const splitViewBtn = document.getElementById('split-view-btn');
    
    if (previewBtn) {
        previewBtn.addEventListener('click', togglePreview);
    }
    
    if (splitViewBtn) {
        splitViewBtn.addEventListener('click', toggleSplitView);
    }
    
    // Add resize listener to fix layout issues
    window.addEventListener('resize', () => {
        if (monacoEditor) {
            monacoEditor.layout();
        }
        
        // Adjust terminal height on window resize
        const terminalFooter = document.getElementById('terminal-footer');
        const mainContent = document.querySelector('.main-content');
        if (terminalFooter && mainContent) {
            const currentHeight = terminalFooter.offsetHeight;
            const maxHeight = window.innerHeight * 0.7;
            if (currentHeight > maxHeight) {
                terminalFooter.style.height = maxHeight + 'px';
                mainContent.style.marginBottom = maxHeight + 'px';
            }
        }
        
        // Resize all terminals
        Object.values(terminals).forEach(terminal => {
            if (terminal.fitFunction) {
                terminal.fitFunction();
            }
        });
    });
});

// Helper function for connection status
function updateConnectionStatus(status) {
    const statusDot = document.querySelector('.status-dot');
    if (statusDot) {
        if (status === 'connected') {
            statusDot.style.background = '#39ff14';
            statusDot.style.boxShadow = '0 0 10px #39ff14';
            showNotification('SERVER CONNECTION ESTABLISHED', 'success');
        } else {
            statusDot.style.background = '#ff0040';
            statusDot.style.boxShadow = '0 0 10px #ff0040';
        }
    }
}

// ===== EXTERNAL FILE DROP ZONE =====
function initializeExternalDropZone() {
    const fileExplorer = document.querySelector('.file-explorer');
    const fileTree = document.querySelector('.file-tree');
    let dropZone = null;
    let isDraggingFiles = false;
    
    // Create drop zone overlay
    function createDropZone() {
        if (dropZone) return dropZone;
        
        dropZone = document.createElement('div');
        dropZone.className = 'external-drop-zone';
        dropZone.innerHTML = `
            <div class="drop-zone-content">
                <i class="fas fa-cloud-upload-alt drop-icon"></i>
                <h2>DROP FILES HERE</h2>
                <p>Drop files or folders to upload</p>
                <div class="drop-zone-border"></div>
            </div>
        `;
        
        // Style the drop zone
        Object.assign(dropZone.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            right: '0',
            bottom: '0',
            backgroundColor: 'rgba(0, 255, 65, 0.1)',
            border: '3px dashed #00ff41',
            display: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: '1000',
            pointerEvents: 'none'
        });
        
        const style = document.createElement('style');
        style.textContent = `
            .external-drop-zone {
                backdrop-filter: blur(5px);
            }
            .drop-zone-content {
                text-align: center;
                color: #00ff41;
                animation: pulse 1.5s infinite;
            }
            .drop-icon {
                font-size: 64px;
                margin-bottom: 20px;
                animation: bounce 1s infinite;
            }
            .drop-zone-content h2 {
                font-size: 24px;
                margin: 10px 0;
                text-shadow: 0 0 20px #00ff41;
            }
            .drop-zone-content p {
                font-size: 14px;
                opacity: 0.8;
            }
            .drop-zone-border {
                position: absolute;
                top: 10px;
                left: 10px;
                right: 10px;
                bottom: 10px;
                border: 2px solid #00ff41;
                border-radius: 10px;
                animation: rotate-border 3s linear infinite;
            }
            @keyframes bounce {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-10px); }
            }
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.8; }
            }
            @keyframes rotate-border {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            .file-tree.drag-over {
                background: rgba(0, 255, 65, 0.05);
                box-shadow: inset 0 0 30px rgba(0, 255, 65, 0.2);
            }
        `;
        document.head.appendChild(style);
        
        fileExplorer.style.position = 'relative';
        fileExplorer.appendChild(dropZone);
        
        return dropZone;
    }
    
    // Check if dragging files from outside
    function isDraggingExternalFiles(event) {
        if (!event.dataTransfer) return false;
        
        const types = event.dataTransfer.types;
        return types.includes('Files') || types.includes('application/x-moz-file');
    }
    
    // Show drop zone
    function showDropZone() {
        if (!dropZone) createDropZone();
        dropZone.style.display = 'flex';
        fileTree.classList.add('drag-over');
        isDraggingFiles = true;
    }
    
    // Hide drop zone
    function hideDropZone() {
        if (dropZone) dropZone.style.display = 'none';
        fileTree.classList.remove('drag-over');
        isDraggingFiles = false;
    }
    
    // Handle drag enter
    document.addEventListener('dragenter', (event) => {
        if (isDraggingExternalFiles(event)) {
            event.preventDefault();
            showDropZone();
        }
    });
    
    // Handle drag over
    document.addEventListener('dragover', (event) => {
        if (isDraggingExternalFiles(event)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
        }
    });
    
    // Handle drag leave
    document.addEventListener('dragleave', (event) => {
        // Only hide if leaving the document
        if (event.clientX === 0 && event.clientY === 0) {
            hideDropZone();
        }
    });
    
    // Handle drop on file explorer
    fileExplorer.addEventListener('drop', async (event) => {
        if (!isDraggingExternalFiles(event)) return;
        
        event.preventDefault();
        event.stopPropagation();
        hideDropZone();
        
        const files = event.dataTransfer.files;
        if (files.length === 0) return;
        
        // Check where the drop occurred
        const dropTarget = event.target.closest('.file-item');
        let targetPath = 'workspace';
        
        if (dropTarget && dropTarget.dataset.isDirectory === 'true') {
            targetPath = dropTarget.dataset.path;
        }
        
        await handleExternalFileDrop(files, targetPath);
    });
    
    // Handle drop on document (to prevent default browser behavior)
    document.addEventListener('drop', (event) => {
        if (isDraggingExternalFiles(event) && !event.defaultPrevented) {
            event.preventDefault();
            hideDropZone();
        }
    });
}

// Handle external files drop
async function handleExternalFileDrop(fileList, targetPath = 'workspace') {
    const files = Array.from(fileList);
    const totalFiles = files.length;
    
    console.log(`[DROP] Dropping ${totalFiles} files to ${targetPath}`);
    showNotification(`UPLOADING ${totalFiles} FILE${totalFiles > 1 ? 'S' : ''}...`, 'info');
    
    // Show progress overlay
    showOperationStatus('UPLOADING FILES', `Processing ${totalFiles} items...`, 0);
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // Process files with progress updates
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const progress = ((i + 1) / totalFiles) * 100;
        
        updateOperationProgress(
            'UPLOADING FILES',
            `${file.name} (${i + 1}/${totalFiles})`,
            progress
        );
        
        try {
            // Check if it's a folder (webkitRelativePath is set for folders)
            if (file.webkitRelativePath) {
                // Handle folder upload
                const relativePath = file.webkitRelativePath;
                const pathParts = relativePath.split('/');
                const folderStructure = pathParts.slice(0, -1).join('/');
                
                // Create folder structure if needed
                if (folderStructure) {
                    await createFolderStructure(targetPath, folderStructure);
                }
                
                // Upload file to correct path
                const uploadPath = `${targetPath}/${folderStructure}`;
                await uploadFileToPath(file, uploadPath, pathParts[pathParts.length - 1]);
            } else {
                // Regular file upload
                await uploadFileToPath(file, targetPath);
            }
            successCount++;
        } catch (error) {
            console.error(`[DROP] Error uploading ${file.name}:`, error);
            errors.push(`${file.name}: ${error.message}`);
            errorCount++;
        }
    }
    
    // Hide progress
    hideOperationStatus();
    
    // Refresh file tree
    await loadFileTree();
    
    // Show results
    if (successCount > 0 && errorCount === 0) {
        showNotification(
            `✓ SUCCESSFULLY UPLOADED ${successCount} FILE${successCount > 1 ? 'S' : ''}`,
            'success'
        );
        playHackerSound('success');
    } else if (errorCount > 0) {
        showNotification(
            `UPLOAD COMPLETE: ${successCount} SUCCESS, ${errorCount} FAILED`,
            'warning'
        );
        
        // Show detailed errors
        if (errors.length > 0) {
            setTimeout(() => {
                errors.forEach(err => showNotification(err, 'error'));
            }, 1000);
        }
    }
}

// Upload file to specific path
async function uploadFileToPath(file, targetPath, customName = null) {
    const formData = new FormData();
    formData.append('file', file, customName || file.name);
    formData.append('path', targetPath);
    
    const response = await fetch('/api/file/upload', {
        method: 'POST',
        body: formData
    });
    
    if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Upload failed');
    }
    
    return response.json();
}

// Create folder structure for nested uploads
async function createFolderStructure(basePath, folderPath) {
    const folders = folderPath.split('/');
    let currentPath = basePath;
    
    for (const folder of folders) {
        if (!folder) continue;
        
        currentPath = `${currentPath}/${folder}`;
        
        try {
            await fetch('/api/directory/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: currentPath })
            });
        } catch (error) {
            console.log(`[DROP] Folder might already exist: ${currentPath}`);
        }
    }
}

// Update operation progress
function updateOperationProgress(title, detail, progress) {
    const statusContent = document.querySelector('.status-content');
    if (statusContent) {
        const titleEl = statusContent.querySelector('.operation-title');
        const detailEl = statusContent.querySelector('.operation-detail');
        const progressFill = statusContent.querySelector('.progress-fill');
        
        if (titleEl) titleEl.textContent = title;
        if (detailEl) detailEl.textContent = detail;
        if (progressFill) progressFill.style.width = `${progress}%`;
    }
}

// Also add support for folder selection in the file input
document.addEventListener('DOMContentLoaded', function() {
    const uploadInput = document.getElementById('upload-input');
    if (uploadInput) {
        // Add webkitdirectory attribute for folder support
        uploadInput.setAttribute('webkitdirectory', '');
        uploadInput.setAttribute('directory', '');
        uploadInput.setAttribute('mozdirectory', '');
        
        // Add a second input for files only
        const fileOnlyInput = document.createElement('input');
        fileOnlyInput.type = 'file';
        fileOnlyInput.id = 'file-only-input';
        fileOnlyInput.multiple = true;
        fileOnlyInput.style.display = 'none';
        document.body.appendChild(fileOnlyInput);
        
        // Update upload button to show options
        const uploadBtn = document.getElementById('upload-btn');
        if (uploadBtn) {
            uploadBtn.addEventListener('click', (e) => {
                e.preventDefault();
                
                // Create a simple menu
                const menu = document.createElement('div');
                menu.className = 'upload-menu';
                menu.style.cssText = `
                    position: absolute;
                    background: #000;
                    border: 1px solid #00ff41;
                    border-radius: 5px;
                    padding: 5px 0;
                    z-index: 1000;
                    box-shadow: 0 0 20px rgba(0, 255, 65, 0.5);
                `;
                
                menu.innerHTML = `
                    <div class="upload-option" onclick="document.getElementById('file-only-input').click(); this.parentElement.remove();" style="padding: 10px 20px; cursor: pointer; color: #00ff41;">
                        <i class="fas fa-file"></i> Upload Files
                    </div>
                    <div class="upload-option" onclick="document.getElementById('upload-input').click(); this.parentElement.remove();" style="padding: 10px 20px; cursor: pointer; color: #00ff41;">
                        <i class="fas fa-folder"></i> Upload Folder
                    </div>
                `;
                
                const rect = uploadBtn.getBoundingClientRect();
                menu.style.left = rect.left + 'px';
                menu.style.top = rect.bottom + 5 + 'px';
                
                document.body.appendChild(menu);
                
                // Remove menu on click outside
                setTimeout(() => {
                    document.addEventListener('click', function removeMenu() {
                        menu.remove();
                        document.removeEventListener('click', removeMenu);
                    });
                }, 100);
            });
        }
        
        // Handle file-only input
        fileOnlyInput.addEventListener('change', handleFileUpload);
    }
});
