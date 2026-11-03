import React, { useState } from 'react';
import {
  BOARD_SIZE,
  Coord,
  coordToNotation,
  GameData,
  getShortestPath,
  getValidPawnMoves,
  isWallPlacementValid,
  Wall,
  WALL_GRID_SIZE,
  WallOrientation,
} from '../lib/quoridor.ts';

interface QuoridorBoardProps {
  game: GameData;
  canInteract: boolean;
  wallOrientation: WallOrientation;
  onToggleOrientation: () => void;
  onAction: (action: { type: 'MOVE'; to: Coord } | { type: 'WALL'; wall: Wall }) => void;
  showShortestPath: boolean;
  onValidationFeedback?: (message: string | null) => void;
}

export const QuoridorBoard: React.FC<QuoridorBoardProps> = ({
  game,
  canInteract,
  wallOrientation,
  onToggleOrientation,
  onAction,
  showShortestPath,
  onValidationFeedback,
}) => {
  const [hoverWall, setHoverWall] = useState<{ r: number; c: number } | null>(null);
  const [hoveredSquare, setHoveredSquare] = useState<Coord | null>(null);

  const activePlayer = game.players[game.currentTurn];
  const validMoves =
    canInteract && game.winner === null
      ? getValidPawnMoves(game.currentTurn, game.players, game.walls)
      : [];

  // Shortest paths for players when tactical overlay is toggled on
  const shortestPaths = showShortestPath
    ? game.players.map((p) => ({
        player: p,
        path: getShortestPath(p.pawn, p.goalType, game.walls) || [],
      }))
    : [];

  // Evaluate ghost wall validity on hover
  const candidateWall: Wall | null =
    canInteract &&
    game.winner === null &&
    hoverWall &&
    activePlayer.wallsLeft > 0
      ? { r: hoverWall.r, c: hoverWall.c, orientation: wallOrientation }
      : null;

  const wallValidation = candidateWall
    ? isWallPlacementValid(candidateWall, game.walls, game.players)
    : null;

  const handleIntersectionEnter = (r: number, c: number) => {
    setHoverWall({ r, c });
    if (canInteract && activePlayer.wallsLeft > 0) {
      const check = isWallPlacementValid(
        { r, c, orientation: wallOrientation },
        game.walls,
        game.players
      );
      onValidationFeedback?.(check.valid ? null : check.reason || 'Invalid wall');
    }
  };

  const handleIntersectionLeave = () => {
    setHoverWall(null);
    onValidationFeedback?.(null);
  };

  const handleIntersectionClick = (r: number, c: number) => {
    if (!canInteract || game.winner !== null) return;
    if (activePlayer.wallsLeft <= 0) {
      onValidationFeedback?.('No walls remaining in your reserve');
      return;
    }
    const candidate: Wall = { r, c, orientation: wallOrientation };
    const check = isWallPlacementValid(candidate, game.walls, game.players);
    if (!check.valid) {
      onValidationFeedback?.(check.reason || 'Invalid wall placement');
      return;
    }
    setHoverWall(null);
    onValidationFeedback?.(null);
    onAction({ type: 'WALL', wall: candidate });
  };

  // Board geometry constants (SVG viewBox 0 0 620 620)
  // Outer rim: 28px padding, 9 cells of 52px = 468px, 8 grooves of 12px = 96px -> Total inner grid = 564px
  // 28 + 564 + 28 = 620
  const PADDING = 28;
  const CELL = 52;
  const GROOVE = 12;
  const STEP = CELL + GROOVE; // 64

  const getCellTopLeft = (r: number, c: number) => ({
    x: PADDING + c * STEP,
    y: PADDING + r * STEP,
  });

  const getCellCenter = (r: number, c: number) => ({
    cx: PADDING + c * STEP + CELL / 2,
    cy: PADDING + r * STEP + CELL / 2,
  });

  const getIntersectionCenter = (r: number, c: number) => ({
    ix: PADDING + c * STEP + CELL + GROOVE / 2,
    iy: PADDING + r * STEP + CELL + GROOVE / 2,
  });

  const renderWallRect = (
    w: Wall,
    isGhost: boolean = false,
    isValidGhost: boolean = true
  ) => {
    const { ix, iy } = getIntersectionCenter(w.r, w.c);
    const totalSpan = CELL * 2 + GROOVE; // 116px long
    const thickness = GROOVE - 2; // 10px thick

    const x = w.orientation === 'H' ? ix - totalSpan / 2 : ix - thickness / 2;
    const y = w.orientation === 'H' ? iy - thickness / 2 : iy - totalSpan / 2;
    const width = w.orientation === 'H' ? totalSpan : thickness;
    const height = w.orientation === 'H' ? thickness : totalSpan;

    const fill = !isGhost
      ? '#D99B52'
      : isValidGhost
      ? 'rgba(245, 158, 11, 0.72)'
      : 'rgba(239, 68, 68, 0.75)';

    const stroke = !isGhost
      ? '#8A561E'
      : isValidGhost
      ? '#FDE68A'
      : '#FCA5A5';

    return (
      <g
        key={`${isGhost ? 'ghost' : 'wall'}-${w.r}-${w.c}-${w.orientation}`}
        className="pointer-events-none"
      >
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={3}
          fill={fill}
          stroke={stroke}
          strokeWidth={1.5}
        />
        {!isGhost && (
          <line
            x1={w.orientation === 'H' ? x + 4 : x + width / 2}
            y1={w.orientation === 'H' ? y + height / 2 : y + 4}
            x2={w.orientation === 'H' ? x + width - 4 : x + width / 2}
            y2={w.orientation === 'H' ? y + height / 2 : y + height - 4}
            stroke="rgba(255, 248, 231, 0.35)"
            strokeWidth={1.25}
            strokeLinecap="round"
          />
        )}
      </g>
    );
  };

  // Last move highlight
  const lastAction =
    game.history.length > 0 ? game.history[game.history.length - 1] : null;

  return (
    <div
      className="relative select-none flex items-center justify-center w-full h-full max-w-[min(100%,calc(100vh-148px))] max-h-[calc(100vh-148px)] aspect-square"
      onContextMenu={(e) => {
        e.preventDefault();
        onToggleOrientation();
      }}
    >
      <svg
        viewBox="0 0 620 620"
        className="w-full h-full rounded-2xl shadow-2xl border border-[#3E2F23] bg-[#1E1712]"
      >
        <defs>
          <radialGradient id="boardSurface" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="#2A2019" />
            <stop offset="100%" stopColor="#1A140F" />
          </radialGradient>
          <filter id="pawnShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#000000" floodOpacity="0.65" />
          </filter>
        </defs>

        {/* Outer Wooden Frame */}
        <rect
          x="2"
          y="2"
          width="616"
          height="616"
          rx="14"
          fill="url(#boardSurface)"
          stroke="#4A3728"
          strokeWidth="2"
        />

        {/* Goal Line Subtle Directional Indicators */}
        {/* North Goal (Row 0 - Player 0 Ivory target) */}
        <line
          x1={PADDING}
          y1={PADDING - 6}
          x2={620 - PADDING}
          y2={PADDING - 6}
          stroke="#F5EFE6"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.65"
        />
        {/* South Goal (Row 8 - Player 1/2 Terracotta target) */}
        <line
          x1={PADDING}
          y1={620 - PADDING + 6}
          x2={620 - PADDING}
          y2={620 - PADDING + 6}
          stroke="#E05A47"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.65"
        />
        {game.playerCount === 4 && (
          <>
            {/* East Goal (Col 8 - West Amber Player 1 target) */}
            <line
              x1={620 - PADDING + 6}
              y1={PADDING}
              x2={620 - PADDING + 6}
              y2={620 - PADDING}
              stroke="#F59E0B"
              strokeWidth="3"
              strokeLinecap="round"
              opacity="0.65"
            />
            {/* West Goal (Col 0 - East Jade Player 3 target) */}
            <line
              x1={PADDING - 6}
              y1={PADDING}
              x2={PADDING - 6}
              y2={620 - PADDING}
              stroke="#10B981"
              strokeWidth="3"
              strokeLinecap="round"
              opacity="0.65"
            />
          </>
        )}

        {/* Algebraic Coordinate Labels (a-i on bottom/top, 1-9 on left/right) */}
        {Array.from({ length: BOARD_SIZE }).map((_, idx) => {
          const fileChar = String.fromCharCode(97 + idx);
          const rankChar = String(9 - idx);
          const { cx } = getCellCenter(0, idx);
          const { cy } = getCellCenter(idx, 0);

          return (
            <g key={`coord-${idx}`} className="font-mono-tabular">
              <text
                x={cx}
                y={620 - 9}
                textAnchor="middle"
                fill="#8C7A6B"
                fontSize="11"
                fontWeight="600"
              >
                {fileChar}
              </text>
              <text
                x={12}
                y={cy + 4}
                textAnchor="middle"
                fill="#8C7A6B"
                fontSize="11"
                fontWeight="600"
              >
                {rankChar}
              </text>
            </g>
          );
        })}

        {/* 9x9 Carved Squares */}
        {Array.from({ length: BOARD_SIZE }).map((_, r) =>
          Array.from({ length: BOARD_SIZE }).map((__, c) => {
            const { x, y } = getCellTopLeft(r, c);
            const isLegalDest = validMoves.some((m) => m.r === r && m.c === c);
            const isLastFrom =
              lastAction?.type === 'MOVE' &&
              lastAction.from?.r === r &&
              lastAction.from?.c === c;
            const isLastTo =
              lastAction?.type === 'MOVE' &&
              lastAction.to?.r === r &&
              lastAction.to?.c === c;
            const isHovered =
              hoveredSquare?.r === r && hoveredSquare?.c === c && isLegalDest;

            // Subtle goal row tint for clarity
            const isNorthEdge = r === 0;
            const isSouthEdge = r === 8;

            let squareFill = '#33261E';
            if (isHovered) {
              squareFill = '#48382B';
            } else if (isLastTo) {
              squareFill = '#3F3024';
            } else if (isNorthEdge || isSouthEdge) {
              squareFill = '#382A21';
            }

            return (
              <g
                key={`cell-${r}-${c}`}
                onClick={() => {
                  if (isLegalDest) {
                    onAction({ type: 'MOVE', to: { r, c } });
                  }
                }}
                onMouseEnter={() => setHoveredSquare({ r, c })}
                onMouseLeave={() => setHoveredSquare(null)}
                className={isLegalDest ? 'cursor-pointer' : 'cursor-default'}
              >
                <rect
                  x={x}
                  y={y}
                  width={CELL}
                  height={CELL}
                  rx={6}
                  fill={squareFill}
                  stroke={
                    isLegalDest
                      ? 'rgba(16, 185, 129, 0.65)'
                      : isLastFrom || isLastTo
                      ? 'rgba(217, 155, 82, 0.45)'
                      : '#45352A'
                  }
                  strokeWidth={isLegalDest ? 1.75 : 1}
                />

                {/* Legal Pawn Move Target Indicator */}
                {isLegalDest && (
                  <g className="pointer-events-none">
                    <circle
                      cx={x + CELL / 2}
                      cy={y + CELL / 2}
                      r={isHovered ? 12 : 9}
                      fill="rgba(16, 185, 129, 0.28)"
                      stroke="#10B981"
                      strokeWidth={2}
                    />
                    <text
                      x={x + CELL / 2}
                      y={y + CELL - 5}
                      textAnchor="middle"
                      fill="#A7F3D0"
                      fontSize="9"
                      className="font-mono-tabular"
                    >
                      {coordToNotation({ r, c })}
                    </text>
                  </g>
                )}
              </g>
            );
          })
        )}

        {/* Optional Shortest Path BFS Overlay */}
        {showShortestPath &&
          shortestPaths.map(({ player, path }) => {
            if (path.length === 0) return null;
            const allPoints = [player.pawn, ...path];
            const pointsAttr = allPoints
              .map((pt) => {
                const { cx, cy } = getCellCenter(pt.r, pt.c);
                return `${cx},${cy}`;
              })
              .join(' ');

            return (
              <polyline
                key={`path-${player.id}`}
                points={pointsAttr}
                fill="none"
                stroke={player.color}
                strokeWidth="3"
                strokeDasharray="5 5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.55"
                className="pointer-events-none"
              />
            );
          })}

        {/* Placed Corridor Walls */}
        {game.walls.map((w) => renderWallRect(w, false))}

        {/* Ghost Wall Preview on Hover */}
        {candidateWall &&
          wallValidation &&
          renderWallRect(candidateWall, true, wallValidation.valid)}

        {/* Pawns */}
        {game.players.map((p, idx) => {
          const { cx, cy } = getCellCenter(p.pawn.r, p.pawn.c);
          const isTurn = game.currentTurn === idx && game.winner === null;

          return (
            <g
              key={`pawn-${p.id}`}
              className="pointer-events-none transition-transform duration-150"
              filter="url(#pawnShadow)"
            >
              {/* Active Turn Halo */}
              {isTurn && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={22}
                  fill="none"
                  stroke={p.color}
                  strokeWidth="2"
                  strokeDasharray="4 3"
                  opacity="0.85"
                />
              )}
              {/* Outer Pawn Base */}
              <circle
                cx={cx}
                cy={cy}
                r={17}
                fill={p.color}
                stroke="#16120E"
                strokeWidth="2.5"
              />
              {/* Inner Carved Ring for Tactile Wood Pawn Look */}
              <circle
                cx={cx}
                cy={cy}
                r={10}
                fill="none"
                stroke="rgba(22, 18, 14, 0.35)"
                strokeWidth="2"
              />
              {/* Center Crown Dot */}
              <circle
                cx={cx - 3}
                cy={cy - 3}
                r={3}
                fill="rgba(255, 255, 255, 0.45)"
              />
            </g>
          );
        })}

        {/* 8x8 Groove Intersection Hit Targets for Placing Walls */}
        {canInteract &&
          game.winner === null &&
          activePlayer.wallsLeft > 0 &&
          Array.from({ length: WALL_GRID_SIZE }).map((_, r) =>
            Array.from({ length: WALL_GRID_SIZE }).map((__, c) => {
              const { ix, iy } = getIntersectionCenter(r, c);
              const isHovered = hoverWall?.r === r && hoverWall?.c === c;
              return (
                <g key={`intersect-${r}-${c}`}>
                  {/* Subtle groove vertex dot */}
                  <circle
                    cx={ix}
                    cy={iy}
                    r={isHovered ? 4.5 : 2}
                    fill={isHovered ? '#F59E0B' : 'rgba(140, 122, 107, 0.28)'}
                    className="pointer-events-none"
                  />
                  {/* Generous 28x28 hit target centered on groove intersection */}
                  <rect
                    x={ix - 14}
                    y={iy - 14}
                    width={28}
                    height={28}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => handleIntersectionEnter(r, c)}
                    onMouseLeave={handleIntersectionLeave}
                    onClick={() => handleIntersectionClick(r, c)}
                  />
                </g>
              );
            })
          )}
      </svg>
    </div>
  );
};
