import { Card, GameState } from './game.types';
import { generateDeck, shuffle, isSet, findSet } from './game.utils';

const INITIAL_BOARD_SIZE = 12;

// Scoring constants
export const SCORE_CORRECT = 3;
export const SCORE_INCORRECT = -1;

// Initializes a fresh game state
export function initGame(): GameState {
  const deck = shuffle(generateDeck());
  const board: Card[] = deck.slice(0, INITIAL_BOARD_SIZE);
  const remaining = deck.slice(INITIAL_BOARD_SIZE);
  return {
    deck: remaining,
    board,
    selected: [],
    score: 0,
    correctSets: 0,
    incorrectSelections: 0,
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
  };

  const idx = newState.selected.findIndex((c) => c.id === card.id);
  if (idx >= 0) {
    // deselect
    newState.selected.splice(idx, 1);
    return newState;
  }

  if (newState.selected.length >= 3) {
    // reset selection and add the new one
    newState.selected = [card];
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
      newState.score = Math.max(0, newState.score + SCORE_INCORRECT);
      newState.incorrectSelections += 1;
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
  let board = state.board.slice();

  // Remove selected cards by id
  const selectedIds = new Set(selected.map((c) => c.id));
  board = board.filter((c) => !selectedIds.has(c.id));

  // Draw cards to fill up to INITIAL_BOARD_SIZE if possible
  while (board.length < INITIAL_BOARD_SIZE && deck.length > 0) {
    board.push(deck.shift() as Card);
  }

  return {
    deck,
    board,
    selected: [],
    score: state.score + SCORE_CORRECT,
    correctSets: state.correctSets + 1,
    incorrectSelections: state.incorrectSelections,
  };
}
