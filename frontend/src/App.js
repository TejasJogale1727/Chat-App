// frontend/src/App.js
import React, { useState, useEffect } from "react";
import io from "socket.io-client";
import axios from "axios";
import "./App.css";

const BACKEND = "http://localhost:4000";

function App() {
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [room, setRoom] = useState("general");
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [socket, setSocket] = useState(null);

  // sidebar states & results
  const [searchQ, setSearchQ] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [uploadResult, setUploadResult] = useState(null);
  const [fetchUrl, setFetchUrl] = useState("");
  const [fetchResult, setFetchResult] = useState(null);
  const [createRoomName, setCreateRoomName] = useState("");
  const [createRoomResult, setCreateRoomResult] = useState(null);

  // Connect socket after login
  useEffect(() => {
    if (!token) return;

    const s = io(BACKEND, { auth: { token } });

    const onConnect = () => {
      console.log("ws connected", s.id);
      s.emit("join", { username, room });
    };
    const onMessage = (m) => {
      setMessages((prev) => [...prev, m]);
    };

    s.on("connect", onConnect);
    s.on("message", onMessage);

    setSocket(s);

    return () => {
      s.off("connect", onConnect);
      s.off("message", onMessage);
      if (s && s.connected) s.disconnect();
      setSocket(null);
    };
  }, [token, username, room]);

  // LOGIN
  async function login(e) {
    e && e.preventDefault();
    try {
      const resp = await axios.post(BACKEND + "/api/login", { username }, { withCredentials: true });
      if (resp.data && resp.data.token) {
        setToken(resp.data.token);
      } else {
        alert("Login failed");
      }
    } catch (err) {
      console.error("login err", err);
      alert("Login error");
    }
  }

  // SEND CHAT
  function sendMessage(e) {
    e && e.preventDefault();
    if (!text) return;
    if (socket && socket.connected) {
      socket.emit("send", { room, text });
      setText("");
      return;
    }
    // fallback HTTP send
    axios.post(BACKEND + "/api/messages/send", { room, text, username }, { withCredentials: true })
      .then(() => setText(''))
      .catch(err => console.error('HTTP send err', err));
  }

  // NO-SQL INJECTION (User search)
  async function handleSearch() {
    try {
      // intentionally calling /api/users/search?q=... (lab vulnerable endpoint)
      const resp = await axios.get(BACKEND + "/api/users/search?q=" + encodeURIComponent(searchQ));
      setSearchResult(resp.data);
    } catch (e) {
      console.error(e);
      setSearchResult({ error: String(e) });
    }
  }

  // FILE UPLOAD
  async function handleFileUpload(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      const resp = await axios.post(BACKEND + "/api/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
        withCredentials: true,
      });
      setUploadResult(resp.data);
    } catch (e) {
      console.error(e);
      setUploadResult({ error: String(e) });
    }
  }

  // SSRF - fetch meta (calls backend which fetches remote url)
  async function handleFetchMeta() {
   if(fetchUrl){
    try {
      const resp = await axios.post(BACKEND + "/api/fetchmeta", { url: fetchUrl }, { withCredentials: true });
      setFetchResult(resp.data);
    } catch (e) {
      console.error(e);
      setFetchResult({ error: String(e) });
    }
   }
  }

  // CSRF demo: create room (uses cookie-based auth on backend)
  async function handleCreateRoom(e) {
    e && e.preventDefault();
   if(createRoomName){
    try {
      // IMPORTANT: uses withCredentials to send cookies (lab endpoint relies on cookie token)
      const resp = await axios.post(BACKEND + "/api/rooms/create", { room: createRoomName }, { withCredentials: true });
      setCreateRoomResult(resp.data);
    } catch (e) {
      console.error(e);
      setCreateRoomResult({ error: String(e) });
    }
  }
  }

  // UI: Login screen (include room input)
  if (!token) {
    return (
      <div className="app-container">
        <div className="login-box">
          <h2>🔐 Vulnerable ChatLab</h2>
          <form onSubmit={login}>
            <input placeholder="Enter username" value={username} onChange={e => setUsername(e.target.value)} required />
            <input placeholder="Room (e.g. general)" value={room} onChange={e => setRoom(e.target.value)} required />
            <button type="submit">Join</button>
          </form>
        </div>
      </div>
    );
  }

  // UI: Chat with right sidebar (vulnerable tools)
  return (
    <div className="app-container layout-row">
      <div className="chat-box">
        <header>
          <h2>💬 Room: {room}</h2>
          <div className="subheader">You: <strong>{username}</strong></div>
        </header>

        <div className="messages" id="messages">
          {messages.map((m, i) => (
            <div key={i} className={`message ${m.user === "system" ? "system" : (m.username === username ? "self" : "")}`}>
              <strong>{m.username || m.user}: </strong>
              {/* keep vulnerable render for lab */}
              <span dangerouslySetInnerHTML={{ __html: m.text }} />
            </div>
          ))}
        </div>

        <form className="input-box" onSubmit={sendMessage}>
          <input placeholder="Type a message..." value={text} onChange={e => setText(e.target.value)} />
          <button type="submit">Send</button>
        </form>
      </div>

      <aside className="sidebar">
        <h3>Lab Tools (vulnerable)</h3>

        <section className="tool">
          <h4>User Search (NoSQLi)</h4>
          <input placeholder='Search query (q) e.g. "bob"' value={searchQ} onChange={e => setSearchQ(e.target.value)} />
          <button onClick={handleSearch}>Search</button>
          <pre className="result">{searchResult ? JSON.stringify(searchResult, null, 2) : "No result yet"}</pre>
        </section>

        <section className="tool">
          <h4>Upload File (File injection)</h4>
          <input type="file" onChange={handleFileUpload} />
          <pre className="result">URL:- {uploadResult ? JSON.stringify(uploadResult.accessURL) : "No upload yet"}</pre>
        </section>

        <section className="tool">
          <h4>Fetch Metadata (SSRF)</h4>
          <input placeholder="http://example.local/..." value={fetchUrl} onChange={e => setFetchUrl(e.target.value)} />
          <button onClick={handleFetchMeta}>Fetch</button>
          <pre className="result">{fetchResult ? JSON.stringify(fetchResult, null, 2) : "No result yet"}</pre>
        </section>

        <section className="tool">
          <h4>Create Room (CSRF demo)</h4>
          <form onSubmit={handleCreateRoom}>
            <input placeholder="new room name" value={createRoomName} onChange={e => setCreateRoomName(e.target.value)} />
            <button type="submit">Create Room (cookie)</button>
          </form>
          <pre className="result">{createRoomResult ? JSON.stringify(createRoomResult, null, 2) : "No action yet"}</pre>
        </section>
      </aside>
    </div>
  );
}

export default App;
