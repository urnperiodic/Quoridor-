import React, { useEffect, useRef, useState } from 'react';
import { Peer, DataConnection } from 'peerjs';
import {
  RotateCw,
  Volume2,
  VolumeX,
  RotateCcw,
  Compass,
  Copy,
  Check,
  Trophy,
  BookOpen,
  Plus,
  LogIn,
  LogOut,
} from 'lucide-react';
import {
  applyGameAction,
  Coord,
  createInitialGameData,
  GameData,
  getShortestDistance,
  Wall,
  WallOrientation,
} from './lib/quoridor.ts';
import { computeBotAction } from './lib/bot.ts';
import { soundFX } from './lib/sound.ts';
import { QuoridorBoard } from './components/QuoridorBoard.tsx';
import { RulesModal } from './components/RulesModal.tsx';

type PlayMode = 'SOLO_BOT' | 'LOCAL_MULTI' | 'ONLINE_MULTI';
type BotDifficulty = 'novice' | 'tactician' | 'grandmaster';

interface OnlineRoomSeat {
  clientId: string;
  seatIndex: number;
  name: string;
  connected: boolean;
}

interface OnlineRoomState {
  roomId: string;
  roomName: string;
  maxPlayers: 2 | 4;
  status: 'WAITING' | 'PLAYING' | 'FINISHED';
  seats: (OnlineRoomSeat | null)[];
  game: GameData;
}

function getPersistentClientId(): string {
  const key = 'quoridor_client_id_v1';
  let id = localStorage.getItem(key);
  if (!id) {
    id = 'qr_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
    localStorage.setItem(key, id);
  }
  return id;
}

function generateClientRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default function App() {
  // Mode & Setup State
  const [mode, setMode] = useState<PlayMode>('SOLO_BOT');
  const [playerCount, setPlayerCount] = useState<2 | 4>(2);
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>('tactician');

  // Local / Bot Game State + Undo Stack
  const [localGame, setLocalGame] = useState<GameData>(() =>
    createInitialGameData(
      2,
      ['You (Ivory)', 'Tactician Bot'],
      [
        { isBot: false },
        { isBot: true, difficulty: 'tactician' },
      ]
    )
  );
  const [undoStack, setUndoStack] = useState<GameData[]>([]);

  // Interaction & Tactical HUD State
  const [wallOrientation, setWallOrientation] = useState<WallOrientation>('H');
  const [showShortestPath, setShowShortestPath] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [isRulesOpen, setIsRulesOpen] = useState<boolean>(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  // Online Multiplayer State (Supports both Server WebSocket & Static GitHub Pages PeerJS WebRTC)
  const [clientId] = useState<string>(() => getPersistentClientId());
  const [playerName] = useState<string>(() => {
    return localStorage.getItem('quoridor_player_name') || 'Player';
  });
  const [joinCodeInput, setJoinCodeInput] = useState<string>('');
  const [onlineRoom, setOnlineRoom] = useState<OnlineRoomState | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [copiedRoomCode, setCopiedRoomCode] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const onlineRoomIdRef = useRef<string | null>(null);

  // PeerJS WebRTC refs for static hosting (GitHub Pages) fallback
  const peerRef = useRef<Peer | null>(null);
  const hostConnectionsRef = useRef<DataConnection[]>([]);
  const guestConnectionRef = useRef<DataConnection | null>(null);
  const hostRoomStateRef = useRef<OnlineRoomState | null>(null);

  useEffect(() => {
    onlineRoomIdRef.current = onlineRoom?.roomId || null;
  }, [onlineRoom]);

  // Helper to apply incoming room state and trigger sound effects
  const applyIncomingOnlineRoom = (incomingRoom: OnlineRoomState) => {
    setOnlineRoom((prev) => {
      if (
        prev &&
        incomingRoom.game.history.length > prev.game.history.length
      ) {
        const latest =
          incomingRoom.game.history[incomingRoom.game.history.length - 1];
        if (incomingRoom.game.winner !== null) {
          soundFX.playVictory();
        } else if (latest.type === 'MOVE') {
          soundFX.playPawnStep();
        } else {
          soundFX.playWallSnap();
        }
      }
      return incomingRoom;
    });
    setMode('ONLINE_MULTI');
    setOnlineError(null);
  };

  // Keyboard shortcuts ('R' or 'Space' to toggle wall orientation)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
      ) {
        return;
      }
      if (e.key === 'r' || e.key === 'R' || e.code === 'Space') {
        e.preventDefault();
        setWallOrientation((prev) => (prev === 'H' ? 'V' : 'H'));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Connect to Real-Time WebSocket Server (when running on Node/Cloud Run backend)
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let isUnmounted = false;

    // Skip WebSocket polling if running on github.io static pages
    if (window.location.hostname.endsWith('github.io')) {
      return;
    }

    const connectWs = () => {
      if (isUnmounted) return;
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws-game`;
        const socket = new WebSocket(wsUrl);
        wsRef.current = socket;

        socket.onopen = () => {
          if (isUnmounted) return;
          setWsConnected(true);
          setOnlineError(null);
          socket.send(
            JSON.stringify({
              type: 'client:hello',
              clientId,
              roomId: onlineRoomIdRef.current,
            })
          );
        };

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'room:state') {
              applyIncomingOnlineRoom(data.room);
            } else if (data.type === 'room:error') {
              setOnlineError(data.message || 'Room error');
              soundFX.playIllegalAction();
            }
          } catch {
            // Ignore malformed WS messages
          }
        };

        socket.onclose = () => {
          if (isUnmounted) return;
          setWsConnected(false);
          reconnectTimer = setTimeout(connectWs, 4000);
        };
      } catch {
        setWsConnected(false);
      }
    };

    connectWs();

    return () => {
      isUnmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [clientId]);

  // Clean up PeerJS on unmount
  useEffect(() => {
    return () => {
      peerRef.current?.destroy();
    };
  }, []);

  // Broadcast state from P2P Host to all connected P2P Guests
  const broadcastP2PHostState = (roomState: OnlineRoomState) => {
    hostRoomStateRef.current = roomState;
    applyIncomingOnlineRoom(roomState);
    const payload = { type: 'room:state', room: roomState };
    hostConnectionsRef.current.forEach((conn) => {
      if (conn.open) {
        conn.send(payload);
      }
    });
  };

  // Start or Reset Local / Solo Game
  const startNewLocalMatch = (
    targetMode: PlayMode = mode,
    targetCount: 2 | 4 = playerCount,
    targetDiff: BotDifficulty = botDifficulty
  ) => {
    setValidationMessage(null);
    setOnlineError(null);
    setUndoStack([]);

    if (targetMode === 'SOLO_BOT') {
      const diffLabel =
        targetDiff === 'novice'
          ? 'Novice Bot'
          : targetDiff === 'tactician'
          ? 'Tactician Bot'
          : 'Grandmaster Bot';

      if (targetCount === 2) {
        setLocalGame(
          createInitialGameData(
            2,
            ['You (Ivory)', diffLabel],
            [
              { isBot: false },
              { isBot: true, difficulty: targetDiff },
            ]
          )
        );
      } else {
        setLocalGame(
          createInitialGameData(
            4,
            ['You (South)', 'Bot West', 'Bot North', 'Bot East'],
            [
              { isBot: false },
              { isBot: true, difficulty: targetDiff },
              { isBot: true, difficulty: targetDiff },
              { isBot: true, difficulty: targetDiff },
            ]
          )
        );
      }
    } else if (targetMode === 'LOCAL_MULTI') {
      if (targetCount === 2) {
        setLocalGame(
          createInitialGameData(2, ['Player 1 (Ivory)', 'Player 2 (Terracotta)'])
        );
      } else {
        setLocalGame(
          createInitialGameData(4, [
            'Player 1 (South)',
            'Player 2 (West)',
            'Player 3 (North)',
            'Player 4 (East)',
          ])
        );
      }
    }
  };

  // Trigger AI Bot Turn automatically when in SOLO_BOT mode
  useEffect(() => {
    if (mode !== 'SOLO_BOT') return;
    if (localGame.winner !== null) return;

    const currentPlayer = localGame.players[localGame.currentTurn];
    if (!currentPlayer?.isBot) return;

    const timer = setTimeout(() => {
      const botDecision = computeBotAction(localGame);
      const result = applyGameAction(localGame, botDecision);
      if (!result.error) {
        setLocalGame(result.nextState);
        if (result.nextState.winner !== null) {
          soundFX.playVictory();
        } else if (botDecision.type === 'MOVE') {
          soundFX.playPawnStep();
        } else {
          soundFX.playWallSnap();
        }
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [mode, localGame]);

  // Handle Player Action on Board
  const handleBoardAction = (
    action: { type: 'MOVE'; to: Coord } | { type: 'WALL'; wall: Wall }
  ) => {
    setValidationMessage(null);

    if (mode === 'ONLINE_MULTI') {
      if (!onlineRoom || onlineRoom.status !== 'PLAYING') return;

      // 1. If connected via Server WebSocket
      if (wsConnected && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'game:action',
            action,
          })
        );
        return;
      }

      // 2. If P2P Host (Static / GitHub Pages mode)
      if (hostRoomStateRef.current) {
        const room = hostRoomStateRef.current;
        const activeSeat = room.seats[room.game.currentTurn];
        if (!activeSeat || activeSeat.clientId !== clientId) return;
        const res = applyGameAction(room.game, action);
        if (res.error) {
          setValidationMessage(res.error);
          soundFX.playIllegalAction();
          return;
        }
        const updatedRoom: OnlineRoomState = {
          ...room,
          game: res.nextState,
          status: res.nextState.winner !== null ? 'FINISHED' : 'PLAYING',
        };
        broadcastP2PHostState(updatedRoom);
        return;
      }

      // 3. If P2P Guest (Static / GitHub Pages mode)
      if (guestConnectionRef.current?.open) {
        guestConnectionRef.current.send({
          type: 'game:action',
          clientId,
          action,
        });
      }
      return;
    }

    const currentPlayer = localGame.players[localGame.currentTurn];
    if (currentPlayer.isBot) return;

    const result = applyGameAction(localGame, action);
    if (result.error) {
      setValidationMessage(result.error);
      soundFX.playIllegalAction();
      return;
    }

    setUndoStack((prev) => [...prev, localGame]);
    setLocalGame(result.nextState);

    if (result.nextState.winner !== null) {
      soundFX.playVictory();
    } else if (action.type === 'MOVE') {
      soundFX.playPawnStep();
    } else {
      soundFX.playWallSnap();
    }
  };

  const handleUndo = () => {
    if (mode === 'ONLINE_MULTI' || undoStack.length === 0) return;
    const previousState = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setLocalGame(previousState);
    setValidationMessage(null);
  };

  // Online Room Handlers (Supports Server WS + P2P WebRTC Fallback for GitHub Pages)
  const handleMakeCode = () => {
    setOnlineError(null);
    setMode('ONLINE_MULTI');

    if (wsConnected && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'room:create',
          maxPlayers: playerCount,
          playerName,
          roomName: `${playerName}'s Room`,
        })
      );
      return;
    }

    // Static / GitHub Pages WebRTC P2P Host creation
    peerRef.current?.destroy();
    hostConnectionsRef.current = [];
    const code = generateClientRoomCode();
    const peer = new Peer(`quoridor-p2p-${code}`);
    peerRef.current = peer;

    peer.on('open', () => {
      const seats: (OnlineRoomSeat | null)[] = Array(playerCount).fill(null);
      seats[0] = {
        clientId,
        seatIndex: 0,
        name: 'Player 1 (Host)',
        connected: true,
      };
      const names = seats.map((s, idx) => s?.name || `Player ${idx + 1}`);
      const initialRoom: OnlineRoomState = {
        roomId: code,
        roomName: 'Online Room',
        maxPlayers: playerCount,
        status: 'WAITING',
        seats,
        game: createInitialGameData(playerCount, names),
      };
      broadcastP2PHostState(initialRoom);
    });

    peer.on('connection', (conn) => {
      hostConnectionsRef.current.push(conn);
      conn.on('data', (raw: unknown) => {
        const msg = raw as {
          type: string;
          clientId?: string;
          action?: { type: 'MOVE'; to: Coord } | { type: 'WALL'; wall: Wall };
        };
        const currentRoom = hostRoomStateRef.current;
        if (!currentRoom) return;

        if (msg.type === 'room:join' && msg.clientId) {
          const nextSeats = [...currentRoom.seats];
          let seat = nextSeats.find((s) => s && s.clientId === msg.clientId);
          if (!seat && currentRoom.status === 'WAITING') {
            const emptyIdx = nextSeats.findIndex((s) => s === null);
            if (emptyIdx !== -1) {
              seat = {
                clientId: msg.clientId,
                seatIndex: emptyIdx,
                name: `Player ${emptyIdx + 1}`,
                connected: true,
              };
              nextSeats[emptyIdx] = seat;
            }
          }
          const nextPlayers = currentRoom.game.players.map((p, i) => ({
            ...p,
            name: nextSeats[i]?.name || p.name,
          }));
          const filledCount = nextSeats.filter((s) => s !== null).length;
          const updatedRoom: OnlineRoomState = {
            ...currentRoom,
            seats: nextSeats,
            status:
              currentRoom.status === 'WAITING' && filledCount === currentRoom.maxPlayers
                ? 'PLAYING'
                : currentRoom.status,
            game: {
              ...currentRoom.game,
              players: nextPlayers,
            },
          };
          broadcastP2PHostState(updatedRoom);
        } else if (msg.type === 'game:action' && msg.action && msg.clientId) {
          if (currentRoom.status !== 'PLAYING') return;
          const activeSeat = currentRoom.seats[currentRoom.game.currentTurn];
          if (!activeSeat || activeSeat.clientId !== msg.clientId) return;
          const res = applyGameAction(currentRoom.game, msg.action);
          if (!res.error) {
            const updatedRoom: OnlineRoomState = {
              ...currentRoom,
              game: res.nextState,
              status: res.nextState.winner !== null ? 'FINISHED' : 'PLAYING',
            };
            broadcastP2PHostState(updatedRoom);
          }
        } else if (msg.type === 'game:rematch') {
          const names = currentRoom.seats.map((s, idx) => s?.name || `Player ${idx + 1}`);
          const updatedRoom: OnlineRoomState = {
            ...currentRoom,
            status: 'PLAYING',
            game: createInitialGameData(currentRoom.maxPlayers, names),
          };
          broadcastP2PHostState(updatedRoom);
        }
      });
    });

    peer.on('error', () => {
      setOnlineError('Could not initialize P2P room. Try again.');
    });
  };

  const handleJoinOnlineRoom = (code: string) => {
    const clean = code.toUpperCase().trim();
    if (!clean) {
      setOnlineError('Enter a 6-character code first');
      return;
    }
    setOnlineError(null);
    setMode('ONLINE_MULTI');

    if (wsConnected && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'room:join',
          roomId: clean,
          playerName,
        })
      );
      return;
    }

    // Static / GitHub Pages WebRTC P2P Guest connection
    peerRef.current?.destroy();
    hostRoomStateRef.current = null;
    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', () => {
      const conn = peer.connect(`quoridor-p2p-${clean}`, { reliable: true });
      guestConnectionRef.current = conn;

      conn.on('open', () => {
        conn.send({
          type: 'room:join',
          clientId,
        });
      });

      conn.on('data', (raw: unknown) => {
        const data = raw as { type: string; room?: OnlineRoomState };
        if (data.type === 'room:state' && data.room) {
          applyIncomingOnlineRoom(data.room);
        }
      });

      conn.on('error', () => {
        setOnlineError(`Could not connect to room ${clean}`);
      });
    });

    peer.on('error', () => {
      setOnlineError(`Room "${clean}" was not found.`);
    });
  };

  const handleLeaveOnlineRoom = () => {
    if (wsConnected && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'room:leave' }));
    }
    peerRef.current?.destroy();
    peerRef.current = null;
    hostRoomStateRef.current = null;
    guestConnectionRef.current = null;
    setOnlineRoom(null);
    setOnlineError(null);
    setMode('SOLO_BOT');
    startNewLocalMatch('SOLO_BOT', playerCount, botDifficulty);
  };

  const handleOnlineRematch = () => {
    if (wsConnected && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'game:rematch' }));
      return;
    }
    if (hostRoomStateRef.current) {
      const currentRoom = hostRoomStateRef.current;
      const names = currentRoom.seats.map((s, idx) => s?.name || `Player ${idx + 1}`);
      broadcastP2PHostState({
        ...currentRoom,
        status: 'PLAYING',
        game: createInitialGameData(currentRoom.maxPlayers, names),
      });
    } else if (guestConnectionRef.current?.open) {
      guestConnectionRef.current.send({ type: 'game:rematch' });
    }
  };

  const handleCopyRoomCode = () => {
    if (!onlineRoom) return;
    navigator.clipboard.writeText(onlineRoom.roomId).catch(() => {});
    setCopiedRoomCode(true);
    setTimeout(() => setCopiedRoomCode(false), 1800);
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundFX.enabled = next;
  };

  const activeGame: GameData =
    mode === 'ONLINE_MULTI' && onlineRoom ? onlineRoom.game : localGame;

  let canInteractWithBoard = false;
  if (mode === 'ONLINE_MULTI') {
    if (onlineRoom && onlineRoom.status === 'PLAYING' && activeGame.winner === null) {
      const turnSeat = onlineRoom.seats[activeGame.currentTurn];
      canInteractWithBoard = Boolean(turnSeat && turnSeat.clientId === clientId);
    }
  } else {
    const turnPlayer = activeGame.players[activeGame.currentTurn];
    canInteractWithBoard = activeGame.winner === null && !turnPlayer?.isBot;
  }

  const winningPlayer =
    activeGame.winner !== null
      ? activeGame.players.find((p) => p.id === activeGame.winner) || null
      : null;

  const mySeatIndex =
    mode === 'ONLINE_MULTI' && onlineRoom
      ? onlineRoom.seats.findIndex((s) => s?.clientId === clientId)
      : -1;

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#16120E] text-[#F5EFE6] flex flex-col">
      {/* Unified Top Bar with Match Setup Dropdowns & Inline Online Room Controls */}
      <header className="shrink-0 flex flex-wrap items-center justify-between gap-4 px-5 py-2.5 border-b border-[#2E241C] bg-[#1A1510]">
        {/* Zone 1: Brand Title */}
        <a
          href="#top"
          onClick={(e) => e.preventDefault()}
          className="text-lg font-bold tracking-tight text-[#F5EFE6] font-display whitespace-nowrap shrink-0"
        >
          Quoridor
        </a>

        {/* Zone 2: Match Setup Dropdowns + Online Make Code & Join Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Game Mode Dropdown */}
          <select
            aria-label="Game Mode"
            value={mode}
            onChange={(e) => {
              const nextMode = e.target.value as PlayMode;
              setMode(nextMode);
              if (nextMode !== 'ONLINE_MULTI') {
                startNewLocalMatch(nextMode, playerCount, botDifficulty);
              }
            }}
            className="rounded-lg border border-[#342820] bg-[#14100C] px-2.5 py-1.5 text-xs font-medium text-[#F5EFE6] focus:border-[#D99B52] focus:outline-none cursor-pointer"
          >
            <option value="SOLO_BOT">Mode: Solo vs Bot</option>
            <option value="LOCAL_MULTI">Mode: Local Pass &amp; Play</option>
            <option value="ONLINE_MULTI">Mode: Online Room</option>
          </select>

          {/* Player Count Dropdown */}
          <select
            aria-label="Player Count"
            value={playerCount}
            onChange={(e) => {
              const count = Number(e.target.value) as 2 | 4;
              setPlayerCount(count);
              if (mode !== 'ONLINE_MULTI') {
                startNewLocalMatch(mode, count, botDifficulty);
              }
            }}
            className="rounded-lg border border-[#342820] bg-[#14100C] px-2.5 py-1.5 text-xs font-medium text-[#F5EFE6] focus:border-[#D99B52] focus:outline-none cursor-pointer"
          >
            <option value={2}>2 Players · 10 Walls</option>
            <option value={4}>4 Players · 5 Walls</option>
          </select>

          {/* AI Difficulty Dropdown (Shown when Solo vs Bot is active) */}
          {mode === 'SOLO_BOT' && (
            <select
              aria-label="Bot Difficulty"
              value={botDifficulty}
              onChange={(e) => {
                const diff = e.target.value as BotDifficulty;
                setBotDifficulty(diff);
                startNewLocalMatch('SOLO_BOT', playerCount, diff);
              }}
              className="rounded-lg border border-[#342820] bg-[#14100C] px-2.5 py-1.5 text-xs font-medium text-[#F5EFE6] focus:border-[#D99B52] focus:outline-none cursor-pointer"
            >
              <option value="novice">Bot: Novice</option>
              <option value="tactician">Bot: Tactician</option>
              <option value="grandmaster">Bot: Grandmaster</option>
            </select>
          )}

          <span className="hidden sm:inline text-[#3E2F23]">|</span>

          {/* Inline Online Room Controls: Make Code + Join Code Input & Button */}
          {!onlineRoom ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleMakeCode}
                title="Create an online room code"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#2B2118] border border-[#D99B52]/60 hover:border-[#D99B52] text-xs font-semibold text-[#F5EFE6] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#D99B52]" />
                <span>Make Code</span>
              </button>

              <div className="flex items-center">
                <input
                  type="text"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleJoinOnlineRoom(joinCodeInput);
                    }
                  }}
                  maxLength={6}
                  placeholder="Room Code"
                  className="w-24 rounded-l-lg border border-[#342820] bg-[#14100C] px-2.5 py-1.5 text-xs font-mono-tabular uppercase text-[#F5EFE6] placeholder:text-[#7D6E60] focus:border-[#D99B52] focus:outline-none"
                />
                <button
                  onClick={() => handleJoinOnlineRoom(joinCodeInput)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-r-lg border border-l-0 border-[#342820] bg-[#2E241C] hover:bg-[#3A2D23] text-xs font-semibold text-[#F5EFE6] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5 text-[#D99B52]" />
                  <span>Join</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-[#14100C] px-2.5 py-1 rounded-lg border border-[#D99B52]/60">
              <span className="text-xs text-[#A89888]">Code:</span>
              <span className="text-xs font-bold font-mono-tabular tracking-wider text-[#D99B52]">
                {onlineRoom.roomId}
              </span>
              <span className="text-[11px] text-[#A89888]">
                ({onlineRoom.status === 'WAITING' ? 'Waiting' : mySeatIndex !== -1 ? `P${mySeatIndex + 1}` : 'Spec'})
              </span>
              <button
                onClick={handleCopyRoomCode}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#2E241C] hover:bg-[#3B2E24] text-[11px] font-medium text-[#F5EFE6] cursor-pointer"
              >
                {copiedRoomCode ? (
                  <>
                    <Check className="w-3 h-3 text-[#10B981]" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
              <button
                onClick={handleLeaveOnlineRoom}
                title="Leave Online Room"
                className="p-1 rounded text-[#A89888] hover:text-[#EF4444] cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Zone 3: Rules & New Match Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setIsRulesOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#D8CBB8] hover:text-[#F5EFE6] border border-[#2E241C] rounded-lg bg-[#14100C] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#D99B52]" />
            <span>Rules</span>
          </button>

          <button
            onClick={() => {
              if (mode === 'ONLINE_MULTI' && onlineRoom) {
                handleOnlineRematch();
              } else {
                startNewLocalMatch(mode, playerCount, botDifficulty);
              }
            }}
            className="px-3.5 py-1.5 text-xs font-semibold text-[#16120E] bg-[#D99B52] rounded-lg hover:bg-[#E5AD68] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            New Match
          </button>
        </div>
      </header>

      {/* Main Viewport-Fit Workspace (No vertical page scroll) */}
      <main className="flex-1 min-h-0 w-full max-w-[1440px] mx-auto px-4 py-3 grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch overflow-hidden">
        {/* LEFT COLUMN (3 cols): Players & Wall Reserves */}
        <section className="lg:col-span-3 flex flex-col min-h-0 h-full">
          <div className="rounded-xl border border-[#2E241C] bg-[#1E1813] p-3.5 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h2 className="text-xs font-semibold text-[#F5EFE6]">
                Players &amp; Wall Reserves
              </h2>
              <span className="text-[11px] text-[#A89888] font-mono-tabular">
                Turn #{activeGame.history.length + 1}
              </span>
            </div>

            <div className="space-y-2.5 overflow-y-auto pr-0.5">
              {activeGame.players.map((p, idx) => {
                const isTurn = activeGame.currentTurn === idx && activeGame.winner === null;
                const dist = getShortestDistance(p.pawn, p.goalType, activeGame.walls);
                const goalShort =
                  p.goalType === 'ROW_0'
                    ? 'North'
                    : p.goalType === 'ROW_8'
                    ? 'South'
                    : p.goalType === 'COL_8'
                    ? 'East'
                    : 'West';

                return (
                  <div
                    key={p.id}
                    className={`rounded-lg border p-3 transition-colors ${
                      isTurn
                        ? 'border-[#D99B52] bg-[#271F18]'
                        : 'border-[#2A2019] bg-[#16120E]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3 h-3 rounded-full shrink-0 border border-black/40"
                          style={{ backgroundColor: p.color }}
                        />
                        <span className="text-xs font-semibold text-[#F5EFE6] truncate">
                          {p.name}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#D99B52] font-medium whitespace-nowrap shrink-0">
                        {activeGame.winner === p.id
                          ? 'Winner'
                          : isTurn
                          ? 'Active Turn'
                          : 'Waiting'}
                      </span>
                    </div>

                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-[#A89888] font-mono-tabular">
                      <div>
                        <span>Goal: {goalShort}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{dist === Infinity ? 'Blocked' : `${dist} steps`}</span>
                      </div>
                      <span className="text-[#F5EFE6] font-semibold">
                        {p.wallsLeft} {p.wallsLeft === 1 ? 'wall' : 'walls'}
                      </span>
                    </div>

                    {/* Visual Wooden Wall Pip Bar */}
                    <div className="mt-2 flex items-center gap-1">
                      {Array.from({
                        length: activeGame.playerCount === 2 ? 10 : 5,
                      }).map((_, pipIdx) => (
                        <div
                          key={pipIdx}
                          className={`h-1.5 flex-1 rounded-sm ${
                            pipIdx < p.wallsLeft
                              ? 'bg-[#D99B52]'
                              : 'bg-[#2A2019] opacity-40'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* CENTER COLUMN (6 cols): Compact Action Bar + Viewport-Scaled 9x9 Board */}
        <section className="lg:col-span-6 flex flex-col items-center justify-between min-h-0 h-full gap-2">
          {/* Compact Top Tactical Bar */}
          <div className="w-full rounded-xl border border-[#2E241C] bg-[#1E1813] px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{
                  backgroundColor:
                    activeGame.players[activeGame.currentTurn]?.color || '#F5EFE6',
                }}
              />
              <span className="text-xs font-medium text-[#F5EFE6] truncate">
                {winningPlayer
                  ? `Victory: ${winningPlayer.name}!`
                  : mode === 'ONLINE_MULTI' &&
                    onlineRoom &&
                    onlineRoom.status === 'WAITING'
                  ? `Waiting for opponent — Share code ${onlineRoom.roomId}`
                  : `Turn: ${activeGame.players[activeGame.currentTurn]?.name}`}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() =>
                  setWallOrientation((prev) => (prev === 'H' ? 'V' : 'H'))
                }
                title="Shortcut: R, Space, or Right-Click"
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#2B2118] border border-[#3E2F23] hover:border-[#D99B52] text-xs font-medium text-[#F5EFE6] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCw className="w-3 h-3 text-[#D99B52]" />
                <span>{wallOrientation === 'H' ? 'Horiz (H)' : 'Vert (V)'}</span>
              </button>

              <button
                onClick={() => setShowShortestPath((prev) => !prev)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                  showShortestPath
                    ? 'border-[#10B981] bg-[#132A22] text-[#A7F3D0]'
                    : 'border-[#2E241C] bg-[#16120E] text-[#A89888] hover:text-[#F5EFE6]'
                }`}
              >
                <Compass className="w-3 h-3" />
                <span>Paths</span>
              </button>

              {mode !== 'ONLINE_MULTI' && (
                <button
                  onClick={handleUndo}
                  disabled={undoStack.length === 0}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg border border-[#2E241C] bg-[#16120E] text-xs font-medium text-[#A89888] hover:text-[#F5EFE6] disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Undo</span>
                </button>
              )}

              <button
                onClick={toggleSound}
                aria-label="Toggle sound effects"
                className="p-1 rounded-lg border border-[#2E241C] bg-[#16120E] text-[#A89888] hover:text-[#F5EFE6] shrink-0 cursor-pointer"
              >
                {soundEnabled ? (
                  <Volume2 className="w-3.5 h-3.5 text-[#D99B52]" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Center Interactive SVG Board */}
          <div className="relative flex-1 min-h-0 w-full flex items-center justify-center">
            <QuoridorBoard
              game={activeGame}
              canInteract={canInteractWithBoard}
              wallOrientation={wallOrientation}
              onToggleOrientation={() =>
                setWallOrientation((prev) => (prev === 'H' ? 'V' : 'H'))
              }
              onAction={handleBoardAction}
              showShortestPath={showShortestPath}
              onValidationFeedback={setValidationMessage}
            />

            {winningPlayer && (
              <div className="absolute inset-x-0 bottom-4 mx-auto max-w-sm rounded-xl border border-[#D99B52] bg-[#16120E]/95 p-4 shadow-2xl text-center space-y-2 backdrop-blur-sm">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#2B2118] text-[#D99B52]">
                  <Trophy className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#F5EFE6]">
                    {winningPlayer.name} Wins!
                  </h3>
                  <p className="text-[11px] text-[#A89888]">
                    {activeGame.history.length} moves · {activeGame.walls.length} walls placed
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (mode === 'ONLINE_MULTI' && onlineRoom) {
                      handleOnlineRematch();
                    } else {
                      startNewLocalMatch(mode, playerCount, botDifficulty);
                    }
                  }}
                  className="px-4 py-1.5 rounded-lg bg-[#D99B52] text-[#16120E] text-xs font-semibold hover:bg-[#E5AD68] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Play Again
                </button>
              </div>
            )}
          </div>

          {/* Compact Single-Line Status / Error Footer */}
          <div className="w-full text-center text-[11px] shrink-0 h-4 flex items-center justify-center">
            {onlineError || validationMessage ? (
              <span className="text-[#F87171] font-medium truncate">
                {onlineError || validationMessage}
              </span>
            ) : (
              <span className="text-[#A89888] truncate">
                Click emerald square to move · Click groove intersection to place wall · Press R or Right-Click to rotate
              </span>
            )}
          </div>
        </section>

        {/* RIGHT COLUMN (3 cols): Full-Height Algebraic Move Log */}
        <section className="lg:col-span-3 flex flex-col min-h-0 h-full overflow-hidden">
          <div className="rounded-xl border border-[#2E241C] bg-[#1E1813] p-3.5 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-2.5 shrink-0">
              <h2 className="text-xs font-semibold text-[#F5EFE6]">
                Algebraic Move Log
              </h2>
              <span className="text-[11px] text-[#A89888] font-mono-tabular">
                {activeGame.history.length} moves · {activeGame.walls.length} walls
              </span>
            </div>

            {activeGame.history.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-center p-3 border border-dashed border-[#2A2019] rounded-lg">
                <p className="text-xs text-[#7D6E60]">
                  No moves recorded yet. Make a pawn step (e.g. e2) or place a fence (e.g. e8h).
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-1 content-start grid grid-cols-2 gap-1.5 text-xs font-mono-tabular">
                {activeGame.history.map((m, i) => {
                  const p = activeGame.players.find((pl) => pl.id === m.playerId);
                  return (
                    <div
                      key={`${m.timestamp}-${i}`}
                      className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#16120E] border border-[#2A2019]"
                    >
                      <span className="text-[#7D6E60] text-[11px]">{i + 1}.</span>
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: p?.color || '#F5EFE6' }}
                      />
                      <span className="text-[#F5EFE6] font-semibold">{m.notation}</span>
                      <span className="text-[10px] text-[#8C7A6B] ml-auto">
                        {m.type === 'MOVE' ? 'step' : 'wall'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Official Rules Modal */}
      <RulesModal isOpen={isRulesOpen} onClose={() => setIsRulesOpen(false)} />
    </div>
  );
}
