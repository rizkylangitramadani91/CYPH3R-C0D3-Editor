const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs-extra');
const path = require('path');
const pty = require('node-pty');
const mimeTypes = require('mime-types');
const multer = require('multer');
const archiver = require('archiver');
const unzipper = require('unzipper');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Security Configuration
const AUTH_ENABLED = process.env.AUTH_ENABLED !== 'false';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD_HASH = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'changeme123', 10);
const SESSION_SECRET = process.env.SESSION_SECRET || 'your-super-secret-session-key-change-this';
const IP_WHITELIST = process.env.IP_WHITELIST ? process.env.IP_WHITELIST.split(',').map(ip => ip.trim()) : [];
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5;
const BAN_DURATION = parseInt(process.env.BAN_DURATION) || 15; // minutes

// Track login attempts
const loginAttempts = new Map();

// Fix Socket.IO with proper CORS and transport configuration
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins in development
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'], // Allow both transports
  allowEIO3: true, // Compatibility mode
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  maxHttpBufferSize: 1e8, // 100 MB
  perMessageDeflate: {
    threshold: 1024,
    zlibDeflateOptions: {
      level: 3
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024
    }
  }
});

const PORT = process.env.PORT || 3000;
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(process.cwd(), 'workspace');

// Security Headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for Monaco Editor
  crossOriginEmbedderPolicy: false
}));

// Session Configuration
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true if using HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Rate limiting for login endpoint
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: 'Too many login attempts, please try again later.',
  skipSuccessfulRequests: true
});

// IP Whitelist Middleware
const ipWhitelistMiddleware = (req, res, next) => {
  if (IP_WHITELIST.length > 0) {
    const clientIp = req.ip || req.connection.remoteAddress;
    const isAllowed = IP_WHITELIST.some(allowedIp => 
      clientIp.includes(allowedIp) || clientIp === '::1' && allowedIp === '127.0.0.1'
    );
    
    if (!isAllowed) {
      return res.status(403).json({ error: 'Access denied: IP not whitelisted' });
    }
  }
  next();
};

// Auth Middleware
const authMiddleware = (req, res, next) => {
  if (!AUTH_ENABLED) {
    return next();
  }
  
  // Allow login page and auth endpoints
  if (req.path === '/login.html' || req.path.startsWith('/api/auth/') || 
      req.path === '/favicon.svg' || req.path === '/logo.svg') {
    return next();
  }
  
  // Check if user is authenticated
  if (!req.session || !req.session.authenticated) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Authentication required' });
    } else {
      return res.redirect('/login.html');
    }
  }
  
  next();
};

// Middleware
app.use(express.json());
app.use(ipWhitelistMiddleware);
app.use(express.static('public', {
  setHeaders: (res, path) => {
    // Don't cache HTML files
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));
app.use(authMiddleware);
app.use('/workspace', express.static(WORKSPACE_DIR));
app.use('/libs', express.static(path.join(__dirname, 'public/libs')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    workspace: WORKSPACE_DIR,
    uptime: process.uptime(),
    version: '1.0.0',
    socketio: {
      connected: io.engine.clientsCount,
      transports: ['websocket', 'polling']
    }
  });
});

// Socket.IO test endpoint
app.get('/api/socket-test', (req, res) => {
  res.json({
    socketio_available: true,
    connected_clients: io.engine.clientsCount,
    server_time: Date.now()
  });
});

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = req.body.path || WORKSPACE_DIR;
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage: storage });

// Ensure workspace directory exists
fs.ensureDirSync(WORKSPACE_DIR);

// Authentication Routes
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  const clientIp = req.ip || req.connection.remoteAddress;
  
  // Check if IP is temporarily banned
  const attempts = loginAttempts.get(clientIp);
  if (attempts && attempts.banned && Date.now() < attempts.bannedUntil) {
    const remainingTime = Math.ceil((attempts.bannedUntil - Date.now()) / 60000);
    return res.status(429).json({ 
      error: `Too many failed attempts. Please try again in ${remainingTime} minutes.` 
    });
  }
  
  // Validate credentials
  if (username === ADMIN_USERNAME && bcrypt.compareSync(password, ADMIN_PASSWORD_HASH)) {
    // Success - reset attempts and create session
    loginAttempts.delete(clientIp);
    req.session.authenticated = true;
    req.session.username = username;
    
    res.json({ 
      success: true, 
      message: 'Authentication successful',
      username: username
    });
  } else {
    // Failed attempt
    const currentAttempts = attempts ? attempts.count + 1 : 1;
    
    if (currentAttempts >= MAX_LOGIN_ATTEMPTS) {
      // Ban the IP
      loginAttempts.set(clientIp, {
        count: currentAttempts,
        banned: true,
        bannedUntil: Date.now() + (BAN_DURATION * 60 * 1000)
      });
      
      return res.status(429).json({ 
        error: `Maximum login attempts exceeded. Banned for ${BAN_DURATION} minutes.` 
      });
    } else {
      // Track failed attempt
      loginAttempts.set(clientIp, {
        count: currentAttempts,
        banned: false
      });
      
      const remainingAttempts = MAX_LOGIN_ATTEMPTS - currentAttempts;
      res.status(401).json({ 
        error: 'Invalid credentials',
        remainingAttempts: remainingAttempts
      });
    }
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

app.get('/api/auth/status', (req, res) => {
  res.json({
    authenticated: req.session && req.session.authenticated,
    username: req.session ? req.session.username : null,
    authEnabled: AUTH_ENABLED
  });
});

// Routes

// Get file tree
app.get('/api/files', async (req, res) => {
  try {
    const dirPath = req.query.path || WORKSPACE_DIR;
    const files = await fs.readdir(dirPath);
    const fileList = [];

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = await fs.stat(filePath);
      fileList.push({
        name: file,
        path: filePath,
        relativePath: path.relative(WORKSPACE_DIR, filePath),
        isDirectory: stats.isDirectory(),
        size: stats.size,
        modified: stats.mtime
      });
    }

    res.json(fileList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Read file content
app.get('/api/file/read', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    const content = await fs.readFile(filePath, 'utf8');
    const mimeType = mimeTypes.lookup(filePath) || 'text/plain';
    
    res.json({
      content,
      mimeType,
      filename: path.basename(filePath)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Write file content
app.post('/api/file/write', async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create directory
app.post('/api/directory/create', async (req, res) => {
  try {
    const { path: dirPath } = req.body;
    if (!dirPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    await fs.ensureDir(dirPath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete file or directory
app.delete('/api/file', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    await fs.remove(filePath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rename file or directory
app.put('/api/file/rename', async (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
      return res.status(400).json({ error: 'Both oldPath and newPath are required' });
    }

    await fs.move(oldPath, newPath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload file
app.post('/api/file/upload', upload.single('file'), (req, res) => {
  try {
    res.json({ 
      success: true, 
      filename: req.file.filename,
      path: req.file.path
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Download file
app.get('/api/file/download', (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.download(filePath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create ZIP archive
app.post('/api/file/zip', async (req, res) => {
  try {
    console.log('[ZIP] Request received:', req.body);
    
    const { files, zipName } = req.body;
    if (!files || !Array.isArray(files) || files.length === 0) {
      console.log('[ZIP] Error: No files provided');
      return res.status(400).json({ error: 'Files array is required' });
    }

    const zipPath = path.join(WORKSPACE_DIR, zipName || 'archive.zip');
    console.log('[ZIP] Creating archive at:', zipPath);
    
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    // Handle archive events
    archive.on('error', (err) => {
      console.error('[ZIP] Archive error:', err);
      throw err;
    });

    archive.on('warning', (err) => {
      console.warn('[ZIP] Archive warning:', err);
    });

    archive.pipe(output);

    // Add files to archive
    for (const filePath of files) {
      console.log('[ZIP] Processing file:', filePath);
      
      // Handle both absolute and relative paths
      let fullPath;
      if (path.isAbsolute(filePath)) {
        fullPath = filePath;
      } else {
        // Remove 'workspace/' prefix if it exists to avoid duplication
        const cleanPath = filePath.startsWith('workspace/') ? filePath.substring('workspace/'.length) : filePath;
        fullPath = path.join(WORKSPACE_DIR, cleanPath);
      }
      
      console.log('[ZIP] Clean path:', filePath, '→', fullPath);
      
      if (!fs.existsSync(fullPath)) {
        console.log('[ZIP] File does not exist, skipping:', fullPath);
        continue;
      }

      const stats = await fs.stat(fullPath);
      const relativePath = path.relative(WORKSPACE_DIR, fullPath);
      
      console.log('[ZIP] Adding to archive:', relativePath);
      
      if (stats.isDirectory()) {
        archive.directory(fullPath, relativePath);
      } else {
        archive.file(fullPath, { name: relativePath });
      }
    }

    console.log('[ZIP] Finalizing archive...');
    await archive.finalize();

    // Wait for stream to finish
    await new Promise((resolve, reject) => {
      output.on('close', () => {
        console.log('[ZIP] Archive created successfully, size:', archive.pointer());
        resolve();
      });
      output.on('error', (err) => {
        console.error('[ZIP] Output stream error:', err);
        reject(err);
      });
    });

    res.json({ 
      success: true, 
      zipPath: zipPath,
      size: archive.pointer()
    });
  } catch (error) {
    console.error('[ZIP] Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Extract ZIP archive
app.post('/api/file/unzip', async (req, res) => {
  try {
    const { zipPath, extractTo } = req.body;
    if (!zipPath) {
      return res.status(400).json({ error: 'Zip path is required' });
    }

    const fullZipPath = path.resolve(zipPath);
    const extractPath = extractTo ? path.resolve(extractTo) : path.dirname(fullZipPath);

    if (!fs.existsSync(fullZipPath)) {
      return res.status(404).json({ error: 'Zip file not found' });
    }

    await fs.ensureDir(extractPath);

    // Extract zip file
    await new Promise((resolve, reject) => {
      fs.createReadStream(fullZipPath)
        .pipe(unzipper.Extract({ path: extractPath }))
        .on('close', resolve)
        .on('error', reject);
    });

    res.json({ 
      success: true, 
      extractPath: extractPath
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Move file or directory
app.put('/api/file/move', async (req, res) => {
  try {
    const { sourcePath, targetPath } = req.body;
    if (!sourcePath || !targetPath) {
      return res.status(400).json({ error: 'Source and target paths are required' });
    }

    const fullSourcePath = path.resolve(sourcePath);
    const fullTargetPath = path.resolve(targetPath);

    if (!fs.existsSync(fullSourcePath)) {
      return res.status(404).json({ error: 'Source file not found' });
    }

    // Ensure target directory exists
    await fs.ensureDir(path.dirname(fullTargetPath));

    // Move file/directory
    await fs.move(fullSourcePath, fullTargetPath);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Socket.IO for terminal functionality
const terminals = {};
let terminalCounter = 0;

// Performance monitoring
const performanceStats = new Map();

// Buffer pooling for better memory management
const bufferPool = {
  buffers: [],
  maxSize: 50,
  getBuffer: function() {
    return this.buffers.pop() || Buffer.allocUnsafe(65536); // 64KB buffers
  },
  releaseBuffer: function(buffer) {
    if (this.buffers.length < this.maxSize) {
      buffer.fill(0);
      this.buffers.push(buffer);
    }
  }
};

// Socket.IO middleware for debugging
io.use((socket, next) => {
  console.log('[SOCKET] New connection attempt from:', socket.handshake.address);
  console.log('[SOCKET] Transport:', socket.conn.transport.name);
  console.log('[SOCKET] Query:', socket.handshake.query);
  next();
});

io.on('connection', (socket) => {
  console.log('[SOCKET] Client connected:', socket.id);
  console.log('[SOCKET] Transport used:', socket.conn.transport.name);
  
  // Send connection success confirmation
  socket.emit('connection-success', {
    id: socket.id,
    transport: socket.conn.transport.name,
    timestamp: Date.now()
  });
  
  // Initialize terminals for this socket
  terminals[socket.id] = {};

  socket.on('terminal:create', (data) => {
    terminalCounter++;
    const terminalId = `term_${socket.id}_${terminalCounter}`;
    
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    
    // Optimized environment for better performance
    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '1',
      // Performance optimizations
      NODE_ENV: 'production',
      NODE_NO_WARNINGS: '1',
      // Disable some features that slow down terminal
      HOMEBREW_NO_AUTO_UPDATE: '1',
      DISABLE_AUTO_UPDATE: 'true'
    };
    
    // Spawn with optimized settings
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: data.cols || 80,
      rows: data.rows || 24,
      cwd: WORKSPACE_DIR,
      env: env,
      encoding: null // Use buffer mode for better performance
    });
    
    // Note: Setting process priority requires elevated privileges
    // Removed renice command to avoid permission errors

    // Performance tracking for this terminal
    performanceStats.set(terminalId, {
      bytesTransferred: 0,
      messagesCount: 0,
      startTime: Date.now()
    });

    terminals[socket.id][terminalId] = {
      process: ptyProcess,
      clientTerminalId: data.terminalId,
      buffer: [], // Buffer for batching data
      bufferTimer: null
    };

    // Optimized data handler with batching
    const terminalData = terminals[socket.id][terminalId];
    
    // Performance: Use a more efficient buffer strategy
    let dataBuffer = [];
    let bufferSize = 0;
    const MAX_BUFFER_SIZE = 4096; // 4KB chunks
    const BATCH_DELAY = 2; // Reduced from 5ms to 2ms for lower latency
    
    ptyProcess.on('data', (outputData) => {
      const stats = performanceStats.get(terminalId);
      if (stats) {
        stats.bytesTransferred += outputData.length;
        stats.messagesCount++;
      }
      
      // Add to buffer
      dataBuffer.push(outputData);
      bufferSize += outputData.length;
      
      // Clear existing timer
      if (terminalData.bufferTimer) {
        clearTimeout(terminalData.bufferTimer);
        terminalData.bufferTimer = null;
      }
      
      // Send immediately if buffer is large enough
      if (bufferSize >= MAX_BUFFER_SIZE) {
        sendBufferedData();
      } else {
        // Otherwise batch with very short delay
        terminalData.bufferTimer = setTimeout(sendBufferedData, BATCH_DELAY);
      }
    });
    
    // Optimized send function
    function sendBufferedData() {
      if (dataBuffer.length > 0) {
        // Combine all buffered data efficiently
        const combinedData = dataBuffer.length === 1 
          ? dataBuffer[0] 
          : Buffer.concat(dataBuffer);
        
        // Reset buffer
        dataBuffer = [];
        bufferSize = 0;
        
        // Send with binary transport for speed (Socket.IO v4 handles binary automatically)
        socket.emit('terminal:data', {
          terminalId: terminalId,
          data: combinedData,
          binary: true
        });
      }
    }
    
    // Force initial prompt by sending empty command
    setTimeout(() => {
      ptyProcess.write('\n');
    }, 200);
    
    // Send another newline if no prompt after 1 second
    setTimeout(() => {
      ptyProcess.write('echo "Terminal Ready"\n');
    }, 1000);

    // Send performance stats periodically
    const statsInterval = setInterval(() => {
      const stats = performanceStats.get(terminalId);
      if (stats) {
        const runtime = Date.now() - stats.startTime;
        const throughput = stats.bytesTransferred / (runtime / 1000); // bytes per second
        
        socket.emit('terminal:stats', {
          terminalId: terminalId,
          throughput: Math.round(throughput),
          messages: stats.messagesCount,
          runtime: runtime
        });
      }
    }, 5000); // Send stats every 5 seconds

    ptyProcess.on('exit', (code) => {
      console.log(`Terminal ${terminalId} exited with code ${code}`);
      
      // Clean up performance tracking
      performanceStats.delete(terminalId);
      clearInterval(statsInterval);
      
      if (terminals[socket.id] && terminals[socket.id][terminalId]) {
        delete terminals[socket.id][terminalId];
      }
      socket.emit('terminal:exit', {
        terminalId: terminalId,
        code: code
      });
    });

    // Send confirmation to client
    socket.emit('terminal:created', {
      terminalId: terminalId,
      clientTerminalId: data.terminalId
    });
  });

  socket.on('terminal:data', (data) => {
    if (terminals[socket.id] && terminals[socket.id][data.terminalId]) {
      terminals[socket.id][data.terminalId].process.write(data.data);
    }
  });

  socket.on('terminal:resize', (data) => {
    if (terminals[socket.id] && terminals[socket.id][data.terminalId]) {
      terminals[socket.id][data.terminalId].process.resize(data.cols, data.rows);
    }
  });

  socket.on('terminal:close', (data) => {
    if (terminals[socket.id] && terminals[socket.id][data.terminalId]) {
      terminals[socket.id][data.terminalId].process.kill();
      delete terminals[socket.id][data.terminalId];
      socket.emit('terminal:closed', {
        terminalId: data.terminalId
      });
    }
  });

  // Ping handler for latency measurement
  socket.on('ping', (callback) => {
    if (typeof callback === 'function') {
      callback();
    }
  });
  
  socket.on('disconnect', () => {
    console.log('[SOCKET] Client disconnected:', socket.id);
    
    // Clean up all terminals for this socket
    if (terminals[socket.id]) {
      Object.values(terminals[socket.id]).forEach(terminal => {
        terminal.process.kill();
      });
      delete terminals[socket.id];
    }
  });
});

// Handle Socket.IO errors
io.on('connect_error', (error) => {
  console.error('[SOCKET] Connection error:', error.message);
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Workspace directory: ${WORKSPACE_DIR}`);
});

module.exports = { app, server }; 