import {
  Coord,
  GameData,
  getShortestDistance,
  getShortestPath,
  getValidPawnMoves,
  isGoalReached,
  isWallPlacementValid,
  PlayerState,
  Wall,
  WALL_GRID_SIZE,
} from './quoridor.ts';

export type BotAction = { type: 'MOVE'; to: Coord } | { type: 'WALL'; wall: Wall };

/**
 * Generates candidate walls that are strategically relevant (along opponent shortest paths or near pawns)
 * so the search tree only evaluates high-leverage wall placements.
 */
function getCandidateWalls(players: PlayerState[], walls: Wall[], myIdx: number): Wall[] {
  const candidates: Wall[] = [];
  const seen = new Set<string>();

  const addCandidate = (r: number, c: number, orientation: 'H' | 'V') => {
    if (r < 0 || r >= WALL_GRID_SIZE || c < 0 || c >= WALL_GRID_SIZE) return;
    const key = `${r},${c},${orientation}`;
    if (seen.has(key)) return;
    seen.add(key);
    const w: Wall = { r, c, orientation };
    if (isWallPlacementValid(w, walls, players).valid) {
      candidates.push(w);
    }
  };

  // Focus on walls intersecting or adjacent to opponents' shortest paths
  players.forEach((p, idx) => {
    if (idx === myIdx) return;
    const path = getShortestPath(p.pawn, p.goalType, walls);
    const coordsToInspect = [p.pawn, ...(path ? path.slice(0, 5) : [])];

    for (const coord of coordsToInspect) {
      for (let dr = -1; dr <= 0; dr++) {
        for (let dc = -1; dc <= 0; dc++) {
          addCandidate(coord.r + dr, coord.c + dc, 'H');
          addCandidate(coord.r + dr, coord.c + dc, 'V');
        }
      }
    }
  });

  // Also consider walls near existing walls to close corridors
  for (const w of walls) {
    for (let d = -2; d <= 2; d++) {
      addCandidate(w.r + d, w.c, 'H');
      addCandidate(w.r + d, w.c, 'V');
      addCandidate(w.r, w.c + d, 'H');
      addCandidate(w.r, w.c + d, 'V');
    }
  }

  return candidates;
}

/**
 * Evaluates board state from the perspective of `botIdx`.
 * Higher score is better for `botIdx`.
 */
function evaluateState(players: PlayerState[], walls: Wall[], botIdx: number): number {
  const me = players[botIdx];
  const myDist = getShortestDistance(me.pawn, me.goalType, walls);
  if (myDist === 0) return 10000;

  let minOpponentDist = Infinity;
  let opponentWallsScore = 0;

  for (let i = 0; i < players.length; i++) {
    if (i === botIdx) continue;
    const opp = players[i];
    const d = getShortestDistance(opp.pawn, opp.goalType, walls);
    if (d === 0) return -10000;
    if (d < minOpponentDist) {
      minOpponentDist = d;
    }
    opponentWallsScore += opp.wallsLeft * 0.35;
  }

  // Primary factor: difference between closest opponent's distance and our distance
  // Plus wall conservation bonus
  const pathDelta = (minOpponentDist - myDist) * 12;
  const wallConservation = me.wallsLeft * 0.45 - opponentWallsScore / Math.max(1, players.length - 1);

  return pathDelta + wallConservation;
}

/**
 * Computes the best move or wall placement for the AI bot.
 */
export function computeBotAction(game: GameData): BotAction {
  const botIdx = game.currentTurn;
  const bot = game.players[botIdx];
  const difficulty = bot.botDifficulty || 'tactician';

  const validMoves = getValidPawnMoves(botIdx, game.players, game.walls);

  // 1. Immediate winning move check
  for (const m of validMoves) {
    if (isGoalReached(m, bot.goalType)) {
      return { type: 'MOVE', to: m };
    }
  }

  // Sort pawn moves by shortest distance to goal
  const scoredPawnMoves = validMoves
    .map((m) => {
      const nextPlayers = game.players.map((p, idx) =>
        idx === botIdx ? { ...p, pawn: m } : p
      );
      const dist = getShortestDistance(m, bot.goalType, game.walls);
      const evalScore = evaluateState(nextPlayers, game.walls, botIdx);
      return { move: m, dist, evalScore };
    })
    .sort((a, b) => a.dist - b.dist || b.evalScore - a.evalScore);

  const bestPawnMove = scoredPawnMoves[0]?.move || validMoves[0];
  const myCurrentDist = getShortestDistance(bot.pawn, bot.goalType, game.walls);

  // Find most threatening opponent
  let leadOppIdx = (botIdx + 1) % game.players.length;
  let leadOppDist = Infinity;
  for (let i = 0; i < game.players.length; i++) {
    if (i === botIdx) continue;
    const d = getShortestDistance(game.players[i].pawn, game.players[i].goalType, game.walls);
    if (d < leadOppDist) {
      leadOppDist = d;
      leadOppIdx = i;
    }
  }

  // NOVICE BOT: Mostly follows shortest path, occasionally places a basic blocking wall if opponent is close
  if (difficulty === 'novice') {
    if (bot.wallsLeft > 0 && leadOppDist <= 4 && Math.random() < 0.45) {
      const candidates = getCandidateWalls(game.players, game.walls, botIdx);
      let bestWall: Wall | null = null;
      let bestGain = 0;

      for (const w of candidates) {
        const nextWalls = [...game.walls, w];
        const newOppDist = getShortestDistance(
          game.players[leadOppIdx].pawn,
          game.players[leadOppIdx].goalType,
          nextWalls
        );
        const newMyDist = getShortestDistance(bot.pawn, bot.goalType, nextWalls);
        const netGain = (newOppDist - leadOppDist) - (newMyDist - myCurrentDist);
        if (netGain > bestGain) {
          bestGain = netGain;
          bestWall = w;
        }
      }
      if (bestWall && bestGain >= 1) {
        return { type: 'WALL', wall: bestWall };
      }
    }
    // 80% best move, 20% second best move if available
    if (scoredPawnMoves.length > 1 && Math.random() < 0.2) {
      return { type: 'MOVE', to: scoredPawnMoves[1].move };
    }
    return { type: 'MOVE', to: bestPawnMove };
  }

  // TACTICIAN & GRANDMASTER: Evaluate candidate walls and run lookahead
  if (bot.wallsLeft <= 0) {
    return { type: 'MOVE', to: bestPawnMove };
  }

  const candidates = getCandidateWalls(game.players, game.walls, botIdx);
  const scoredWalls: { wall: Wall; score: number; netGain: number }[] = [];

  for (const w of candidates) {
    const nextWalls = [...game.walls, w];
    const newOppDist = getShortestDistance(
      game.players[leadOppIdx].pawn,
      game.players[leadOppIdx].goalType,
      nextWalls
    );
    const newMyDist = getShortestDistance(bot.pawn, bot.goalType, nextWalls);
    const netGain = (newOppDist - leadOppDist) - (newMyDist - myCurrentDist);

    if (netGain >= 1) {
      const nextPlayers = game.players.map((p, idx) =>
        idx === botIdx ? { ...p, wallsLeft: p.wallsLeft - 1 } : p
      );
      const score = evaluateState(nextPlayers, nextWalls, botIdx);
      scoredWalls.push({ wall: w, score, netGain });
    }
  }

  scoredWalls.sort((a, b) => b.score - a.score || b.netGain - a.netGain);

  if (difficulty === 'tactician') {
    // Tactician places a wall if it slows the opponent by >= 2 steps OR opponent is ahead and wall slows by >= 1
    const topWall = scoredWalls[0];
    if (
      topWall &&
      (topWall.netGain >= 2 || (leadOppDist <= myCurrentDist && topWall.netGain >= 1))
    ) {
      return { type: 'WALL', wall: topWall.wall };
    }
    return { type: 'MOVE', to: bestPawnMove };
  }

  // GRANDMASTER: 2-ply Minimax lookahead over top pawn moves and top 10 highest-impact walls
  const actionPool: { action: BotAction; immediateScore: number }[] = [];

  for (const pm of scoredPawnMoves.slice(0, 3)) {
    actionPool.push({
      action: { type: 'MOVE', to: pm.move },
      immediateScore: pm.evalScore,
    });
  }

  for (const sw of scoredWalls.slice(0, 10)) {
    actionPool.push({
      action: { type: 'WALL', wall: sw.wall },
      immediateScore: sw.score,
    });
  }

  let bestAction: BotAction = { type: 'MOVE', to: bestPawnMove };
  let bestMinimaxScore = -Infinity;

  for (const item of actionPool) {
    // Apply our action
    const simPlayers = game.players.map((p, idx) => {
      if (idx !== botIdx) return p;
      if (item.action.type === 'MOVE') {
        return { ...p, pawn: item.action.to };
      } else {
        return { ...p, wallsLeft: p.wallsLeft - 1 };
      }
    });
    const simWalls =
      item.action.type === 'WALL' ? [...game.walls, item.action.wall] : game.walls;

    // Simulate lead opponent's best response (move or high-gain wall against us)
    const oppMoves = getValidPawnMoves(leadOppIdx, simPlayers, simWalls);
    let worstReplyScore = Infinity;

    for (const om of oppMoves) {
      const replyPlayers = simPlayers.map((p, idx) =>
        idx === leadOppIdx ? { ...p, pawn: om } : p
      );
      const s = evaluateState(replyPlayers, simWalls, botIdx);
      if (s < worstReplyScore) {
        worstReplyScore = s;
      }
    }

    // Also check if opponent has walls and can trap/delay us heavily in response
    if (simPlayers[leadOppIdx].wallsLeft > 0) {
      const myPath = getShortestPath(
        simPlayers[botIdx].pawn,
        simPlayers[botIdx].goalType,
        simWalls
      );
      if (myPath && myPath.length > 0) {
        const checkCoords = [simPlayers[botIdx].pawn, ...myPath.slice(0, 2)];
        const tested = new Set<string>();
        for (const c of checkCoords) {
          for (const orient of ['H', 'V'] as const) {
            for (let dr = -1; dr <= 0; dr++) {
              for (let dc = -1; dc <= 0; dc++) {
                const wr = c.r + dr;
                const wc = c.c + dc;
                const k = `${wr},${wc},${orient}`;
                if (tested.has(k)) continue;
                tested.add(k);
                const oppWall: Wall = { r: wr, c: wc, orientation: orient };
                if (isWallPlacementValid(oppWall, simWalls, simPlayers).valid) {
                  const replyWalls = [...simWalls, oppWall];
                  const replyPlayers = simPlayers.map((p, idx) =>
                    idx === leadOppIdx ? { ...p, wallsLeft: p.wallsLeft - 1 } : p
                  );
                  const s = evaluateState(replyPlayers, replyWalls, botIdx);
                  if (s < worstReplyScore) {
                    worstReplyScore = s;
                  }
                }
              }
            }
          }
        }
      }
    }

    // Slight tie-breaker favoring progress when scores are equal unless opponent is dangerously close
    const tieBreak =
      item.action.type === 'MOVE' && leadOppDist > 3 ? 0.35 : 0;
    const totalScore = worstReplyScore + tieBreak;

    if (totalScore > bestMinimaxScore) {
      bestMinimaxScore = totalScore;
      bestAction = item.action;
    }
  }

  return bestAction;
}
