import pako from 'pako';

export function getMermaidLiveUrl(code: string): string {
  const state = {
    code,
    mermaid: JSON.stringify({ theme: 'default' }),
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
