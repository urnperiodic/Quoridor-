import React from 'react';
import { X } from 'lucide-react';

interface RulesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RulesModal: React.FC<RulesModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-[#3E2F23] bg-[#211A14] p-6 md:p-8 text-[#F5EFE6] shadow-2xl max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#342820] pb-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-[#F5EFE6]">
              Official Quoridor Rules
            </h2>
            <p className="text-sm text-[#A89888] mt-0.5">
              Designed by Mirko Marchesi · Abstract Strategy Board Game
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#A89888] hover:bg-[#2E241C] hover:text-[#F5EFE6] transition-colors"
            aria-label="Close rules"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-6 space-y-6 text-sm leading-relaxed text-[#D8CBB8]">
          <section>
            <h3 className="text-base font-semibold text-[#F5EFE6] mb-1.5">
              01. Objective of the Game
            </h3>
            <p>
              Be the first player to navigate your pawn from the center of your starting baseline to{' '}
              <strong className="text-[#F5EFE6]">any of the 9 squares on the opposite side</strong> of the board.
              In a 2-player match, each player starts with <strong className="text-[#F5EFE6]">10 walls</strong>.
              In a 4-player match, each player starts with <strong className="text-[#F5EFE6]">5 walls</strong>.
            </p>
          </section>

          <section>
            <h3 className="text-base font-semibold text-[#F5EFE6] mb-1.5">
              02. Turn Choices: Move Pawn or Place Wall
            </h3>
            <p>
              On your turn, you must perform <strong className="text-[#F5EFE6]">exactly one action</strong>:
              either move your pawn one step orthogonally (forward, backward, left, or right) by clicking a
              highlighted square, or place a two-square-long wooden wall into a groove intersection.
            </p>
          </section>

          <section>
            <h3 className="text-base font-semibold text-[#F5EFE6] mb-1.5">
              03. Face-to-Face Jumping & Diagonal Redirection
            </h3>
            <ul className="space-y-2 list-disc pl-5">
              <li>
                <strong className="text-[#F5EFE6]">Straight Jump:</strong> When two pawns stand on adjacent squares
                with no wall between them, the active player may jump straight over the adjacent pawn and land on the
                vacant square immediately behind it.
              </li>
              <li>
                <strong className="text-[#F5EFE6]">Diagonal Side-Step:</strong> If there is a wall, board edge, or
                another pawn directly behind the opponent&apos;s pawn preventing a straight jump, you may divert to the
                left or right (diagonally) onto an unobstructed square immediately beside the opponent&apos;s pawn.
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-base font-semibold text-[#F5EFE6] mb-1.5">
              04. The Golden Rule of Walls (No Complete Trapping)
            </h3>
            <p>
              Walls span across two squares and block movement across that groove. Walls cannot overlap or cross one
              another. Most importantly, <strong className="text-[#F5EFE6]">you may never completely lock a player in</strong>:
              every placement is verified via Breadth-First Search (BFS) to guarantee that all players retain at least
              one open corridor to their goal baseline.
            </p>
          </section>

          <section className="rounded-lg border border-[#342820] bg-[#19130F] p-4">
            <h3 className="text-sm font-semibold text-[#F5EFE6] mb-2">
              Controls & Shortcuts
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-[#A89888]">
              <div>
                <span className="text-[#F5EFE6] font-medium">Move Pawn:</span> Click any green-highlighted square
              </div>
              <div>
                <span className="text-[#F5EFE6] font-medium">Place Wall:</span> Hover & click any groove intersection
              </div>
              <div>
                <span className="text-[#F5EFE6] font-medium">Rotate Wall (H / V):</span> Press <kbd className="px-1.5 py-0.5 rounded bg-[#2C221B] text-[#F5EFE6] font-mono-tabular">R</kbd>, <kbd className="px-1.5 py-0.5 rounded bg-[#2C221B] text-[#F5EFE6] font-mono-tabular">Space</kbd>, or Right-Click
              </div>
              <div>
                <span className="text-[#F5EFE6] font-medium">Path Inspector:</span> Toggle BFS shortest routes on the board
              </div>
            </div>
          </section>
        </div>

        <div className="mt-6 flex justify-end border-t border-[#342820] pt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#D99B52] text-[#16120E] text-sm font-semibold hover:bg-[#E4AC68] transition-colors whitespace-nowrap shrink-0"
          >
            Got It, Back to Board
          </button>
        </div>
      </div>
    </div>
  );
};
