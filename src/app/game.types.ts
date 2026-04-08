export type Attr = 1 | 2 | 3;

export interface Card {
  id: string;
  number: Attr;
  color: Attr;
  shape: Attr;
  shading: Attr;
}

export interface GameState {
  deck: Card[]; // remaining deck (top is index 0)
  board: Card[]; // visible cards on the table
  selected: Card[]; // currently selected cards (max 3)
  score: number;
  correctSets: number; // number of correctly found sets
  incorrectSelections: number; // number of incorrect selection attempts
}
