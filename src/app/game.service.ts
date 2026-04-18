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

// Select or deselect a card. If 3 cards are selected, evaluate the selection:
//   - Valid set → apply it (cards removed, deck replenished, score updated).
//   - Invalid set → penalise (cards removed from board, score decremented,
//     selection cleared). The component's animation layer temporarily restores
//     the old board to show the shake animation before the removal lands.
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
      // Invalid selection: penalise and remove the 3 cards from the board.
      // Replacement from the deck follows the same rules as applySet — in-place
      // swap if at standard size, drop-and-drain if extended.
      newState.incorrectSelections += 1;
      newState.score = newState.correctSets - newState.incorrectSelections;

      const negIds = new Set(newState.selected.map((c) => c.id));

      if (newState.board.length <= BOARD_SIZE && newState.deck.length > 0) {
        // Standard size: replace in-place to keep layout stable.
        for (let i = 0; i < newState.board.length; i++) {
          if (negIds.has(newState.board[i].id)) {
            newState.board[i] = newState.deck.shift() as Card;
          }
        }
      } else {
        // Extended (or deck empty): remove the 3 cards without replacing.
        newState.board = newState.board.filter((c) => !negIds.has(c.id));
      }

      newState.selected = [];

      // Check for end-of-game: deck exhausted and no set remains.
      if (newState.deck.length === 0 && findSet(newState.board) === null) {
        newState.status = 'finished';
      }

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
    // Board is extended (or deck empty): remove the 3 cards. If a set exists
    // in the remainder the while loop below won't fire and the board drains
    // naturally toward 12. If no set exists the while loop replenishes.
    board = board.filter((c) => !selectedIds.has(c.id));
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