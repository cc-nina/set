import { Card, GameState } from './game.types';
import { dealInitialBoard, isSet, findSet } from './game.utils';

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

// Select or deselect a card. If 3 cards are selected, evaluate set and apply if valid.
export function selectCard(state: GameState, card: Card): GameState {
  // copy shallow to keep immutability for callers
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
    // deselect
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
      // apply set
      return applySet(newState, newState.selected);
    } else {
      // penalize and clear selection
      newState.incorrectSelections += 1;
      newState.score = newState.correctSets - newState.incorrectSelections;
      newState.selected = [];
      return newState;
    }
  }

  return newState;
}

// Remove the selected set from board and draw new cards from deck to maintain board size.
// Validates the set; returns new state. If invalid, throws an Error.
export function applySet(state: GameState, selected: Card[]): GameState {
  if (selected.length !== 3) {
    throw new Error('applySet requires exactly 3 selected cards');
  }

  if (!isSet(selected[0], selected[1], selected[2])) {
    throw new Error('applySet called with an invalid set');
  }

  // We'll operate on copies
  const deck = state.deck.slice();
  const board = state.board.slice();

  const selectedIds = new Set(selected.map((c) => c.id));
  for (let i = 0; i < board.length; i++) {
    if (selectedIds.has(board[i].id)) {
      if (deck.length > 0) {
        // Deck has cards — replace in-place so the layout stays stable.
        board[i] = deck.shift() as Card;
      } else {
        // Deck is empty — remove the card. Remaining cards stay in position,
        // just like a real game where empty spaces are left on the table.
        board.splice(i, 1);
        i--;
      }
    }
  }

  // Per official rules: if no set exists after removing the found set,
  // deal one extra card at a time until a set is present or the deck runs out.
  let hasSet = findSet(board) !== null;
  while (!hasSet && deck.length > 0) {
    board.push(deck.shift() as Card);
    hasSet = findSet(board) !== null;
  }

  return {
    deck,
    board,
    selected: [],
    score: state.correctSets + 1 - state.incorrectSelections,
    correctSets: state.correctSets + 1,
    incorrectSelections: state.incorrectSelections,
    // Game is finished when no valid set remains and the deck is exhausted.
    status: deck.length === 0 && !hasSet ? 'finished' : 'active',
  };
}
