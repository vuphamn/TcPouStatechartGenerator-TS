import pako from 'pako';

export type LayoutEngine = 'dagre' | 'elk';
export type FlowchartCurve = 'basis' | 'linear' | 'cardinal' | 'stepAfter' | 'monotoneX' | 'natural';
export type MermaidTheme = 'dark' | 'neutral' | 'forest' | 'base' | 'default';

export interface MermaidLiveOptions {
  layout?: LayoutEngine;
  curve?: FlowchartCurve;
  theme?: MermaidTheme;
}

export function getMermaidLiveUrl(code: string, options?: MermaidLiveOptions): string {
  const layout = options?.layout ?? 'elk';
  const curve = options?.curve ?? 'basis';
  const theme = options?.theme ?? 'dark';

  const state = {
    code,
    mermaid: JSON.stringify({
      theme,
      layout,
      flowchart: { curve, htmlLabels: true },
      state: { useMaxWidth: false },
    }),
    autoSync: true,
    updateDiagram: true,
  };
  const jsonStr = JSON.stringify(state);
  const data = new TextEncoder().encode(jsonStr);
  const compressed = pako.deflate(data, { level: 9 });

  let binary = '';
  for (let i = 0; i < compressed.byteLength; i++) {
    binary += String.fromCharCode(compressed[i]);
  }
  const base64 = btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `https://mermaid.live/edit#pako:${base64}`;
}
