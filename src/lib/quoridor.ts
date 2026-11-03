export interface Coord {
  r: number; // 0 to 8 (0 is top, 8 is bottom)
  c: number; // 0 to 8 (0 is left, 8 is right)
}

export type WallOrientation = 'H' | 'V';

export interface Wall {
  r: number; // 0 to 7 (top-left intersection row)
  c: number; // 0 to 7 (top-left intersection col)
  orientation: WallOrientation;
  ownerId?: number;
}

export type GoalType = 'ROW_0' | 'ROW_8' | 'COL_0' | 'COL_8';

export interface PlayerState {
  id: number; // 0, 1, 2, 3
  name: string;
  color: string;
  pawn: Coord;
  wallsLeft: number;
  goalType: GoalType;
  isBot?: boolean;
  botDifficulty?: 'novice' | 'tactician' | 'grandmaster';
}

export interface MoveAction {
  type: 'MOVE' | 'WALL';
  playerId: number;
  to?: Coord;
  from?: Coord;
  wall?: Wall;
  notation: string;
  timestamp: number;
}

export interface GameData {
  players: PlayerState[];
  walls: Wall[];
  currentTurn: number; // index in players array
  winner: number | null;
  history: MoveAction[];
  playerCount: 2 | 4;
}

export const BOARD_SIZE = 9;
export const WALL_GRID_SIZE = 8;

/**
 * Convert coordinates to standard Quoridor algebraic notation:
 * Columns: a - i (0 -> a, 8 -> i)
 * Rows: 1 - 9 (Row 8 (bottom) -> 1, Row 0 (top) -> 9, or 1-9 top-to-bottom; standard Glendenning notation uses a-i for files and 1-9 for ranks from bottom to top)
 */
export function coordToNotation(coord: Coord): string {
  const file = String.fromCharCode(97 + coord.c);
  const rank = 9 - coord.r;
  return `${file}${rank}`;
}

export function wallToNotation(wall: Wall): string {
  const file = String.fromCharCode(97 + wall.c);
  const rank = 8 - wall.r;
  return `${file}${rank}${wall.orientation.toLowerCase()}`;
}

export function createInitialGameData(
  playerCount: 2 | 4,
  customNames?: string[],
  botConfigs?: { isBot: boolean; difficulty?: 'novice' | 'tactician' | 'grandmaster' }[]
): GameData {
  const wallsPerPlayer = playerCount === 2 ? 10 : 5;

  if (playerCount === 2) {
    const players: PlayerState[] = [
      {
        id: 0,
        name: customNames?.[0] || 'Player 1 (Ivory)',
        color: '#F5EFE6', // Warm Ivory
        pawn: { r: 8, c: 4 }, // Bottom center, heading North to ROW_0
        wallsLeft: wallsPerPlayer,
        goalType: 'ROW_0',
        isBot: botConfigs?.[0]?.isBot ?? false,
        botDifficulty: botConfigs?.[0]?.difficulty,
      },
      {
        id: 1,
        name: customNames?.[1] || 'Player 2 (Terracotta)',
        color: '#E05A47', // Terracotta Red
        pawn: { r: 0, c: 4 }, // Top center, heading South to ROW_8
        wallsLeft: wallsPerPlayer,
        goalType: 'ROW_8',
        isBot: botConfigs?.[1]?.isBot ?? false,
        botDifficulty: botConfigs?.[1]?.difficulty,
      },
    ];
    return {
      players,
      walls: [],
      currentTurn: 0,
      winner: null,
      history: [],
      playerCount: 2,
    };
  } else {
    // 4-player clockwise order: Bottom (0) -> Left (1) -> Top (2) -> Right (3)
    const players: PlayerState[] = [
      {
        id: 0,
        name: customNames?.[0] || 'South (Ivory)',
        color: '#F5EFE6',
        pawn: { r: 8, c: 4 },
        wallsLeft: wallsPerPlayer,
        goalType: 'ROW_0',
        isBot: botConfigs?.[0]?.isBot ?? false,
        botDifficulty: botConfigs?.[0]?.difficulty,
      },
      {
        id: 1,
        name: customNames?.[1] || 'West (Amber)',
        color: '#F59E0B',
        pawn: { r: 4, c: 0 },
        wallsLeft: wallsPerPlayer,
        goalType: 'COL_8',
        isBot: botConfigs?.[1]?.isBot ?? false,
        botDifficulty: botConfigs?.[1]?.difficulty,
      },
      {
        id: 2,
        name: customNames?.[2] || 'North (Terracotta)',
        color: '#E05A47',
        pawn: { r: 0, c: 4 },
        wallsLeft: wallsPerPlayer,
        goalType: 'ROW_8',
        isBot: botConfigs?.[2]?.isBot ?? false,
        botDifficulty: botConfigs?.[2]?.difficulty,
      },
      {
        id: 3,
        name: customNames?.[3] || 'East (Jade)',
        color: '#10B981',
        pawn: { r: 4, c: 8 },
        wallsLeft: wallsPerPlayer,
        goalType: 'COL_0',
        isBot: botConfigs?.[3]?.isBot ?? false,
        botDifficulty: botConfigs?.[3]?.difficulty,
      },
    ];
    return {
      players,
      walls: [],
      currentTurn: 0,
      winner: null,
      history: [],
      playerCount: 4,
    };
  }
}

export function isGoalReached(coord: Coord, goalType: GoalType): boolean {
  switch (goalType) {
    case 'ROW_0':
      return coord.r === 0;
    case 'ROW_8':
      return coord.r === 8;
    case 'COL_0':
      return coord.c === 0;
    case 'COL_8':
      return coord.c === 8;
  }
}

/**
 * Checks if a single orthogonal step between two adjacent squares a and b is blocked by any wall or out of bounds.
 */
export function isStepBlocked(a: Coord, b: Coord, walls: Wall[]): boolean {
  if (b.r < 0 || b.r >= BOARD_SIZE || b.c < 0 || b.c >= BOARD_SIZE) {
    return true;
  }
  const dr = b.r - a.r;
  const dc = b.c - a.c;
  if (Math.abs(dr) + Math.abs(dc) !== 1) {
    return true;
  }

  if (dr === -1) {
    // Moving UP from (r, c) to (r-1, c)
    // Blocked by horizontal wall at row r-1, col c or col c-1
    const wallRow = a.r - 1;
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (w.orientation === 'H' && w.r === wallRow && (w.c === a.c || w.c === a.c - 1)) {
        return true;
      }
    }
  } else if (dr === 1) {
    // Moving DOWN from (r, c) to (r+1, c)
    // Blocked by horizontal wall at row r, col c or col c-1
    const wallRow = a.r;
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (w.orientation === 'H' && w.r === wallRow && (w.c === a.c || w.c === a.c - 1)) {
        return true;
      }
    }
  } else if (dc === -1) {
    // Moving LEFT from (r, c) to (r, c-1)
    // Blocked by vertical wall at col c-1, row r or row r-1
    const wallCol = a.c - 1;
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (w.orientation === 'V' && w.c === wallCol && (w.r === a.r || w.r === a.r - 1)) {
        return true;
      }
    }
  } else if (dc === 1) {
    // Moving RIGHT from (r, c) to (r, c+1)
    // Blocked by vertical wall at col c, row r or row r-1
    const wallCol = a.c;
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (w.orientation === 'V' && w.c === wallCol && (w.r === a.r || w.r === a.r - 1)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Returns all legal destination coordinates for a given player in the current game state.
 * Implements official Quoridor rules:
 * 1. Orthogonal step if unobstructed and unoccupied.
 * 2. Straight jump over an adjacent pawn if unobstructed and the landing square is unoccupied.
 * 3. Diagonal side-step around an adjacent pawn ONLY if the straight jump behind that pawn is blocked by a wall, board edge, or a third pawn (in 4-player mode).
 */
export function getValidPawnMoves(
  playerIndex: number,
  players: PlayerState[],
  walls: Wall[]
): Coord[] {
  const me = players[playerIndex].pawn;
  const occupied = new Set<string>();
  players.forEach((p, idx) => {
    if (idx !== playerIndex) {
      occupied.add(`${p.pawn.r},${p.pawn.c}`);
    }
  });

  const isOccupied = (c: Coord) => occupied.has(`${c.r},${c.c}`);
  const validMoves: Coord[] = [];
  const added = new Set<string>();
  const addMove = (c: Coord) => {
    const key = `${c.r},${c.c}`;
    if (!added.has(key) && !isOccupied(c)) {
      added.add(key);
      validMoves.push(c);
    }
  };

  const dirs = [
    { dr: -1, dc: 0 }, // Up
    { dr: 1, dc: 0 },  // Down
    { dr: 0, dc: -1 }, // Left
    { dr: 0, dc: 1 },  // Right
  ];

  for (const { dr, dc } of dirs) {
    const adj: Coord = { r: me.r + dr, c: me.c + dc };
    if (isStepBlocked(me, adj, walls)) continue;

    if (!isOccupied(adj)) {
      addMove(adj);
    } else {
      // Adjacent square has an opponent pawn!
      // Attempt straight jump:
      const jumpTarget: Coord = { r: adj.r + dr, c: adj.c + dc };
      const jumpBlockedByWallOrEdge = isStepBlocked(adj, jumpTarget, walls);
      const jumpBlockedByAnotherPawn = !jumpBlockedByWallOrEdge && isOccupied(jumpTarget);

      if (!jumpBlockedByWallOrEdge && !jumpBlockedByAnotherPawn) {
        addMove(jumpTarget);
      } else {
        // Straight jump is blocked by a wall, edge of board, or another pawn!
        // Official Quoridor rule: Can divert left or right around the adjacent pawn
        const perpDirs =
          dr !== 0
            ? [
                { dr: 0, dc: -1 },
                { dr: 0, dc: 1 },
              ]
            : [
                { dr: -1, dc: 0 },
                { dr: 1, dc: 0 },
              ];

        for (const pDir of perpDirs) {
          const diagTarget: Coord = { r: adj.r + pDir.dr, c: adj.c + pDir.dc };
          if (!isStepBlocked(adj, diagTarget, walls) && !isOccupied(diagTarget)) {
            addMove(diagTarget);
          }
        }
      }
    }
  }

  return validMoves;
}

/**
 * Computes the shortest path (ignoring other pawns, as required by official Quoridor path-checking rules and standard AI heuristics)
 * from a coordinate to a player's goal line using Breadth-First Search (BFS).
 * Returns the array of coordinates from start (exclusive) to goal (inclusive), or null if no path exists.
 */
export function getShortestPath(
  start: Coord,
  goalType: GoalType,
  walls: Wall[]
): Coord[] | null {
  if (isGoalReached(start, goalType)) return [];

  const visited = new Uint8Array(81);
  const parent = new Int8Array(81).fill(-1);
  const queue = new Int8Array(81);
  let head = 0;
  let tail = 0;

  const startIdx = start.r * 9 + start.c;
  visited[startIdx] = 1;
  queue[tail++] = startIdx;

  // Order neighbors toward the goal first for clean natural paths
  const dirs =
    goalType === 'ROW_0'
      ? [
          [-1, 0],
          [0, -1],
          [0, 1],
          [1, 0],
        ]
      : goalType === 'ROW_8'
      ? [
          [1, 0],
          [0, -1],
          [0, 1],
          [-1, 0],
        ]
      : goalType === 'COL_0'
      ? [
          [0, -1],
          [-1, 0],
          [1, 0],
          [0, 1],
        ]
      : [
          [0, 1],
          [-1, 0],
          [1, 0],
          [0, -1],
        ];

  let foundIdx = -1;

  while (head < tail) {
    const currIdx = queue[head++];
    const r = Math.floor(currIdx / 9);
    const c = currIdx % 9;
    const currCoord = { r, c };

    if (isGoalReached(currCoord, goalType)) {
      foundIdx = currIdx;
      break;
    }

    for (let i = 0; i < 4; i++) {
      const nr = r + dirs[i][0];
      const nc = c + dirs[i][1];
      if (nr < 0 || nr >= 9 || nc < 0 || nc >= 9) continue;
      const nextIdx = nr * 9 + nc;
      if (visited[nextIdx]) continue;

      if (!isStepBlocked(currCoord, { r: nr, c: nc }, walls)) {
        visited[nextIdx] = 1;
        parent[nextIdx] = currIdx;
        queue[tail++] = nextIdx;
      }
    }
  }

  if (foundIdx === -1) return null;

  const path: Coord[] = [];
  let trace = foundIdx;
  while (trace !== startIdx) {
    path.push({ r: Math.floor(trace / 9), c: trace % 9 });
    trace = parent[trace];
  }
  path.reverse();
  return path;
}

/**
 * Fast BFS distance-only calculation (returns number of steps to goal, or Infinity if trapped).
 */
export function getShortestDistance(
  start: Coord,
  goalType: GoalType,
  walls: Wall[]
): number {
  if (isGoalReached(start, goalType)) return 0;

  const visited = new Uint8Array(81);
  const dist = new Uint8Array(81);
  const queue = new Int8Array(81);
  let head = 0;
  let tail = 0;

  const startIdx = start.r * 9 + start.c;
  visited[startIdx] = 1;
  dist[startIdx] = 0;
  queue[tail++] = startIdx;

  const drs = [-1, 1, 0, 0];
  const dcs = [0, 0, -1, 1];

  while (head < tail) {
    const currIdx = queue[head++];
    const r = Math.floor(currIdx / 9);
    const c = currIdx % 9;
    const d = dist[currIdx];

    for (let i = 0; i < 4; i++) {
      const nr = r + drs[i];
      const nc = c + dcs[i];
      if (nr < 0 || nr >= 9 || nc < 0 || nc >= 9) continue;
      const nextIdx = nr * 9 + nc;
      if (visited[nextIdx]) continue;

      if (!isStepBlocked({ r, c }, { r: nr, c: nc }, walls)) {
        const nextCoord = { r: nr, c: nc };
        if (isGoalReached(nextCoord, goalType)) {
          return d + 1;
        }
        visited[nextIdx] = 1;
        dist[nextIdx] = d + 1;
        queue[tail++] = nextIdx;
      }
    }
  }

  return Infinity;
}

/**
 * Checks if a wall placement is geometrically valid (no overlap, no cross intersection)
 * AND respects the Golden Rule (every player still has at least one valid path to their goal line).
 */
export function isWallPlacementValid(
  candidate: Wall,
  walls: Wall[],
  players: PlayerState[]
): { valid: boolean; reason?: string } {
  if (
    candidate.r < 0 ||
    candidate.r >= WALL_GRID_SIZE ||
    candidate.c < 0 ||
    candidate.c >= WALL_GRID_SIZE
  ) {
    return { valid: false, reason: 'Out of board bounds' };
  }

  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    // Same center intersection
    if (w.r === candidate.r && w.c === candidate.c) {
      return {
        valid: false,
        reason: w.orientation === candidate.orientation ? 'Wall already exists here' : 'Walls cannot cross each other',
      };
    }
    // Overlapping segments of same orientation
    if (w.orientation === candidate.orientation) {
      if (
        candidate.orientation === 'H' &&
        w.r === candidate.r &&
        Math.abs(w.c - candidate.c) === 1
      ) {
        return { valid: false, reason: 'Overlaps with an adjacent horizontal wall' };
      }
      if (
        candidate.orientation === 'V' &&
        w.c === candidate.c &&
        Math.abs(w.r - candidate.r) === 1
      ) {
        return { valid: false, reason: 'Overlaps with an adjacent vertical wall' };
      }
    }
  }

  // Check the Golden Rule: no player may be completely cut off from their goal line
  const nextWalls = [...walls, candidate];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const d = getShortestDistance(p.pawn, p.goalType, nextWalls);
    if (d === Infinity) {
      return {
        valid: false,
        reason: `Illegal block: ${p.name} must have at least one open path to their goal`,
      };
    }
  }

  return { valid: true };
}

/**
 * Applies a validated move or wall action and returns a new immutable GameData state.
 */
export function applyGameAction(
  game: GameData,
  action: { type: 'MOVE'; to: Coord } | { type: 'WALL'; wall: Wall }
): { nextState: GameData; error?: string } {
  if (game.winner !== null) {
    return { nextState: game, error: 'Game is already over' };
  }

  const playerIdx = game.currentTurn;
  const currentPlayer = game.players[playerIdx];

  if (action.type === 'MOVE') {
    const validMoves = getValidPawnMoves(playerIdx, game.players, game.walls);
    const isLegal = validMoves.some((m) => m.r === action.to.r && m.c === action.to.c);
    if (!isLegal) {
      return { nextState: game, error: 'Illegal pawn movement' };
    }

    const nextPlayers = game.players.map((p, idx) =>
      idx === playerIdx ? { ...p, pawn: { ...action.to } } : p
    );

    const won = isGoalReached(action.to, currentPlayer.goalType);
    const moveRecord: MoveAction = {
      type: 'MOVE',
      playerId: currentPlayer.id,
      from: { ...currentPlayer.pawn },
      to: { ...action.to },
      notation: coordToNotation(action.to),
      timestamp: Date.now(),
    };

    return {
      nextState: {
        ...game,
        players: nextPlayers,
        currentTurn: won ? playerIdx : (playerIdx + 1) % game.players.length,
        winner: won ? currentPlayer.id : null,
        history: [...game.history, moveRecord],
      },
    };
  } else {
    if (currentPlayer.wallsLeft <= 0) {
      return { nextState: game, error: 'No walls remaining' };
    }
    const validation = isWallPlacementValid(action.wall, game.walls, game.players);
    if (!validation.valid) {
      return { nextState: game, error: validation.reason || 'Invalid wall placement' };
    }

    const placedWall: Wall = {
      ...action.wall,
      ownerId: currentPlayer.id,
    };

    const nextPlayers = game.players.map((p, idx) =>
      idx === playerIdx ? { ...p, wallsLeft: p.wallsLeft - 1 } : p
    );

    const moveRecord: MoveAction = {
      type: 'WALL',
      playerId: currentPlayer.id,
      wall: placedWall,
      notation: wallToNotation(placedWall),
      timestamp: Date.now(),
    };

    return {
      nextState: {
        ...game,
        players: nextPlayers,
        walls: [...game.walls, placedWall],
        currentTurn: (playerIdx + 1) % game.players.length,
        history: [...game.history, moveRecord],
      },
    };
  }
}
