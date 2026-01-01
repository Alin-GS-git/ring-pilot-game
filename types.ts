
export enum GameState {
  START = 'START',
  PLAYING = 'PLAYING',
  GAMEOVER = 'GAMEOVER'
}

export interface Point {
  x: number;
  y: number;
}

export interface Plane {
  y: number;
  targetY: number;
  velocity: number;
  width: number;
  height: number;
  angle: number;
}

export interface Ring {
  id: number;
  x: number;
  y: number;
  radius: number;
  thickness: number;
  passed: boolean;
}

export interface Mine {
  id: number;
  x: number;
  y: number;
  radius: number;
  rotation: number;
}

export interface OpposingObstacle {
  id: number;
  x: number;
  y: number;
  radius: number;
  rotation: number;
  flicker: number;
}

export interface Cloud {
  id: number;
  x: number;
  y: number;
  scale: number;
  speed: number;
  layer: 'far' | 'mid';
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size?: number;
}

export interface ScoreVisual {
  x: number;
  y: number;
  text: string;
  life: number;
}
