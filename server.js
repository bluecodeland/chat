const express = require('express');
const https = require('https');
const fs = require('fs');
const socketIo = require('socket.io');
const dotenv = require('dotenv');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const sharedSession = require('express-socket.io-session');

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
    io.emit('chat message', { nickname: data.nickname, message: data.message });
  });

  socket.on('clear messages', () => {
    io.emit('clear messages');
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
