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
const mime = require('mime-types');
const fileUpload = require('express-fileupload');

dotenv.config();

const app = express();

// SSL certificate paths
const sslOptions = {
    key: fs.readFileSync('/etc/letsencrypt/live/chat.id1.ir/privkey.pem', 'utf8'),
    cert: fs.readFileSync('/etc/letsencrypt/live/chat.id1.ir/fullchain.pem', 'utf8')
};

const server = https.createServer(sslOptions, app);
const io = socketIo(server, {
    maxHttpBufferSize: 1e8,
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

const sessionMiddleware = session({
    store: new SQLiteStore(),
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
});

app.use(sessionMiddleware);
app.use(fileUpload({
    limits: { fileSize: 20 * 1024 * 1024 }, // Increase limit to 20MB or adjust as needed
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const allowedFileTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/mpeg',
    'audio/mp3',
    'audio/ogg',
    'application/pdf'
];

const db = new sqlite3.Database('./chat.db', (err) => {
    if (err) {
        console.error('Failed to connect to SQLite database', err);
    } else {
        console.log('Connected to SQLite database');
    }
});

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
        filePath TEXT, // Store file path instead of data
        fileType TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

db.serialize(() => {
    db.run(`ALTER TABLE files ADD COLUMN fileType TEXT`, (err) => {
        if (err) {
            if (err.message.includes("duplicate column name")) {
                console.log("Column 'fileType' already exists.");
            } else {
                console.error('Failed to add column fileType to files table', err);
            }
        } else {
            console.log("Column 'fileType' added to files table.");
        }
    });
});

function saveMessage(nickname, message) {
    db.run(`INSERT INTO messages (nickname, message) VALUES (?, ?)`, [nickname, message], (err) => {
        if (err) {
            console.error('Failed to save message', err);
        }
    });
}

// Modified saveFile function to store file path
function saveFile(nickname, fileName, filePath, fileType) {
    db.run(`INSERT INTO files (nickname, fileName, filePath, fileType) VALUES (?, ?, ?, ?)`, [nickname, fileName, filePath, fileType], (err) => {
        if (err) {
            console.error('Failed to save file path', err);
        }
    });
}

function isValidUser(username, password) {
    for (let i = 1; process.env[`USER_${i}`]; i++) {
        if (process.env[`USER_${i}`] === username && process.env[`PASSWORD_${i}`] === password) {
            return process.env[`NICKNAME_${i}`];
        }
    }
    return null;
}

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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

app.get('/get-socket-server-url', (req, res) => {
    res.json({ url: process.env.SOCKET_SERVER_URL });
});

app.get('/get-files', (req, res) => {
    db.all(`SELECT nickname, fileName, filePath, fileType, timestamp FROM files ORDER BY timestamp ASC`, [], (err, rows) => { //changed fileData to filePath
        if (err) {
            res.status(500).send({ success: false, error: 'Failed to retrieve files' });
        } else {
            res.send({ success: true, files: rows });
        }
    });
});

app.get('/get-messages', (req, res) => {
    db.all(`SELECT nickname, message, timestamp FROM messages ORDER BY timestamp ASC`, [], (err, rows) => {
        if (err) {
            res.status(500).send({ success: false, error: 'Failed to retrieve messages' });
        } else {
            res.send({ success: true, messages: rows });
        }
    });
});

io.use(sharedSession(sessionMiddleware, {
    autoSave: true
}));

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

    // Handle file upload using express-fileupload
    app.post('/upload', (req, res) => {
        if (!req.files || !req.files.file) {
            return res.status(400).send('No files were uploaded.');
        }

        const file = req.files.file;
        const nickname = socket.handshake.session.nickname; // Get nickname from session
        const fileType = mime.lookup(file.name);

        if (!allowedFileTypes.includes(fileType)) {
            return res.status(400).send('File type not allowed.');
        }

        const fileName = file.name;
        const filePath = path.join(__dirname, 'uploads', fileName); // Store in 'uploads' directory

        // Use mv() to place the file somewhere on your server
        file.mv(filePath, (err) => {
            if (err) {
                console.error(err);
                return res.status(500).send(err);
            }

            // Save file path to database
            saveFile(nickname, fileName, filePath, fileType);

            // Emit file upload success to the specific socket that uploaded the file
            socket.emit('file upload success', {
                nickname: nickname,
                fileName: fileName,
                filePath: filePath, // Send the file path
                fileType: fileType
            });

            // Emit the file upload to all connected sockets (including the sender)
            io.emit('file uploaded', {  // Changed event name to 'file uploaded'
                nickname: nickname,
                fileName: fileName,
                filePath: filePath,  // Send the file path
                fileType: fileType
            });
            res.send('File uploaded successfully'); //send response to client
        });
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

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});