const crypto = require('node:crypto');
const { URL } = require('node:url');
const { verifyToken } = require('./auth');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeFrame(opcode, payloadBuf) {
  const len = payloadBuf.length;
  let header;
  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payloadBuf]);
}

function createWsHub({ db, dataDir }) {
  const clientsByUser = new Map();
  const allClients = new Set();
  const voiceRooms = new Map();

  function sendRaw(client, opcode, payload) {
    if (!client.socket.writable || client.closed) return;
    const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
    try {
      client.socket.write(encodeFrame(opcode, buf));
    } catch {
      cleanupClient(client);
    }
  }

  function sendJson(client, event, data) {
    sendRaw(client, 0x1, JSON.stringify({ event, data }));
  }

  function broadcastAll(event, data) {
    const packet = JSON.stringify({ event, data });
    for (const client of allClients) sendRaw(client, 0x1, packet);
  }

  function broadcastToUsers(userIds, event, data) {
    const packet = JSON.stringify({ event, data });
    const seen = new Set();
    for (const uid of userIds) {
      if (seen.has(uid)) continue;
      seen.add(uid);
      const set = clientsByUser.get(uid);
      if (!set) continue;
      for (const client of set) sendRaw(client, 0x1, packet);
    }
  }

  function getVoiceStateSnapshot() {
    const snapshot = {};
    for (const [channelId, participants] of voiceRooms.entries()) {
      if (participants.size > 0) snapshot[channelId] = Array.from(participants.values());
    }
    return snapshot;
  }

  function removeUserFromVoice(userId) {
    let changed = false;
    for (const [channelId, participants] of voiceRooms.entries()) {
      if (participants.delete(userId)) {
        changed = true;
        if (participants.size === 0) voiceRooms.delete(channelId);
      }
    }
    if (changed) broadcastAll('voice:state', getVoiceStateSnapshot());
  }

  function cleanupClient(client) {
    if (client.closed) return;
    client.closed = true;
    allClients.delete(client);
    const set = clientsByUser.get(client.userId);
    if (set) {
      set.delete(client);
      if (set.size === 0) {
        clientsByUser.delete(client.userId);
        removeUserFromVoice(client.userId);
        const row = db.prepare('SELECT is_bot FROM users WHERE id = ?').get(client.userId);
        if (row && !row.is_bot) {
          db.prepare("UPDATE users SET presence = 'offline' WHERE id = ?").run(client.userId);
          broadcastAll('presence:update', { userId: client.userId, presence: 'offline' });
        }
      }
    }
    try { client.socket.destroy(); } catch {}
  }

  function handleClientMessage(client, text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    const { event, data = {} } = msg;

    if (event === 'ping') {
      sendJson(client, 'pong', { ts: Date.now() });
      return;
    }

    if (event === 'typing:start' || event === 'typing:stop') {
      const { scopeType, scopeId } = data;
      if (!scopeType || !scopeId) return;
      const user = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(client.userId);
      const payload = { scopeType, scopeId, userId: client.userId, displayName: user ? user.display_name : 'Someone' };
      if (scopeType === 'channel') {
        const ch = db.prepare('SELECT server_id FROM channels WHERE id = ?').get(scopeId);
        if (!ch) return;
        const members = db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(ch.server_id);
        broadcastToUsers(members.map((m) => m.user_id).filter((id) => id !== client.userId), event, payload);
      } else if (scopeType === 'dm') {
        const dm = db.prepare('SELECT user_a, user_b FROM dm_threads WHERE id = ?').get(scopeId);
        if (!dm) return;
        broadcastToUsers([dm.user_a, dm.user_b].filter((id) => id !== client.userId), event, payload);
      }
      return;
    }

    if (event === 'voice:join') {
      const { channelId, muted = false, deafened = false, camera = false } = data;
      if (!channelId) return;
      for (const [cid, participants] of voiceRooms.entries()) {
        participants.delete(client.userId);
        if (participants.size === 0) voiceRooms.delete(cid);
      }
      if (!voiceRooms.has(channelId)) voiceRooms.set(channelId, new Map());
      voiceRooms.get(channelId).set(client.userId, {
        userId: client.userId,
        muted: Boolean(muted),
        deafened: Boolean(deafened),
        camera: Boolean(camera),
        speaking: false
      });
      broadcastAll('voice:state', getVoiceStateSnapshot());
      return;
    }

    if (event === 'voice:leave') {
      removeUserFromVoice(client.userId);
      return;
    }

    if (event === 'voice:update') {
      const { muted, deafened, camera, speaking } = data;
      let changed = false;
      for (const participants of voiceRooms.values()) {
        const current = participants.get(client.userId);
        if (current) {
          if (typeof muted === 'boolean') current.muted = muted;
          if (typeof deafened === 'boolean') current.deafened = deafened;
          if (typeof camera === 'boolean') current.camera = camera;
          if (typeof speaking === 'boolean') current.speaking = speaking;
          changed = true;
        }
      }
      if (changed) broadcastAll('voice:state', getVoiceStateSnapshot());
    }
  }

  function attachBufferParser(client) {
    let buffer = Buffer.alloc(0);
    let fragmentedChunks = [];
    let fragmentedOpcode = 0;

    client.socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const b0 = buffer[0];
        const b1 = buffer[1];
        const fin = (b0 & 0x80) !== 0;
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let payloadLen = b1 & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
          if (buffer.length < 4) break;
          payloadLen = buffer.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (buffer.length < 10) break;
          payloadLen = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }

        const maskBytes = masked ? 4 : 0;
        if (buffer.length < offset + maskBytes + payloadLen) break;

        let payload = buffer.subarray(offset + maskBytes, offset + maskBytes + payloadLen);
        if (masked) {
          const maskKey = buffer.subarray(offset, offset + 4);
          const unmasked = Buffer.allocUnsafe(payloadLen);
          for (let i = 0; i < payloadLen; i++) unmasked[i] = payload[i] ^ maskKey[i % 4];
          payload = unmasked;
        }

        buffer = buffer.subarray(offset + maskBytes + payloadLen);

        if (opcode === 0x8) {
          sendRaw(client, 0x8, Buffer.alloc(0));
          cleanupClient(client);
          return;
        }
        if (opcode === 0x9) { sendRaw(client, 0xA, payload); continue; }
        if (opcode === 0xA) continue;

        if (opcode === 0x1 || opcode === 0x2) {
          if (fin) {
            if (opcode === 0x1) handleClientMessage(client, payload.toString('utf8'));
          } else {
            fragmentedOpcode = opcode;
            fragmentedChunks = [payload];
          }
        } else if (opcode === 0x0 && fragmentedOpcode) {
          fragmentedChunks.push(payload);
          if (fin) {
            const full = Buffer.concat(fragmentedChunks);
            if (fragmentedOpcode === 0x1) handleClientMessage(client, full.toString('utf8'));
            fragmentedChunks = [];
            fragmentedOpcode = 0;
          }
        }
      }
    });

    client.socket.on('close', () => cleanupClient(client));
    client.socket.on('error', () => cleanupClient(client));
  }

  function handleUpgrade(req, socket) {
    const urlObj = new URL(req.url, 'http://localhost');
    if (urlObj.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const token = urlObj.searchParams.get('token');
    const claims = verifyToken(token, dataDir);
    if (!claims || !claims.userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const user = db.prepare('SELECT id, presence FROM users WHERE id = ?').get(claims.userId);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const acceptKey = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
    );

    const client = { id: crypto.randomBytes(6).toString('hex'), userId: user.id, socket, closed: false };
    allClients.add(client);
    if (!clientsByUser.has(user.id)) clientsByUser.set(user.id, new Set());
    clientsByUser.get(user.id).add(client);

    if (user.presence === 'offline') {
      db.prepare("UPDATE users SET presence = 'online' WHERE id = ?").run(user.id);
      broadcastAll('presence:update', { userId: user.id, presence: 'online' });
    }

    attachBufferParser(client);
    sendJson(client, 'hello', { userId: user.id, voiceState: getVoiceStateSnapshot(), onlineCount: clientsByUser.size });
  }

  return {
    handleUpgrade,
    broadcastAll,
    broadcastToUsers,
    getVoiceStateSnapshot,
    getOnlineUserIds: () => Array.from(clientsByUser.keys())
  };
}

module.exports = { createWsHub };
