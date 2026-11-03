import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  applyGameAction,
  Coord,
  createInitialGameData,
  GameData,
  Wall,
} from './src/lib/quoridor.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RoomPlayer {
  clientId: string;
  seatIndex: number;
  name: string;
  connected: boolean;
}

interface GameRoom {
  roomId: string;
  roomName: string;
  maxPlayers: 2 | 4;
  status: 'WAITING' | 'PLAYING' | 'FINISHED';
  seats: (RoomPlayer | null)[];
  game: GameData;
  createdAt: number;
}

const rooms = new Map<string, GameRoom>();
const clientSockets = new Map<string, { ws: WebSocket; roomId: string | null }>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function getPublicRoomList() {
  const list: {
    roomId: string;
    roomName: string;
    maxPlayers: 2 | 4;
    currentPlayers: number;
    status: 'WAITING' | 'PLAYING' | 'FINISHED';
  }[] = [];

  rooms.forEach((room) => {
    const activeCount = room.seats.filter((s) => s !== null && s.connected).length;
    if (activeCount > 0) {
      list.push({
        roomId: room.roomId,
        roomName: room.roomName,
        maxPlayers: room.maxPlayers,
        currentPlayers: room.seats.filter((s) => s !== null).length,
        status: room.status,
      });
    }
  });

  return list.sort((a, b) => (a.status === 'WAITING' ? -1 : 1));
}

function broadcastRoomState(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  const payload = JSON.stringify({
    type: 'room:state',
    room: {
      roomId: room.roomId,
      roomName: room.roomName,
      maxPlayers: room.maxPlayers,
      status: room.status,
      seats: room.seats,
      game: room.game,
    },
  });

  clientSockets.forEach((info) => {
    if (info.roomId === roomId && info.ws.readyState === WebSocket.OPEN) {
      info.ws.send(payload);
    }
  });
}

function broadcastLobbyList() {
  const payload = JSON.stringify({
    type: 'lobby:list',
    rooms: getPublicRoomList(),
  });
  clientSockets.forEach((info) => {
    if (info.ws.readyState === WebSocket.OPEN) {
      info.ws.send(payload);
    }
  });
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const PORT = 3000;

  app.use(express.json());

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: getPublicRoomList() });
  });

  // WebSocket Server attached to the HTTP server on port 3000 (on path /ws-game so it never collides with Vite internal sockets)
  const wss = new WebSocketServer({ server: httpServer, path: '/ws-game' });

  wss.on('connection', (ws) => {
    let currentClientId = '';

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'client:hello') {
          currentClientId = String(msg.clientId || Math.random().toString(36).slice(2));
          const existing = clientSockets.get(currentClientId);
          const previousRoomId = existing?.roomId || null;
          clientSockets.set(currentClientId, { ws, roomId: previousRoomId });

          ws.send(
            JSON.stringify({
              type: 'lobby:list',
              rooms: getPublicRoomList(),
            })
          );

          // If reconnecting to an active room, restore presence & sync full state
          const targetRoomId = msg.roomId || previousRoomId;
          if (targetRoomId && rooms.has(targetRoomId)) {
            const r = rooms.get(targetRoomId)!;
            clientSockets.set(currentClientId, { ws, roomId: targetRoomId });
            r.seats.forEach((seat) => {
              if (seat && seat.clientId === currentClientId) {
                seat.connected = true;
              }
            });
            broadcastRoomState(targetRoomId);
          }
          return;
        }

        if (!currentClientId) return;

        if (msg.type === 'lobby:refresh') {
          ws.send(
            JSON.stringify({
              type: 'lobby:list',
              rooms: getPublicRoomList(),
            })
          );
          return;
        }

        if (msg.type === 'room:create') {
          const maxPlayers: 2 | 4 = msg.maxPlayers === 4 ? 4 : 2;
          const playerName = String(msg.playerName || 'Host Player').slice(0, 24);
          const roomName = String(msg.roomName || `${playerName}'s Table`).slice(0, 32);
          const roomId = generateRoomCode();

          const seats: (RoomPlayer | null)[] = Array(maxPlayers).fill(null);
          seats[0] = {
            clientId: currentClientId,
            seatIndex: 0,
            name: playerName,
            connected: true,
          };

          const customNames = seats.map((s, idx) => s?.name || `Seat ${idx + 1}`);
          const game = createInitialGameData(maxPlayers, customNames);

          const newRoom: GameRoom = {
            roomId,
            roomName,
            maxPlayers,
            status: 'WAITING',
            seats,
            game,
            createdAt: Date.now(),
          };

          rooms.set(roomId, newRoom);
          clientSockets.set(currentClientId, { ws, roomId });

          broadcastRoomState(roomId);
          broadcastLobbyList();
          return;
        }

        if (msg.type === 'room:join') {
          const roomId = String(msg.roomId || '').toUpperCase().trim();
          const playerName = String(msg.playerName || 'Challenger').slice(0, 24);
          const room = rooms.get(roomId);

          if (!room) {
            ws.send(
              JSON.stringify({
                type: 'room:error',
                message: `Room "${roomId}" was not found.`,
              })
            );
            return;
          }

          clientSockets.set(currentClientId, { ws, roomId });

          // Check if player already has a seat in this room
          let mySeat = room.seats.find((s) => s && s.clientId === currentClientId);
          if (mySeat) {
            mySeat.connected = true;
            mySeat.name = playerName || mySeat.name;
          } else if (room.status === 'WAITING') {
            const emptyIdx = room.seats.findIndex((s) => s === null);
            if (emptyIdx !== -1) {
              room.seats[emptyIdx] = {
                clientId: currentClientId,
                seatIndex: emptyIdx,
                name: playerName,
                connected: true,
              };
            }
          }

          // Update game player names
          room.seats.forEach((s, idx) => {
            if (s && room.game.players[idx]) {
              room.game.players[idx].name = s.name;
            }
          });

          // Auto-start when all seats fill up
          const filledCount = room.seats.filter((s) => s !== null).length;
          if (room.status === 'WAITING' && filledCount === room.maxPlayers) {
            room.status = 'PLAYING';
          }

          broadcastRoomState(roomId);
          broadcastLobbyList();
          return;
        }

        if (msg.type === 'room:leave') {
          const info = clientSockets.get(currentClientId);
          const roomId = info?.roomId;
          if (roomId && rooms.has(roomId)) {
            const room = rooms.get(roomId)!;
            if (room.status === 'WAITING') {
              room.seats = room.seats.map((s) =>
                s && s.clientId === currentClientId ? null : s
              );
            } else {
              room.seats.forEach((s) => {
                if (s && s.clientId === currentClientId) {
                  s.connected = false;
                }
              });
            }
            info.roomId = null;
            broadcastRoomState(roomId);
            broadcastLobbyList();
          }
          return;
        }

        if (msg.type === 'game:action') {
          const info = clientSockets.get(currentClientId);
          const roomId = info?.roomId;
          if (!roomId || !rooms.has(roomId)) return;

          const room = rooms.get(roomId)!;
          if (room.status !== 'PLAYING') return;

          const currentTurnIdx = room.game.currentTurn;
          const activeSeat = room.seats[currentTurnIdx];
          if (!activeSeat || activeSeat.clientId !== currentClientId) {
            ws.send(
              JSON.stringify({
                type: 'room:error',
                message: 'It is not your turn.',
              })
            );
            return;
          }

          const action = msg.action as
            | { type: 'MOVE'; to: Coord }
            | { type: 'WALL'; wall: Wall };

          const result = applyGameAction(room.game, action);
          if (result.error) {
            ws.send(
              JSON.stringify({
                type: 'room:error',
                message: result.error,
              })
            );
            return;
          }

          room.game = result.nextState;
          if (room.game.winner !== null) {
            room.status = 'FINISHED';
          }

          broadcastRoomState(roomId);
          broadcastLobbyList();
          return;
        }

        if (msg.type === 'game:rematch') {
          const info = clientSockets.get(currentClientId);
          const roomId = info?.roomId;
          if (!roomId || !rooms.has(roomId)) return;

          const room = rooms.get(roomId)!;
          const customNames = room.seats.map(
            (s, idx) => s?.name || `Player ${idx + 1}`
          );
          room.game = createInitialGameData(room.maxPlayers, customNames);
          room.status = 'PLAYING';
          broadcastRoomState(roomId);
          broadcastLobbyList();
          return;
        }
      } catch {
        // Ignore malformed payloads
      }
    });

    ws.on('close', () => {
      if (!currentClientId) return;
      const info = clientSockets.get(currentClientId);
      if (info && info.roomId && rooms.has(info.roomId)) {
        const room = rooms.get(info.roomId)!;
        room.seats.forEach((s) => {
          if (s && s.clientId === currentClientId) {
            s.connected = false;
          }
        });
        broadcastRoomState(info.roomId);
        broadcastLobbyList();
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Quoridor Server running on http://localhost:${PORT}`);
  });
}

startServer();
