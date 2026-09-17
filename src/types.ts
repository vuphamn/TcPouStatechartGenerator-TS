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
