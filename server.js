const express = require('express');
const https = require('https');
const fs = require('fs');
const socketIo = require('socket.io');
const dotenv = require('dotenv');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const sharedSession = require('express-socket.io-session');
const sqlite3 = require('sqlite3').verbose();
const mime = require('mime'); // Add mime library for file type validation

// Load environment variables
dotenv.config();

const app = express();

// SSL certificate paths
const sslOptions = {
  key: fs.readFileSync('/etc/letsencrypt/live/chat.id1.ir/privkey.pem', 'utf8'),
  cert: fs.readFileSync('/etc/letsencrypt/live/chat.id1.ir/fullchain.pem', 'utf8')
};

const server = https.createServer(sslOptions, app);
const io = socketIo(server, {
  transports: ['websocket', 'polling'] // Ensure WebSocket and polling are both enabled
});

const sessionMiddleware = session({
  store: new SQLiteStore(),
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
});

// Use session middleware
app.use(sessionMiddleware);

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Allowed file types
const allowedFileTypes = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/ogg', 'application/pdf'];

// ایجاد دیتابیس SQLite
const db = new sqlite3.Database('./chat.db', (err) => {
  if (err) {
    console.error('Failed to connect to SQLite database', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// ایجاد جداول
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT,
    message TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT,
    fileName TEXT,
    fileData TEXT,
    fileType TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// ذخیره پیام‌ها در دیتابیس
function saveMessage(nickname, message) {
  db.run(`INSERT INTO messages (nickname, message) VALUES (?, ?)`, [nickname, message], (err) => {
    if (err) {
      console.error('Failed to save message', err);
    }
  });
}

// ذخیره فایل‌ها در دیتابیس
function saveFile(nickname, fileName, fileData, fileType) {
  db.run(`INSERT INTO files (nickname, fileName, fileData, fileType) VALUES (?, ?, ?, ?)`, [nickname, fileName, fileData, fileType], (err) => {
    if (err) {
      console.error('Failed to save file', err);
    }
  });
}

// Function to check if the provided username and password are valid
function isValidUser(username, password) {
  for (let i = 1; process.env[`USER_${i}`]; i++) {
    if (process.env[`USER_${i}`] === username && process.env[`PASSWORD_${i}`] === password) {
      return process.env[`NICKNAME_${i}`];
    }
  }
  return null;
}

// Basic authentication middleware
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const nickname = isValidUser(username, password);
  if (nickname) {
    req.session.loggedIn = true;
    req.session.username = username;
    req.session.nickname = nickname;
    res.send({ success: true, nickname });
  } else {
    res.send({ success: false });
  }
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve favicon.ico
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

// Endpoint to get the socket server URL from environment variables
app.get('/get-socket-server-url', (req, res) => {
  res.json({ url: process.env.SOCKET_SERVER_URL });
});

// Endpoint برای دریافت فایل‌ها
app.get('/get-files', (req, res) => {
  db.all(`SELECT nickname, fileName, fileData, fileType, timestamp FROM files ORDER BY timestamp ASC`, [], (err, rows) => {
    if (err) {
      res.status(500).send({ success: false, error: 'Failed to retrieve files' });
    } else {
      res.send({ success: true, files: rows });
    }
  });
});

// Endpoint برای دریافت پیام‌ها
app.get('/get-messages', (req, res) => {
  db.all(`SELECT nickname, message, timestamp FROM messages ORDER BY timestamp ASC`, [], (err, rows) => {
    if (err) {
      res.status(500).send({ success: false, error: 'Failed to retrieve messages' });
    } else {
      res.send({ success: true, messages: rows });
    }
  });
});

// Share session with Socket.io
io.use(sharedSession(sessionMiddleware, {
  autoSave: true
}));

// Socket.io connection
io.on('connection', (socket) => {
  if (!socket.handshake.session.loggedIn) {
    socket.disconnect();
    return;
  }

  console.log('User connected');

  socket.on('chat message', (data) => {
    saveMessage(data.nickname, data.message);
    io.emit('chat message', { nickname: data.nickname, message: data.message });
  });

  socket.on('file upload', (data) => {
    const fileType = mime.getType(data.fileName);
    if (!allowedFileTypes.includes(fileType)) {
      socket.emit('file upload error', { message: 'File type not allowed' });
      return;
    }

    saveFile(data.nickname, data.fileName, data.file, fileType);
    io.emit('file upload', { nickname: data.nickname, fileName: data.fileName, file: data.file, fileType: fileType });
  });

  socket.on('clear messages', () => {
    db.run(`DELETE FROM messages`, (err) => {
      if (err) {
        console.error('Failed to clear messages', err);
      }
      db.run(`DELETE FROM files`, (err) => {
        if (err) {
          console.error('Failed to clear files', err);
        }
        io.emit('clear messages');
      });
    });
  });

  socket.on('typing', (data) => {
    socket.broadcast.emit('typing', data);
  });

  socket.on('stop typing', (data) => {
    socket.broadcast.emit('stop typing', data);
  });

  socket.on('file sending', (data) => {
    socket.broadcast.emit('file sending', data);
  });

  socket.on('stop file sending', (data) => {
    socket.broadcast.emit('stop file sending', data);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});