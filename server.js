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

// Load environment variables
dotenv.config();

const app = express();

// SSL certificate paths
const sslOptions = {
  key: fs.readFileSync('/etc/letsencrypt/live/chat.id1.ir/privkey.pem', 'utf8'),
  cert: fs.readFileSync('/etc/letsencrypt/live/chat.id1.ir/fullchain.pem', 'utf8')
};

const server = https.createServer(sslOptions, app);
const io = socketIo(server);

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
function saveFile(nickname, fileName, fileData) {
  db.run(`INSERT INTO files (nickname, fileName, fileData) VALUES (?, ?, ?)`, [nickname, fileName, fileData], (err) => {
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

// Endpoint to get the socket server URL from environment variables
app.get('/get-socket-server-url', (req, res) => {
  res.json({ url: process.env.SOCKET_SERVER_URL });
});

// Endpoint برای دریافت فایل‌ها
app.get('/get-files', (req, res) => {
  db.all(`SELECT nickname, fileName, fileData, timestamp FROM files ORDER BY timestamp ASC`, [], (err, rows) => {
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
    saveFile(data.nickname, data.fileName, data.file);
    io.emit('file upload', { nickname: data.nickname, fileName: data.fileName, file: data.file });
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

  socket.on('get users', () => {
    const users = [];
    for (const [id, socket] of io.of('/').sockets) {
      if (socket.handshake.session.loggedIn) {
        users.push(socket.handshake.session.nickname);
      }
    }
    io.emit('user list', users);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});