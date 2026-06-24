export interface DraftPixel {
  id: string;
  x: number;
  y: number;
  color: string;
}

export interface CanvasData {
  colors: (string | null)[];
  owners: (string | null)[];
  frozen: boolean[];
  frozenOwners: (string | null)[];
  startX: number;
  startY: number;
  w: number;
  h: number;
}