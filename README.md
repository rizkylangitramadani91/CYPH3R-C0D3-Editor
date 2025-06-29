# CYPH3R C0D3 - Quantum Code Editor

🚀 **Advanced Cyberpunk Development Environment**

Sebuah quantum-encrypted web-based code editor dengan neural interface yang dilengkapi file manager dan multi-terminal support. CYPH3R C0D3 memberikan pengalaman coding futuristik dengan UI cyberpunk yang memukau, memungkinkan Anda mengedit kode, mengelola file, dan mengakses multiple terminal instances langsung dari browser.

## Fitur

### Core Features
- **Code Editor**: Monaco Editor (VS Code engine) dengan syntax highlighting untuk berbagai bahasa pemrograman
- **File Manager**: Navigasi file dan folder dengan context menu support
- **Multi-Terminal**: Multiple terminal instances dengan tab switching dan session management
- **Multi-tab Editor**: Buka multiple file dalam tab yang berbeda
- **File Operations**: Create, read, update, delete, rename, upload, download file
- **Keyboard Shortcuts**: Comprehensive shortcuts untuk produktivitas maksimal
- **HTML Preview**: Live preview HTML files dengan auto-refresh dan split view mode

### Modern Terminal Features
- **Multi-Terminal Support**: Buka unlimited terminal instances
- **Terminal Tabs**: Switch antar terminal dengan mudah
- **Session Management**: Setiap terminal memiliki session ID unik
- **Auto-Resize**: Terminal otomatis menyesuaikan ukuran container
- **Status Bar**: Informasi real-time tentang terminal (size, encoding, path)
- **Copy/Paste Support**: Ctrl+Shift+C/V untuk copy/paste
- **Clear Terminal**: Ctrl+L untuk clear terminal
- **Visual Effects**: ASCII art welcome message dan color themes

### HTML Preview Features
- **Live Preview**: Real-time preview HTML files tanpa save
- **Auto-Refresh**: Otomatis update preview saat mengedit
- **Split View Mode**: Edit dan preview side-by-side
- **Full Screen Preview**: Toggle antara edit dan preview mode
- **Open in New Tab**: Buka preview di browser tab baru
- **Secure Sandbox**: Preview berjalan dalam iframe sandbox

### Hacker UI Theme
- **Matrix Rain Effect**: Animated background dengan karakter Jepang
- **Cyberpunk Colors**: Lime green (#00ff41) dan neon accents
- **Glitch Effects**: Text animations pada logo
- **System Monitoring**: Live CPU/Memory simulation
- **Digital Clock**: Real-time clock display
- **Session Tracking**: Unique hex session IDs
- **Hacker Notifications**: Styled system messages

## Screenshots

### Main Interface
- File explorer di sebelah kiri
- Code editor di tengah dengan tab support
- Terminal di bagian bawah (dapat di-toggle)

## Prerequisites

- Node.js (v14 atau lebih tinggi)
- npm atau yarn
- Ubuntu atau Linux environment (untuk fitur terminal)

## Installation

1. Clone atau download project ini
2. Install dependencies:
```bash
npm install
```

3. Jalankan aplikasi:
```bash
npm start
```

4. Atau untuk development mode:
```bash
npm run dev
```

5. Buka browser dan akses:
```
http://localhost:3000
```

## Project Structure

```
├── server.js              # Main server file
├── package.json           # Dependencies
├── public/                # Frontend files
│   ├── index.html         # Main HTML
│   ├── styles.css         # CSS styling
│   └── app.js             # Frontend JavaScript
├── workspace/             # Working directory (created automatically)
└── README.md              # This file
```

## API Endpoints

### File Operations
- `GET /api/files` - Get file list
- `GET /api/file/read` - Read file content
- `POST /api/file/write` - Write file content
- `DELETE /api/file` - Delete file
- `PUT /api/file/rename` - Rename file
- `POST /api/file/upload` - Upload file
- `GET /api/file/download` - Download file

### Directory Operations
- `POST /api/directory/create` - Create directory

### WebSocket Events
- `terminal:create` - Create terminal session
- `terminal:data` - Send/receive terminal data
- `terminal:resize` - Resize terminal

## Usage

### Basic Operations

1. **File Management**:
   - Klik file untuk memilih
   - Double-click file untuk membuka di editor
   - Right-click pada file untuk context menu: Execute, Rename, Delete, Download, Properties
   - Right-click pada empty space untuk: New File, New Folder, Upload, Refresh
   - Gunakan tombol di header untuk quick actions

2. **Code Editing**:
   - File akan terbuka di tab baru
   - Tab indicators untuk modified files
   - Syntax highlighting otomatis berdasarkan ekstensi file
   - Real-time cursor position tracking
   - Multiple tab support dengan close buttons

3. **Multi-Terminal**:
   - Terminal berada di footer (dapat di-minimize/maximize)
   - Klik "+" untuk membuat terminal baru
   - Klik pada tab untuk switch antar terminal
   - Setiap terminal memiliki session independen
   - Status bar menampilkan informasi terminal

4. **HTML Preview**:
   - Buka file HTML di editor
   - Klik tombol "Preview" (icon mata) untuk melihat preview
   - Klik tombol "Split View" (icon kolom) untuk mode split screen
   - Preview otomatis refresh saat Anda mengedit kode
   - Gunakan tombol refresh untuk manual refresh
   - Klik "Open in New Tab" untuk membuka di browser tab baru

### Keyboard Shortcuts

#### Editor Shortcuts
- `Ctrl+S` - Save current file
- `Ctrl+N` - Create new file
- `Ctrl+F` - Search in file
- `Esc` - Close modals

#### Terminal Shortcuts
- `Ctrl+` ` - Toggle terminal footer (minimize/maximize)
- `Ctrl+Shift+T` - Create new terminal
- `Ctrl+Shift+C` - Copy selected text
- `Ctrl+Shift+V` - Paste from clipboard
- `Ctrl+L` - Clear current terminal

### Supported File Types

- JavaScript (.js)
- TypeScript (.ts)
- HTML (.html)
- CSS (.css)
- JSON (.json)
- Markdown (.md)
- Python (.py)
- Java (.java)
- C/C++ (.c, .cpp)
- PHP (.php)
- Ruby (.rb)
- Go (.go)
- Rust (.rs)
- Shell (.sh)
- Dan banyak lagi...

## Configuration

### Environment Variables

- `PORT` - Server port (default: 3000)
- `WORKSPACE_DIR` - Working directory path (default: ./workspace)

### Customization

1. **Theme**: Edit `public/styles.css` untuk mengubah tema
2. **Editor Settings**: Modify Monaco Editor config di `public/app.js`
3. **File Icons**: Update `getFileIcon()` function untuk icon custom

## Security Notes

⚠️ **Peringatan**: Aplikasi ini memberikan akses penuh ke filesystem dan terminal. Hanya gunakan di environment yang aman dan terpercaya.

Untuk production:
- Implementasikan authentication
- Batasi akses file ke direktori tertentu
- Sanitize input untuk mencegah command injection
- Gunakan HTTPS
- Implement rate limiting

## Troubleshooting

### Common Issues

1. **Terminal tidak berfungsi**:
   - Pastikan node-pty terinstall dengan benar
   - Check platform compatibility (Linux/macOS)
   - Restart server jika terminal tidak responding
   - Check browser console untuk error messages

2. **Multi-Terminal Issues**:
   - Jika terminal tidak muncul, check WebSocket connection
   - Terminal resize issues: Refresh browser
   - Session timeout: Create new terminal instance

3. **File upload gagal**:
   - Check permissions pada workspace directory
   - Verify multer configuration
   - Check file size limits

4. **Monaco Editor tidak load**:
   - Check internet connection (CDN dependencies)
   - Verify browser compatibility
   - Clear browser cache

5. **UI/Theme Issues**:
   - Matrix rain effect lag: Reduce browser hardware acceleration
   - Font rendering: Install Fira Code font locally

### Dependencies Issues

Jika ada masalah dengan node-pty:
```bash
npm rebuild node-pty
```

Atau gunakan alternatif:
```bash
npm install node-pty --build-from-source
```

## Development

### Adding New Features

1. **New File Types**: Update `detectLanguage()` dan `getFileIcon()` functions
2. **New API Endpoints**: Add routes di `server.js`
3. **UI Components**: Modify HTML/CSS/JS di folder `public/`

### Testing

```bash
# Test server
node server.js

# Test specific endpoints
curl http://localhost:3000/api/files
```

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## License

MIT License - feel free to use for personal and commercial projects.

## Credits

- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - Code editor
- [xterm.js](https://xtermjs.org/) - Terminal emulator
- [Socket.IO](https://socket.io/) - Real-time communication
- [Express.js](https://expressjs.com/) - Web framework
- [node-pty](https://github.com/microsoft/node-pty) - Terminal functionality

## Support

Jika Anda menemukan bug atau memiliki pertanyaan, silakan buat issue di repository ini.

---

**Happy Coding!** 🚀 