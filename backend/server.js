/* backend/server.js
   INTENTIONALLY-VULNERABLE LAB SERVER
   - Only enable vulnerabilities when process.env.LAB_MODE === 'true'
   - DO NOT run with LAB_MODE=true on any public/production system
*/

const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const http = require('http');
const socketio = require('socket.io');
const multer = require('multer');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const cors = require("cors");
const app = express();
const server = http.createServer(app);
const io = socketio(server, { cors: { origin: true, credentials: true }});

require('dotenv').config();

const LAB_MODE =  'true';
const JWT_SECRET =  'labsecret';
const MONGO_URL = 'mongodb://localhost:27017';
const PORT = 4000;


app.use(cors({ origin: "http://localhost:3000", credentials: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('uploads')); // LAB: serve uploads directly (unsafe in prod)

app.use((req,res,next) => {
  // Simple request logger
  console.log(new Date().toISOString(), req.method, req.url, { lab_mode: LAB_MODE });
  next();
});

// --- Mongo setup (simple)
let db;
MongoClient.connect(MONGO_URL, { useUnifiedTopology: true })
  .then(client => {
    db = client.db('chatlab');
    db.collection('users').createIndex({ username: 1 }, { unique: true }).catch(()=>{});
    console.log('Connected to MongoDB');
  })
  .catch(err => { console.error('Mongo connect error', err); process.exit(1); });
/*
// --- JWT auth (lab contains a bypass mode)
function verifyJwt(token) {
  // Intentionally weak in lab if LAB_MODE. In production never accept these patterns.
  try {
    if (LAB_MODE && token === 'LAB-BYPASS-TOKEN') {
      // LAB DEMO: special header/token allows bypass for demo (only in lab)
      return { id: 'lab-bypass-user', username: 'lab' };
    }
    // Real JWT verify
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}
*/
function verifyJwt(token) {
  try {
    const decoded = jwt.decode(token, { complete: true }); // decode without verification
    // UNSAFE: if the JWT header specifies "alg":"none", accept the payload directly
    if (LAB_MODE && decoded.header.alg === 'none') {
      return decoded.payload; // bypass signature check
    }
    return jwt.verify(token, JWT_SECRET); // normal verification
  } catch (e) {
    return null;
  }
}
// Simple auth middleware - used by both REST and Socket handshake
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || req.cookies.token || req.query.token;
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.slice(7);
  else if (authHeader && authHeader.startsWith('LAB-')) token = authHeader; // lab only header format
  else token = authHeader;

  const payload = verifyJwt(token);
  if (!payload) return res.status(401).json({ error: 'unauthenticated' });
  req.user = payload;
  next();
}

// -------- Vulnerable endpoints & lab behaviors

// 1) LOGIN — issues a JWT (trivial)
app.post('/api/login', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).send({ error: 'username required' });
  // In lab mode we auto-create a user record
  await db.collection('users').updateOne({ username }, { $set: { username } }, { upsert: true });
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
  // Put token in cookie (demo cookie-based auth + ws)
  res.cookie('token', token, { httpOnly: false }); // httpOnly false for demonstration (unsafe)
  return res.json({ token });
});

// 2) CSRF-vulnerable room creation (uses cookie auth and lacks CSRF protections in LAB_MODE)
app.post('/api/rooms/create', (req, res) => {
  // NOTE: This endpoint uses cookie-based auth and does NOT check CSRF in lab mode
  const token = req.cookies.token;
  const user = verifyJwt(token);
  if (!user) return res.status(401).json({ error: 'unauthenticated' });

  const { room } = req.body;
  if (!room) return res.status(400).json({ error: 'room required' });

  // Simple room creation
  db.collection('rooms').insertOne({ room, owner: user.username, createdAt: new Date() })
    .then(r => res.json({ ok: true, id: r.insertedId }))
    .catch(err => res.status(500).json({ error: String(err) }));
});

// 3) File upload (lab: stores files in webroot and serves them directly -> FILE INJECTION demo)
const upload = multer({ dest: './uploads/' });
app.post('/api/upload', upload.single('file'), (req, res) => {
  // Vulnerable: stores uploaded files in uploads/ which is served directly via static
  // In production, you must validate filename, disallow executable perms, and store outside webroot.
  console.log('UPLOAD', req.file);
  res.json({ filename: req.file.filename, originalname: req.file.originalname, mimetype: req.file.mimetype, accessURL: 'http://localhost:4000/'+
req.file.filename });
});

// 4) SSRF-like fetch endpoint (fetches arbitrary URLs and returns basic metadata)
// WARNING: In LAB_MODE this is intentionally permissive. We log the resolved host and IP.
const net = require('net');
const dns = require('dns').promises;

app.post('/api/fetchmeta', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  // Resolve hostname to IP and log it (demonstrates SSRF risk)
  try {
    const u = new URL(url);
    const ips = await dns.lookup(u.hostname, { all: true });
    console.log('RESOLVED IPS', u.hostname, ips);
    // LAB: no allowlist enforced here (vulnerable). In real app, check allowlist & block private ranges.
    const resp = await fetch(url, { method: 'GET', timeout: 5000 });
    const contentType = resp.headers.get('content-type') || '';
    const contentLength = resp.headers.get('content-length') || 'unknown';
    return res.json({ ok: true, status: resp.status, contentType, contentLength });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// 5) NoSQL injection demo (vulnerable search; constructs query with user input)
app.get('/api/users/search', async (req, res) => {
  const q = req.query.q || '';
  // INTENTIONALLY VULNERABLE: building a query object directly from user input in lab mode
  // For example, a user could provide JSON that manipulates operators.
  let query;
  try {
    if (LAB_MODE) {
      // LAB: try to parse as JSON (vulnerable if user sends operator fields)
      query = JSON.parse(q);
    } else {
      query = { username: { $regex: q, $options: 'i' } };
    }
  } catch (e) {
    query = { username: { $regex: q, $options: 'i' } };
  }
  const results = await db.collection('users').find(query).limit(50).toArray();
  res.json({ count: results.length, results });
});

// 6) XSS: messages stored and rendered by frontend. Server accepts message text as-is.
app.post('/api/messages/send', async (req, res) => {
  const { room, text, username } = req.body;
  if (!room || !text) return res.status(400).json({ error: 'room and text required' });
  // Note: text is stored raw (lab vulnerable). Frontend may render it dangerously.
  await db.collection('messages').insertOne({ room, text, username: username||'anon', ts: new Date() });
  io.to(room).emit('message', { room, text, username: username||'anon' });
  res.json({ ok: true });
});

// 7) WebSocket handshake: in LAB_MODE we allow insecure handshake; otherwise require Bearer token
io.use((socket, next) => {
  // socket.handshake.auth.token is expected; in lab we optionally accept 'LAB-BYPASS-TOKEN'
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const payload = verifyJwt(token);
  if (!payload) {
    if (LAB_MODE) {
      // LAB: allow connection but mark as unauthenticated (vulnerable)
      socket.labUnauth = true;
      return next();
    }
    return next(new Error('unauthenticated'));
  }
  socket.user = payload;
  next();
});

io.on('connection', (socket) => {
  // Determine a sensible display name for logs/messages
  const initialName = socket.user ? socket.user.username : (socket.labUnauth ? 'lab-unauth' : 'anon');
  console.log('WS connected', { id: socket.id, user: initialName });

  // JOIN handler - record username on socket so we can identify on disconnect
  socket.on("join", ({ username, room }) => {
    // prefer explicit username from join payload, otherwise keep what we already have
    socket.username = username || socket.username || (socket.user ? socket.user.username : (socket.labUnauth ? 'lab-unauth' : 'anon'));
    socket.join(room);
    console.log(`${socket.username} joined room: ${room}`);

    // Notify others in the room
    socket.to(room).emit("message", {
      room: room,
      username: "system",
      text: `${socket.username} has joined the room.`,
    });

    // optional: show sockets in room for debugging
    try {
      const clients = io.sockets.adapter.rooms.get(room);
      console.log(`Clients in room ${room}:`, clients ? Array.from(clients) : []);
    } catch (e) {
      // ignore
    }
  });

  // SEND handler - store & broadcast
  socket.on('send', (data) => {
    // data: { room, text }
    if (!data || !data.room) return;
    const username = socket.username || (socket.user ? socket.user.username : (socket.labUnauth ? 'lab-unauth' : 'anon'));
    db.collection('messages').insertOne({ room: data.room, text: data.text, username, ts: new Date() })
      .catch(err => console.error('DB insert error', err));
    console.log('Received send:', data);
    io.to(data.room).emit('message', { room: data.room, text: data.text, username });
    console.log("Emitting message to room:", data.room, data.text);
  });

  // DISCONNECT handler - broadcast leave message to all joined rooms (except socket.id)
  socket.on("disconnect", (reason) => {
    const leavingName = socket.username || (socket.user ? socket.user.username : (socket.labUnauth ? 'lab-unauth' : 'anon'));
    // socket.rooms is a Set containing rooms the socket is in (including its own id)
    for (const room of socket.rooms) {
      if (room === socket.id) continue; // skip the private socket room
      io.to(room).emit("message", {
	room:room,
        username: "system",
        text: `${leavingName} has left the room.`,
      });
      console.log(`${leavingName} disconnected from room ${room} (${reason})`);
    }

    console.log("Client disconnected:", socket.id, 'reason:', reason);
  });
});


server.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT} (lab_mode=${LAB_MODE})`));
