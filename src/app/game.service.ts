import { Card, GameState } from './game.types';
import { dealInitialBoard, isSet, findSet, applyFoundSet } from './game.utils';

// Initializes a fresh game state
export function initGame(): GameState {
  const { board, deck } = dealInitialBoard();
  return {
    deck,
    board,
    selected: [],
    score: 0,
    correctSets: 0,
    incorrectSelections: 0,
    status: 'active',
  };
}

// Select or deselect a card. If 3 cards are selected, evaluate the selection:
//   - Valid set → apply it (cards removed, deck replenished, score updated).
//   - Invalid set → penalise (cards stay on board, score decremented, selection
//     cleared). lastNegCardIds is set so the animation layer knows which 3 to shake.
export function selectCard(state: GameState, card: Card): GameState {
  // Shallow-copy all mutable fields to preserve immutability for callers.
  const newState: GameState = {
    deck: state.deck.slice(),
    board: state.board.slice(),
    selected: state.selected.slice(),
    score: state.score,
    correctSets: state.correctSets,
    incorrectSelections: state.incorrectSelections,
    status: state.status,
  };

  const idx = newState.selected.findIndex((c) => c.id === card.id);
  if (idx >= 0) {
    // Deselect an already-selected card.
    newState.selected.splice(idx, 1);
    return newState;
  }

  if (newState.selected.length >= 3) {
    // Already have 3 selected — ignore further clicks until evaluated.
    return newState;
  }

  newState.selected.push(card);

  if (newState.selected.length === 3) {
    const [a, b, c] = newState.selected;
    if (isSet(a, b, c)) {
      return applySet(newState, newState.selected);
    } else {
      // Invalid selection: penalise but keep the 3 cards on the board.
      newState.incorrectSelections += 1;
      newState.score = newState.correctSets - newState.incorrectSelections;
      newState.lastNegCardIds = newState.selected.map((c) => c.id);
      newState.selected = [];
      return newState;
    }
  }

  return newState;
}

// Remove the selected set from the board and replenish from the deck if needed.
// Rules:
//   - If the board is at the standard size (12), replace the 3 removed cards
//     in-place so the layout stays stable.
//   - If the board is extended (15, 18, ...), remove the 3 cards and check the
//     remainder: if a set still exists, leave it (drain back toward 12); the
//     while loop below handles the no-set case uniformly.
//   - In either case, if the board still has no set after the above, deal 3
//     cards at a time until a set appears or the deck is exhausted.
// Throws if called with anything other than exactly 3 cards forming a valid set.
export function applySet(state: GameState, selected: Card[]): GameState {
  if (selected.length !== 3) {
    throw new Error('applySet requires exactly 3 selected cards');
  }
  if (!isSet(selected[0], selected[1], selected[2])) {
    throw new Error('applySet called with an invalid set');
  }

  const selectedIds = new Set(selected.map((c) => c.id));
  const { board, deck } = applyFoundSet(state.board, state.deck, selectedIds);
  const hasSet = findSet(board) !== null;

  return {
    deck,
    board,
    selected: [],
    score: state.correctSets + 1 - state.incorrectSelections,
    correctSets: state.correctSets + 1,
    incorrectSelections: state.incorrectSelections,
    // Game ends when the deck is empty and no set remains on the board.
    status: deck.length === 0 && !hasSet ? 'finished' : 'active',
  };
}