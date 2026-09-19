import { DiagramNotes, EdgeInfo } from '../types.ts';
import { cleanNodeId } from './nodeDragger.ts';

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
 * Robustly parses any edge key (canonical "from->to", with index "from->to#1",
 * or DOM id "L-from-to-0", "flowchart-from-to-0", "edge-from-to") into from, to, and optional index.
 */
export function parseEdgeKey(
  edgeKey: string,
  availableEdges?: EdgeInfo[]
): { from: string; to: string; index?: number; edge?: EdgeInfo } | null {
  if (!edgeKey) return null;

  // 1. Direct match with availableEdges by id or pathId
  if (availableEdges && availableEdges.length > 0) {
    const direct = availableEdges.find(
      (e) => e.id === edgeKey || (e.pathId && e.pathId === edgeKey)
    );
    if (direct) {
      return { from: direct.from, to: direct.to, edge: direct };
    }
  }

  // 2. Canonical "from->to" or "from->to#1"
  if (edgeKey.includes('->')) {
    const [rawFrom, rest] = edgeKey.split('->');
    const [rawTo, rawIndex] = (rest || '').split('#');
    const from = (rawFrom || '').trim();
    const to = (rawTo || '').trim();
    const idx = rawIndex ? parseInt(rawIndex, 10) : undefined;
    if (from && to) {
      const match = availableEdges?.find(
        (e) =>
          (e.from === from || cleanNodeId(e.from) === cleanNodeId(from)) &&
          (e.to === to || cleanNodeId(e.to) === cleanNodeId(to))
      );
      return {
        from: match?.from || from,
        to: match?.to || to,
        index: isNaN(idx!) ? undefined : idx,
        edge: match,
      };
    }
  }

  // 3. SVG DOM id formats: "L-From-To-0", "flowchart-From-To-0", "edge-From-To"
  const cleanKey = edgeKey.replace(/^(flowchart-|edge-|L-)/, '');
  if (availableEdges && availableEdges.length > 0) {
    for (const e of availableEdges) {
      const cf = cleanNodeId(e.from);
      const ct = cleanNodeId(e.to);
      if (
        (cleanKey.startsWith(e.from) || cleanKey.startsWith(cf)) &&
        (cleanKey.includes(e.to) || cleanKey.includes(ct))
      ) {
        return { from: e.from, to: e.to, edge: e };
      }
    }
  }

  // 4. Fallback regex on cleanKey: "From-To" or "From-To-0"
  const m = cleanKey.match(/^([A-Za-z0-9_.]+)-([A-Za-z0-9_.]+?)(?:-(\d+))?$/);
  if (m) {
    const from = m[1].trim();
    const to = m[2].trim();
    const idx = m[3] ? parseInt(m[3], 10) : undefined;
    if (from && to) {
      return { from, to, index: isNaN(idx!) ? undefined : idx };
    }
  }

  return null;
}

/**
 * Extracts all transitions/edges from Mermaid source code (both stateDiagram-v2 and flowchart).
 */
export function extractEdgesFromMermaid(code: string, notes?: DiagramNotes): EdgeInfo[] {
  const edges: EdgeInfo[] = [];
  const seenIds = new Set<string>();
  const isFlowchart = code.includes('flowchart') || code.includes('graph');

  if (isFlowchart) {
    // Match all flowchart transitions in document order:
    // A -->|Label| B or A -->|"Label"| B or A --> B or A -.->|Label| B or A ==> B
    const fcPattern = /^\s*([A-Za-z0-9_.-]+)(?:\[[^\]]*\]|\({1,2}[^)]*\){1,2}|\{[^}]*\})*\s*(?:-->|-.->|==>|---|--)\s*(?:\|"?([\s\S]*?)"?\|\s*)?([A-Za-z0-9_.-]+)(?:\[[^\]]*\]|\({1,2}[^)]*\){1,2}|\{[^}]*\})*/gm;
    let m: RegExpExecArray | null;
    while ((m = fcPattern.exec(code)) !== null) {
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
      const note =
        notes?.edges[id] ||
        notes?.edges[baseKey] ||
        (notes?.edges
          ? Object.entries(notes.edges).find(
              ([k]) =>
                (k.includes(from) && k.includes(to)) ||
                (k.includes(cleanNodeId(from)) && k.includes(cleanNodeId(to)))
            )?.[1]
          : undefined);
      edges.push({ id, from, to, label, hasNote: Boolean(note), note });
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
      const note =
        notes?.edges[id] ||
        notes?.edges[baseKey] ||
        (notes?.edges
          ? Object.entries(notes.edges).find(
              ([k]) =>
                (k.includes(from) && k.includes(to)) ||
                (k.includes(cleanNodeId(from)) && k.includes(cleanNodeId(to)))
            )?.[1]
          : undefined);
      edges.push({ id, from, to, label, hasNote: Boolean(note), note });
    }
  }

  return edges;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Injects user-defined notes for nodes and edges into Mermaid source code
 * so they render natively in the viewer and in mermaid.live.
 */
export function applyNotesToMermaid(
  mermaidCode: string,
  notes: DiagramNotes
): string {
  if (!mermaidCode || (!Object.keys(notes.nodes || {}).length && !Object.keys(notes.edges || {}).length)) {
    return mermaidCode;
  }

  const isFlowchart = mermaidCode.includes('flowchart') || mermaidCode.includes('graph');
  let result = mermaidCode;

  // 1. Apply Edge Notes
  const edgeEntries = Object.entries(notes.edges || {}).filter(([, note]) => Boolean(note && note.trim()));
  if (edgeEntries.length > 0) {
    const availableEdges = extractEdgesFromMermaid(result, notes);

    for (const [edgeKey, rawNote] of edgeEntries) {
      const parsed = parseEdgeKey(edgeKey, availableEdges);
      if (!parsed) continue;

      const { from, to, index } = parsed;
      // Multi-line note formatting for Mermaid edge label HTML (<br/>)
      const cleanNote = sanitizeNoteForMermaid(rawNote)
        .replace(/\r\n/g, '<br/>')
        .replace(/[\r\n]/g, '<br/>')
        .trim();
      if (!cleanNote) continue;

      const targetIndex = index !== undefined && !isNaN(index) ? index : 0;

      if (isFlowchart) {
        const fromCandidates = Array.from(new Set([from, cleanNodeId(from)])).filter(Boolean);
        const toCandidates = Array.from(new Set([to, cleanNodeId(to)])).filter(Boolean);
        const escFrom = fromCandidates.map(escapeRegex).join('|');
        const escTo = toCandidates.map(escapeRegex).join('|');
        const shapePattern = '(?:\\[[^\\]]*\\]|\\({1,2}[^)]*\\){1,2}|\\{[^}]*\\})*';

        const rxFlowchartEdge = new RegExp(
          `^([ \\t]*(?:${escFrom})${shapePattern}[ \\t]*(?:-->|-.->|==>|---|--)[ \\t]*)(?:\\|"?([\\s\\S]*?)"?\\|[ \\t]*)?((?:${escTo})${shapePattern}[ \\t]*)\\r?$`,
          'gm'
        );

        let matchCount = 0;
        let didReplace = false;

        result = result.replace(rxFlowchartEdge, (full, prefix, existingLabel, suffix) => {
          if (matchCount === targetIndex || (!didReplace && matchCount >= targetIndex)) {
            didReplace = true;
            matchCount++;
            const cleanLabel = (existingLabel || '').replace(/<br\s*\/?>\s*📝?.*$/, '').trim();
            const combined = cleanLabel ? `${cleanLabel}<br/>${cleanNote}` : cleanNote;
            return `${prefix}|"${combined}"| ${suffix}`;
          }
          matchCount++;
          return full;
        });

        // Fallback: if not replaced yet (e.g. index didn't match), replace first match
        if (!didReplace) {
          result = result.replace(rxFlowchartEdge, (full, prefix, existingLabel, suffix) => {
            if (!didReplace) {
              didReplace = true;
              const cleanLabel = (existingLabel || '').replace(/<br\s*\/?>\s*📝?.*$/, '').trim();
              const combined = cleanLabel ? `${cleanLabel}<br/>${cleanNote}` : cleanNote;
              return `${prefix}|"${combined}"| ${suffix}`;
            }
            return full;
          });
        }
      } else {
        // stateDiagram-v2:
        const fromCandidates = Array.from(new Set([from, cleanNodeId(from)])).filter(Boolean);
        const toCandidates = Array.from(new Set([to, cleanNodeId(to)])).filter(Boolean);
        const escFrom = fromCandidates.map(escapeRegex).join('|');
        const escTo = toCandidates.map(escapeRegex).join('|');

        const rxStateEdge = new RegExp(
          `^([ \\t]*(?:${escFrom})[ \\t]*-->[ \\t]*(?:${escTo})[ \\t]*)(?::[ \\t]*([^\\n\\r]+))?\\r?$`,
          'gm'
        );

        let matchCount = 0;
        let didReplace = false;

        result = result.replace(rxStateEdge, (full, prefix, existingLabel) => {
          if (matchCount === targetIndex || (!didReplace && matchCount >= targetIndex)) {
            didReplace = true;
            matchCount++;
            const cleanLabel = (existingLabel || '').replace(/<br\s*\/?>\s*📝?.*$/, '').trim();
            const combined = cleanLabel ? `${cleanLabel}<br/>${cleanNote}` : cleanNote;
            return `${prefix}: ${combined}`;
          }
          matchCount++;
          return full;
        });

        if (!didReplace) {
          result = result.replace(rxStateEdge, (full, prefix, existingLabel) => {
            if (!didReplace) {
              didReplace = true;
              const cleanLabel = (existingLabel || '').replace(/<br\s*\/?>\s*📝?.*$/, '').trim();
              const combined = cleanLabel ? `${cleanLabel}<br/>${cleanNote}` : cleanNote;
              return `${prefix}: ${combined}`;
            }
            return full;
          });
        }
      }
    }
  }

  // 2. Apply Node Notes
  const nodeEntries = Object.entries(notes.nodes).filter(([, note]) => Boolean(note && note.trim()));
  if (nodeEntries.length > 0) {
    if (isFlowchart) {
      const pendingStyles: string[] = [];

      for (const [rawNodeId, rawNote] of nodeEntries) {
        const cleanId = cleanNodeId(rawNodeId) || rawNodeId;
        let targetNodeId = cleanId;
        if (new RegExp(`\\b${escapeRegex(cleanId)}\\b`).test(result)) {
          targetNodeId = cleanId;
        } else if (new RegExp(`\\b${escapeRegex(rawNodeId)}\\b`).test(result)) {
          targetNodeId = rawNodeId;
        }

        const cleanNote = sanitizeNoteForMermaid(rawNote)
          .split('\n')
          .map((l) => l.trim())
          .join('<br/>');
        const safeNodeId = targetNodeId.replace(/[^A-Za-z0-9_]/g, '_');
        const noteNodeId = `note_${safeNodeId}`;

        // Get user custom style for this note if configured
        const noteStyle = notes.styles?.[rawNodeId] || notes.styles?.[cleanId] || notes.styles?.[targetNodeId];
        const fill = noteStyle?.fill || '#fffbeb';
        const color = noteStyle?.color || '#78350f';
        const stroke = noteStyle?.stroke || '#f59e0b';
        const strokeWidth = noteStyle?.strokeWidth || '1.5px';

        const noteSnippet = [
          `    ${noteNodeId}["${cleanNote}"]`,
          `    ${targetNodeId} -.- ${noteNodeId}`,
          `    style ${noteNodeId} fill:${fill},color:${color},stroke:${stroke},stroke-width:${strokeWidth}`,
        ].join('\n');

        // Check if node declaration exists in the code so we can inject INSIDE the same subgraph
        const rxDecl = new RegExp(
          `^([ \\t]*${escapeRegex(targetNodeId)}(?:\\[[^\\]]*\\]|\\([^\\)]*\\)|\\{[^\\}]*\\})[ \\t]*)$`,
          'm'
        );
        const rxTransition = new RegExp(
          `^([ \\t]*${escapeRegex(targetNodeId)}[ \\t]*(?:-->|-.->|==>|---|--)[^\\n]*)$`,
          'm'
        );

        if (rxDecl.test(result)) {
          result = result.replace(rxDecl, `$1\n${noteSnippet}`);
        } else if (rxTransition.test(result)) {
          result = result.replace(rxTransition, `$1\n${noteSnippet}`);
        } else {
          // Fallback: append at end of flowchart
          pendingStyles.push(noteSnippet);
        }
      }

      if (pendingStyles.length > 0) {
        result = `${result.trimEnd()}\n\n    %% Custom Node Notes\n${pendingStyles.join('\n')}\n`;
      }
    } else {
      // stateDiagram-v2 supports native notes:
      // note right of StateId
      //     content
      // end note
      const pendingNotes: string[] = [];

      for (const [rawNodeId, rawNote] of nodeEntries) {
        const cleanId = cleanNodeId(rawNodeId) || rawNodeId;
        let targetNodeId = cleanId;
        if (new RegExp(`\\b${escapeRegex(cleanId)}\\b`).test(result)) {
          targetNodeId = cleanId;
        } else if (new RegExp(`\\b${escapeRegex(rawNodeId)}\\b`).test(result)) {
          targetNodeId = rawNodeId;
        }

        const lines = sanitizeNoteForMermaid(rawNote)
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length === 0) continue;

        const noteLines: string[] = [];
        noteLines.push(`    note right of ${targetNodeId}`);
        for (const line of lines) {
          noteLines.push(`        ${line}`);
        }
        noteLines.push(`    end note`);
        const noteBlock = noteLines.join('\n');

        // Try injecting directly where the state is defined or used so it stays inside composite states
        const rxStateDef = new RegExp(
          `^([ \\t]*(?:state\\s+"[^"]+"\\s+as\\s+${escapeRegex(targetNodeId)}|state\\s+${escapeRegex(targetNodeId)}|${escapeRegex(targetNodeId)})[ \\t]*)$`,
          'm'
        );
        const rxStateTrans = new RegExp(
          `^([ \\t]*(?:${escapeRegex(targetNodeId)}|\\[\\*\\])[ \\t]*-->[ \\t]*${escapeRegex(targetNodeId)}[^\\n]*)$`,
          'm'
        );

        if (rxStateDef.test(result)) {
          result = result.replace(rxStateDef, `$1\n${noteBlock}`);
        } else if (rxStateTrans.test(result)) {
          result = result.replace(rxStateTrans, `$1\n${noteBlock}`);
        } else {
          pendingNotes.push(noteBlock);
        }
      }

      if (pendingNotes.length > 0) {
        result = `${result.trimEnd()}\n\n    %% Custom State Notes\n${pendingNotes.join('\n')}\n`;
      }
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
