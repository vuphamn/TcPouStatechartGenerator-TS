export interface NodeDisplayProperties {
  fill?: string;
  color?: string;
  stroke?: string;
  strokeWidth?: string;
}

export type CustomNodeStylesMap = Record<string, NodeDisplayProperties>;

export interface StateNodeInfo {
  id: string;
  label: string;
  isCustomized?: boolean;
  style?: NodeDisplayProperties;
}

export interface ColorPreset {
  id: string;
  name: string;
  fill: string;
  color: string;
  stroke: string;
  strokeWidth: string;
  description: string;
}

export interface EdgeInfo {
  id: string; // e.g. "STATE_INIT->STATE_IDLE"
  from: string;
  to: string;
  label?: string;
  hasNote?: boolean;
  note?: string;
}

export interface NotePosition {
  x: number;
  y: number;
}

export interface DiagramNotes {
  nodes: Record<string, string>; // nodeId -> note text
  edges: Record<string, string>; // edgeId ("from->to") -> note text
  positions?: Record<string, NotePosition>; // targetId -> { x, y } in diagram canvas coordinates
}

export type ContextMenuTarget =
  | { type: 'node'; id: string; label: string; note?: string }
  | { type: 'edge'; id: string; from: string; to: string; label?: string; note?: string }
  | { type: 'canvas'; x: number; y: number };
