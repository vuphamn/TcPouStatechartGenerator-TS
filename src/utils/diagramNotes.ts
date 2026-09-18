import { DiagramNotes, EdgeInfo } from '../types.ts';

/**
 * Escapes characters that could break Mermaid syntax.
 */
export function sanitizeNoteForMermaid(note: string): string {
  if (!note) return '';
  return note
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/"/g, "'")
    .trim();
}

/**
 * Normalizes an edge identifier from source and target state IDs.
 */
export function getEdgeKey(from: string, to: string): string {
  return `${from.trim()}->${to.trim()}`;
}

/**
 * Extracts all transitions/edges from Mermaid source code (both stateDiagram-v2 and flowchart).
 */
export function extractEdgesFromMermaid(code: string, notes?: DiagramNotes): EdgeInfo[] {
  const edges: EdgeInfo[] = [];
  const seenIds = new Set<string>();
  const isFlowchart = code.includes('flowchart') || code.includes('graph');

  if (isFlowchart) {
    // Match flowchart transitions:
    // A -->|Label| B or A -->|"Label"| B or A -.->|Label| B or A ==>|Label| B
    const fcLabelPattern = /^\s*([A-Za-z0-9_.-]+)(?:\[[^\]]*\]|\([^\)]*\)|\{[^\}]*\})?\s*(?:-->|-.->|==>|---|--)\s*\|"?(.*?)"?\|\s*([A-Za-z0-9_.-]+)(?:\[[^\]]*\]|\([^\)]*\)|\{[^\}]*\})?/gm;
    let m: RegExpExecArray | null;
    while ((m = fcLabelPattern.exec(code)) !== null) {
      const from = m[1].trim();
      const label = m[2]?.trim();
      const to = m[3].trim();
      if (from === 'startNode' || to === 'startNode') continue;
      const baseKey = getEdgeKey(from, to);
      let id = baseKey;
      if (seenIds.has(id)) {
        id = `${baseKey}#${edges.length}`;
      }
      seenIds.add(id);
      const note = notes?.edges[baseKey] || (notes?.edges[id]);
      edges.push({ id, from, to, label, hasNote: Boolean(note), note });
    }

    // Match flowchart simple transitions (without pipe label):
    // A --> B or A --> B["Text"]
    const fcSimplePattern = /^\s*([A-Za-z0-9_.-]+)(?:\[[^\]]*\]|\([^\)]*\)|\{[^\}]*\})?\s*(?:-->|-.->|==>|---|--)\s*(?!\|)\s*([A-Za-z0-9_.-]+)(?:\[[^\]]*\]|\([^\)]*\)|\{[^\}]*\})?/gm;
    while ((m = fcSimplePattern.exec(code)) !== null) {
      const from = m[1].trim();
      const to = m[2].trim();
      if (from === 'startNode' || to === 'startNode') continue;
      const baseKey = getEdgeKey(from, to);
      let id = baseKey;
      if (seenIds.has(id)) {
        id = `${baseKey}#${edges.length}`;
      }
      seenIds.add(id);
      const note = notes?.edges[baseKey] || (notes?.edges[id]);
      edges.push({ id, from, to, hasNote: Boolean(note), note });
    }
  } else {
    // stateDiagram-v2 transitions:
    // From --> To: Label
    // From --> To
    const sdPattern = /^\s*([A-Za-z0-9_.-]+|\[\*\])\s*-->\s*([A-Za-z0-9_.-]+|\[\*\])(?:\s*:\s*([^\n]+))?/gm;
    let m: RegExpExecArray | null;
    while ((m = sdPattern.exec(code)) !== null) {
      const from = m[1].trim();
      const to = m[2].trim();
      if (from === '[*]' && to === '[*]') continue;
      const label = m[3]?.trim();
      const baseKey = getEdgeKey(from, to);
      let id = baseKey;
      if (seenIds.has(id)) {
        id = `${baseKey}#${edges.length}`;
      }
      seenIds.add(id);
      const note = notes?.edges[baseKey] || (notes?.edges[id]);
      edges.push({ id, from, to, label, hasNote: Boolean(note), note });
    }
  }

  return edges;
}

/**
 * Injects user-defined notes for nodes and edges into Mermaid source code
 * so they render natively in the viewer and in mermaid.live.
 */
export function applyNotesToMermaid(
  mermaidCode: string,
  notes: DiagramNotes
): string {
  if (!mermaidCode || (!Object.keys(notes.nodes).length && !Object.keys(notes.edges).length)) {
    return mermaidCode;
  }

  const isFlowchart = mermaidCode.includes('flowchart') || mermaidCode.includes('graph');
  let result = mermaidCode;

  // 1. Apply Edge Notes
  const edgeEntries = Object.entries(notes.edges).filter(([, note]) => Boolean(note && note.trim()));
  if (edgeEntries.length > 0) {
    for (const [edgeKey, rawNote] of edgeEntries) {
      const parts = edgeKey.split('->');
      if (parts.length !== 2) continue;
      const from = parts[0].trim();
      const to = parts[1].trim();
      const cleanNote = sanitizeNoteForMermaid(rawNote).replace(/\n/g, ' ');
      const noteBadge = `📝 ${cleanNote}`;

      if (isFlowchart) {
        // Find existing labeled transition: from -->|"..."| to
        const rxWithLabel = new RegExp(
          `^(\\s*${from}\\s*-->\\|")([^"]*)("\\|\\s*${to}\\s*)$`,
          'm'
        );
        if (rxWithLabel.test(result)) {
          result = result.replace(rxWithLabel, (_full, p1, p2, p3) => {
            // Strip any prior note badge from p2 if already present
            const cleanLabel = p2.replace(/<br\s*\/?>\s*📝[^\"]*$/, '').trim();
            const combined = cleanLabel ? `${cleanLabel}<br/>${noteBadge}` : noteBadge;
            return `${p1}${combined}${p3}`;
          });
        } else {
          // Find unlabeled transition: from --> to
          const rxSimple = new RegExp(`^(\\s*${from}\\s*-->)\\s*(${to}\\s*)$`, 'm');
          if (rxSimple.test(result)) {
            result = result.replace(rxSimple, `$1|"${noteBadge}"| $2`);
          }
        }
      } else {
        // stateDiagram-v2:
        // Find from --> to: label
        const rxWithLabel = new RegExp(
          `^(\\s*${from.replace(/\[/g, '\\[').replace(/\]/g, '\\]')}\\s*-->\\s*${to.replace(/\[/g, '\\[').replace(/\]/g, '\\]')}\\s*:\\s*)([^\\n]+)$`,
          'm'
        );
        if (rxWithLabel.test(result)) {
          result = result.replace(rxWithLabel, (_full, p1, p2) => {
            const cleanLabel = p2.replace(/<br\s*\/?>\s*📝[^\n]*$/, '').trim();
            const combined = cleanLabel ? `${cleanLabel} <br/>${noteBadge}` : noteBadge;
            return `${p1}${combined}`;
          });
        } else {
          // Find from --> to without label
          const rxSimple = new RegExp(
            `^(\\s*${from.replace(/\[/g, '\\[').replace(/\]/g, '\\]')}\\s*-->\\s*${to.replace(/\[/g, '\\[').replace(/\]/g, '\\]')}\\s*)$`,
            'm'
          );
          if (rxSimple.test(result)) {
            result = result.replace(rxSimple, `$1: ${noteBadge}`);
          }
        }
      }
    }
  }

  // 2. Apply Node Notes
  const nodeEntries = Object.entries(notes.nodes).filter(([, note]) => Boolean(note && note.trim()));
  if (nodeEntries.length > 0) {
    if (isFlowchart) {
      const fcNoteLines: string[] = ['\n    %% Custom Node Notes'];
      for (const [nodeId, rawNote] of nodeEntries) {
        const cleanNote = sanitizeNoteForMermaid(rawNote)
          .split('\n')
          .map((l) => l.trim())
          .join('<br/>');
        const noteNodeId = `note_${nodeId}`;
        fcNoteLines.push(
          `    ${noteNodeId}["📝 Note (${nodeId}):<br/>${cleanNote}"]:::mermaidNote`
        );
        fcNoteLines.push(`    ${nodeId} -.- ${noteNodeId}`);
      }
      fcNoteLines.push(
        `    classDef mermaidNote fill:#fffbeb,stroke:#f59e0b,stroke-dasharray: 4 4,color:#78350f,font-size:12px;`
      );
      result = `${result.trimEnd()}\n${fcNoteLines.join('\n')}\n`;
    } else {
      // stateDiagram-v2 supports official native notes:
      // note right of StateId
      //     content
      // end note
      const sdNoteLines: string[] = ['\n    %% Custom State Notes'];
      for (const [nodeId, rawNote] of nodeEntries) {
        const lines = sanitizeNoteForMermaid(rawNote)
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length === 0) continue;

        sdNoteLines.push(`    note right of ${nodeId}`);
        for (const line of lines) {
          sdNoteLines.push(`        ${line}`);
        }
        sdNoteLines.push(`    end note`);
      }
      result = `${result.trimEnd()}\n${sdNoteLines.join('\n')}\n`;
    }
  }

  return result;
}

/**
 * Counts the total number of notes currently set.
 */
export function countTotalNotes(notes: DiagramNotes): number {
  const nodeNotesCount = Object.values(notes.nodes).filter((n) => Boolean(n && n.trim())).length;
  const edgeNotesCount = Object.values(notes.edges).filter((n) => Boolean(n && n.trim())).length;
  return nodeNotesCount + edgeNotesCount;
}
