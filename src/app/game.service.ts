import { Card, GameState, BOARD_SIZE } from './game.types';
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
      // penalize: remove the 3 cards from the board (replaced from deck if
      // possible, otherwise the board shrinks), then clear selection.
      newState.incorrectSelections += 1;
      newState.score = newState.correctSets - newState.incorrectSelections;
      const negIds = new Set(newState.selected.map((c) => c.id));
      const board: typeof newState.board = [];
      for (const boardCard of newState.board) {
        if (negIds.has(boardCard.id)) {
          if (newState.deck.length > 0) {
            board.push(newState.deck.shift() as Card);
          }
          // deck empty — slot dropped, board shrinks
        } else {
          board.push(boardCard);
        }
      }
      newState.board = board;
      newState.selected = [];

      // After removing neg cards, check if the game should end.
      const hasSetAfterNeg = findSet(board) !== null;
      if (newState.deck.length === 0 && !hasSetAfterNeg) {
        newState.status = 'finished';
      }

      return newState;
    }
  }

  return newState;
}

// Remove the selected set from the board and replenish from the deck if needed.
// Rules:
//   - If the board is at the standard size (12), replace the 3 removed cards in-place
//     so the layout stays stable.
//   - If the board is extended (15, 18, ...), remove the 3 cards and check the remainder:
//     if a set still exists, leave it (drain back toward 12); if no set exists, deal 3
//     more cards so play can continue.
//   - In either case, if the board still has no set after the above, deal 3 cards at a
//     time until a set appears or the deck is exhausted.
// Throws if called with anything other than exactly 3 cards forming a valid set.
export function applySet(state: GameState, selected: Card[]): GameState {
  if (selected.length !== 3) {
    throw new Error('applySet requires exactly 3 selected cards');
  }
  if (!isSet(selected[0], selected[1], selected[2])) {
    throw new Error('applySet called with an invalid set');
  }

  const deck = state.deck.slice();
  let board = state.board.slice();

  const selectedIds = new Set(selected.map((c) => c.id));

  if (board.length <= BOARD_SIZE && deck.length > 0) {
    // Board is at standard size: swap each removed card with one from the deck,
    // preserving the positions of all other cards.
    for (let i = 0; i < board.length; i++) {
      if (selectedIds.has(board[i].id)) {
        board[i] = deck.shift() as Card;
      }
    }
  } else {
    // Board is extended (or deck empty): remove the 3 cards first, then check
    // whether the remainder already contains a set before deciding to replenish.
    board = board.filter((c) => !selectedIds.has(c.id));
    // If a set exists in the remainder, do nothing — the board drains naturally
    // toward 12. The while loop below will not fire in this case.
  }

  // If the board has no valid set after the above, deal 3 cards at a time until
  // one appears or the deck is exhausted. Guard deck.length >= 3 to avoid
  // shifting undefined on a deck whose size isn't a clean multiple of 3.
  while (findSet(board) === null && deck.length >= 3) {
    board.push(deck.shift() as Card);
    board.push(deck.shift() as Card);
    board.push(deck.shift() as Card);
  }

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