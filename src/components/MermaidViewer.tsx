import React, { useEffect, useRef, useState, useMemo } from 'react';
import mermaid from 'mermaid';
import elkLayouts from '@mermaid-js/layout-elk';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Minimize2,
  AlertCircle,
  Copy,
  Check,
  Download,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  Palette,
  Move,
  StickyNote,
  FileImage,
  FileCode,
  Sparkles,
  Sliders,
  MousePointerClick,
  SlidersHorizontal,
} from 'lucide-react';
import { StateNodeStyleInspector } from './StateNodeStyleInspector.tsx';
import { DiagramContextMenu } from './DiagramContextMenu.tsx';
import { NoteDialog } from './NoteDialog.tsx';
import { NotesDrawer } from './NotesDrawer.tsx';
import { NoteOverlaysLayer } from './NoteOverlaysLayer.tsx';
import { ExportModal } from './ExportModal.tsx';
import { EdgeConditionDetailOverlay } from './EdgeConditionDetailOverlay.tsx';
import { createInteractiveMermaidCode } from '../utils/interactiveDiagram.ts';
import {
  exportHighResSvg,
  exportHighResPng,
  copyToClipboard,
  triggerDownload,
  ExportFormat,
  ExportScale,
} from '../utils/diagramExport.ts';
import {
  CustomNodeStylesMap,
  NodeDisplayProperties,
  DiagramNotes,
  ContextMenuTarget,
  EdgeInfo,
  NotePosition,
} from '../types.ts';
import { extractStateNodesFromMermaid } from '../utils/nodeStyles.ts';
import {
  extractEdgesFromMermaid,
  countTotalNotes,
} from '../utils/diagramNotes.ts';
import {
  NodeOffsetsMap,
  EdgeOffsetsMap,
  EdgeOffset,
  initializeSvgDragMetadata,
  applyDiagramOffsetsToSvg,
  resetSvgDiagramOffsets,
  cleanNodeId,
  findNodeElement,
  findEdgePathElement,
  getEdgeAnchorPoint,
  parseTranslation,
} from '../utils/nodeDragger.ts';
import {
  CanvasNodePositionsMap,
  extractCanvasNodePositions,
} from '../utils/canvasPositions.ts';

export type LayoutEngine = 'dagre' | 'elk';
export type FlowchartCurve = 'basis' | 'linear' | 'cardinal' | 'stepAfter' | 'monotoneX' | 'natural';
export type MermaidTheme = 'dark' | 'neutral' | 'forest' | 'base' | 'default';

let elkRegistered = false;
function ensureElkRegistered() {
  if (!elkRegistered && typeof mermaid.registerLayoutLoaders === 'function') {
    try {
      mermaid.registerLayoutLoaders(elkLayouts);
      elkRegistered = true;
    } catch (e) {
      console.warn('Failed to register ELK layout loaders:', e);
    }
  }
}

export interface MermaidViewerProps {
  code: string;
  layoutEngine?: LayoutEngine;
  flowchartCurve?: FlowchartCurve;
  mermaidTheme?: MermaidTheme;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  selectedStateId?: string | null;
  selectedStateLabel?: string;
  onSelectState?: (stateId: string | null, label?: string) => void;
  customStyles?: CustomNodeStylesMap;
  onStyleChange?: (stateId: string, style: NodeDisplayProperties) => void;
  onResetStateStyle?: (stateId: string) => void;
  onClearAllCustomStyles?: () => void;
  nodeOffsets?: NodeOffsetsMap;
  onNodeOffsetsChange?: (offsets: NodeOffsetsMap) => void;
  notes?: DiagramNotes;
  onSaveNote?: (target: ContextMenuTarget, noteText: string) => void;
  onDeleteNote?: (target: ContextMenuTarget) => void;
  onClearAllNotes?: () => void;
  onUpdateNotePosition?: (targetId: string, pos: NotePosition) => void;
  onUpdateNoteStyle?: (targetId: string, style: NodeDisplayProperties | null) => void;
  onCanvasPositionsChange?: (positions: CanvasNodePositionsMap) => void;
  onOpenMermaidLive?: () => void;
  fileName?: string;
  interactiveMode?: boolean;
  onInteractiveModeChange?: (enabled: boolean) => void;
}

interface SearchMatchItem {
  type: 'state' | 'transition';
  name: string;
  element: Element;
  associatedPaths?: Element[];
}

interface ParsedPath {
  pathEl: Element;
  startX: number;
  startY: number;
  dirX: number;
  dirY: number;
  allPoints: { x: number; y: number }[];
  classes: string;
  id: string;
}

function extractPriorityFromText(text: string): { priority: number; symbol: string } | null {
  if (!text) return null;
  // Check (1) or (2)...
  const mParen = text.match(/(?:^|\s)\((\d+)\)/);
  if (mParen) {
    return { priority: parseInt(mParen[1], 10), symbol: `(${mParen[1]})` };
  }
  // Check [1] or [2]...
  const mBracket = text.match(/(?:^|\s)\[(\d+)\]/);
  if (mBracket) {
    return { priority: parseInt(mBracket[1], 10), symbol: `[${mBracket[1]}]` };
  }
  // Check Unicode circled numbers ①..⑳ (0x2460..0x2473)
  for (let i = 1; i <= 20; i++) {
    const sym = String.fromCodePoint(0x2460 + i - 1);
    if (text.includes(sym)) return { priority: i, symbol: sym };
  }
  // Check ㉑..㉟ (0x3251..0x325f)
  for (let i = 21; i <= 35; i++) {
    const sym = String.fromCodePoint(0x3251 + i - 21);
    if (text.includes(sym)) return { priority: i, symbol: sym };
  }
  // Check ㊱..㊿ (0x32b1..0x32bf)
  for (let i = 36; i <= 50; i++) {
    const sym = String.fromCodePoint(0x32b1 + i - 36);
    if (text.includes(sym)) return { priority: i, symbol: sym };
  }
  const m = text.match(/\[priority:\s*(\d+)\]/i);
  if (m) {
    return { priority: parseInt(m[1], 10), symbol: m[0] };
  }
  return null;
}

function parsePathData(p: Element): ParsedPath | null {
  const d = p.getAttribute('d');
  if (!d) return null;
  const numbers = d.match(/-?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 2) return null;

  const allPoints: { x: number; y: number }[] = [];
  for (let i = 0; i < numbers.length - 1; i += 2) {
    allPoints.push({ x: parseFloat(numbers[i]), y: parseFloat(numbers[i + 1]) });
  }
  if (allPoints.length === 0) return null;

  const startX = allPoints[0].x;
  const startY = allPoints[0].y;
  let dirX = 0;
  let dirY = 1;

  if (allPoints.length > 1) {
    const dx = allPoints[1].x - startX;
    const dy = allPoints[1].y - startY;
    const len = Math.hypot(dx, dy);
    if (len > 0.0001) {
      dirX = dx / len;
      dirY = dy / len;
    }
  }

  const parent = p.parentElement;
  const classes = `${p.getAttribute('class') || ''} ${parent?.getAttribute('class') || ''}`;
  const id = `${p.getAttribute('id') || ''} ${parent?.getAttribute('id') || ''}`;

  return { pathEl: p, startX, startY, dirX, dirY, allPoints, classes, id };
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

function minDistanceToPath(labelPt: { x: number; y: number }, pathPts: { x: number; y: number }[]): number {
  let minDist = Infinity;
  for (let i = 0; i < pathPts.length - 1; i++) {
    const d = distToSegment(labelPt.x, labelPt.y, pathPts[i].x, pathPts[i].y, pathPts[i + 1].x, pathPts[i + 1].y);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function getLabelPos(el: Element): { x: number; y: number } | null {
  let cur: Element | null = el;
  while (cur && cur.nodeName.toLowerCase() !== 'svg') {
    const tf = cur.getAttribute('transform');
    if (tf) {
      const tm = tf.match(/translate\(\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)\s*\)/);
      if (tm) return { x: parseFloat(tm[1]), y: parseFloat(tm[2]) };
      const mm = tf.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)\s*\)/);
      if (mm) return { x: parseFloat(mm[1]), y: parseFloat(mm[2]) };
    }
    cur = cur.parentElement;
  }
  const textEl = el.querySelector('text') || el;
  const x = textEl.getAttribute('x');
  const y = textEl.getAttribute('y');
  if (x && y) {
    return { x: parseFloat(x), y: parseFloat(y) };
  }
  return null;
}

function cleanSymbolFromLabel(labelEl: Element, symbol: string) {
  try {
    const doc = labelEl.ownerDocument;
    const walker = doc.createTreeWalker(labelEl, 4 /* NodeFilter.SHOW_TEXT */);
    let textNode = walker.nextNode();
    while (textNode) {
      if (textNode.nodeValue && textNode.nodeValue.includes(symbol)) {
        textNode.nodeValue = textNode.nodeValue.replace(symbol, '').trim();
        break;
      }
      textNode = walker.nextNode();
    }
  } catch {
    // Fallback if TreeWalker is unsupported
    if (labelEl.textContent && labelEl.textContent.includes(symbol)) {
      labelEl.textContent = labelEl.textContent.replace(symbol, '').trim();
    }
  }
}

function resolveEdgeFromElement(
  targetEl: Element,
  svg: SVGSVGElement | null,
  availableEdges: EdgeInfo[]
): EdgeInfo | null {
  // 0. Click on edge handle (start, end, or waypoint handle)
  const handleEl = targetEl.closest('.tc-edge-handle');
  if (handleEl) {
    const handleEdgeId = handleEl.getAttribute('data-edge-id');
    if (handleEdgeId) {
      const srcId = handleEl.getAttribute('data-source-id');
      const tgtId = handleEl.getAttribute('data-target-id');
      const found = availableEdges.find(
        (e) => e.id === handleEdgeId || (srcId && tgtId && e.from === srcId && e.to === tgtId)
      );
      if (found) return { ...found, id: handleEdgeId };
      return { id: handleEdgeId, from: srcId || '', to: tgtId || '' };
    }
  }

  // 1. Direct path / hitbox element / edge group
  const pathEl = (targetEl.closest('path.tc-edge-path') ||
    targetEl.closest('.tc-edge-hitbox') ||
    targetEl.closest('g.edgePath') ||
    targetEl.closest('g.edgePaths path') ||
    targetEl.closest('[data-edge-id]')) as Element | null;

  if (pathEl) {
    const realPath = pathEl.classList.contains('tc-edge-hitbox')
      ? (pathEl.previousElementSibling as SVGPathElement | null) || pathEl
      : (pathEl.tagName.toLowerCase() === 'path' ? pathEl : pathEl.querySelector('path') || pathEl);

    const pathId =
      realPath.getAttribute('data-path-id') ||
      realPath.getAttribute('id') ||
      pathEl.getAttribute('data-path-id') ||
      pathEl.getAttribute('id') ||
      '';

    let sourceId =
      realPath.getAttribute('data-source-id') ||
      pathEl.getAttribute('data-source-id') ||
      '';
    let targetId =
      realPath.getAttribute('data-target-id') ||
      pathEl.getAttribute('data-target-id') ||
      '';

    const idStr = `${realPath.getAttribute('id') || pathEl.getAttribute('id') || ''}`;

    if (!sourceId || !targetId) {
      const classStr = `${pathEl.getAttribute('class') || ''} ${realPath.getAttribute('class') || ''} ${pathEl.parentElement?.getAttribute('class') || ''}`;
      const ls = classStr.match(/\bLS-([A-Za-z0-9_]+)\b/);
      const le = classStr.match(/\bLE-([A-Za-z0-9_]+)\b/);
      if (ls) sourceId = ls[1];
      if (le) targetId = le[1];

      if (!sourceId || !targetId) {
        // Direct search across availableEdges against idStr
        for (const e of availableEdges) {
          const cf = cleanNodeId(e.from);
          const ct = cleanNodeId(e.to);
          const patterns = [
            `L_${e.from}_${e.to}`,
            `L-${e.from}-${e.to}`,
            `_${e.from}_${e.to}_`,
            `-${e.from}-${e.to}-`,
            `_${cf}_${ct}_`,
            `-${cf}-${ct}-`,
            `L_${cf}_${ct}`,
            `L-${cf}-${ct}`,
          ];
          if (patterns.some((p) => idStr.includes(p))) {
            sourceId = e.from;
            targetId = e.to;
            break;
          }
        }
      }

      if (!sourceId || !targetId) {
        // Strip renderer prefixes like mermaid-123-L_ or testelk-L_
        const stripped = idStr
          .replace(/^.*?[_-]L[_-]/, '')
          .replace(/^(?:flowchart|edge)[_-]/, '')
          .replace(/^L[_-]/, '');
        const m = stripped.match(/^([A-Za-z0-9_.]+?)[_-]([A-Za-z0-9_.]+?)(?:[_-](\d+))?$/);
        if (m) {
          sourceId = m[1];
          targetId = m[2];
        }
      }
    }

    // Try finding matching edge in availableEdges
    let matchedEdge = pathId
      ? availableEdges.find((e) => e.id === pathId || (e.pathId && e.pathId === pathId))
      : null;
    if (!matchedEdge && sourceId && targetId) {
      matchedEdge = availableEdges.find(
        (e) =>
          (e.from === sourceId || cleanNodeId(e.from) === cleanNodeId(sourceId)) &&
          (e.to === targetId || cleanNodeId(e.to) === cleanNodeId(targetId))
      );
    }

    if (matchedEdge) {
      return {
        ...matchedEdge,
        id: matchedEdge.id,
        pathId: pathId || matchedEdge.pathId,
        from: matchedEdge.from,
        to: matchedEdge.to,
      };
    }

    if (sourceId && targetId) {
      return {
        id: `${sourceId}->${targetId}`,
        pathId: pathId || undefined,
        from: sourceId,
        to: targetId,
      };
    }

    if (pathId) {
      return {
        id: pathId,
        pathId,
        from: '',
        to: '',
      };
    }
  }

  // 2. Edge label element
  const labelEl = (targetEl.closest('g.edgeLabel') ||
    targetEl.closest('.clickable-edge-label') ||
    targetEl.closest('.tc-interactive-edge-label')) as SVGGElement | null;
  if (labelEl) {
    const directEdgeId = labelEl.getAttribute('data-edge-id');
    if (directEdgeId) {
      const match = availableEdges.find(
        (e) => e.id === directEdgeId || `${e.from}->${e.to}` === directEdgeId || e.pathId === directEdgeId
      );
      if (match) return match;
    }

    const linkedPathId = labelEl.getAttribute('data-linked-path-id');
    if (linkedPathId && svg) {
      const p = svg.querySelector(
        `path[data-path-id="${linkedPathId}"], path[data-edge-id="${linkedPathId}"], path#${linkedPathId}`
      ) as SVGPathElement | null;
      if (p) return resolveEdgeFromElement(p, svg, availableEdges);
    }

    const text = labelEl.textContent?.trim() || '';
    if (text) {
      const cleanLabelText = text
        .replace(/📝.*$/, '')
        .replace(/▾/g, '')
        .replace(/\.\.\./g, '')
        .replace(/\(\+\d+\)/g, '')
        .replace(/^[①-⑳㉑-㉟㊱-㊿]\s*/, '')
        .replace(/^\(\d+\)\s*/, '')
        .replace(/^\[\d+\]\s*/, '')
        .trim();
      const match = availableEdges.find((e) => {
        const fullCandidate = (e.condition || e.label || '').trim();
        if (!fullCandidate) return false;
        const eClean = fullCandidate
          .replace(/📝.*$/, '')
          .replace(/^[①-⑳㉑-㉟㊱-㊿]\s*/, '')
          .replace(/^\(\d+\)\s*/, '')
          .replace(/^\[\d+\]\s*/, '')
          .trim();
        return (
          eClean &&
          (cleanLabelText.includes(eClean) ||
            eClean.includes(cleanLabelText) ||
            (cleanLabelText.length >= 4 &&
              eClean.toLowerCase().startsWith(cleanLabelText.slice(0, Math.min(cleanLabelText.length, 12)).toLowerCase())) ||
            (eClean.length >= 4 &&
              cleanLabelText.toLowerCase().startsWith(eClean.slice(0, Math.min(eClean.length, 12)).toLowerCase())))
        );
      });
      if (match) return match;
    }

    if (svg) {
      const allLabels = Array.from(svg.querySelectorAll('g.edgeLabels g.edgeLabel'));
      const idx = allLabels.indexOf(labelEl);
      if (idx >= 0 && idx < availableEdges.length) {
        return availableEdges[idx];
      }
    }
  }

  // 3. Priority badge element
  const badgeEl = targetEl.closest('.tc-priority-badge') as SVGGElement | null;
  if (badgeEl && svg) {
    const pathId = badgeEl.getAttribute('data-path-id');
    if (pathId) {
      const p = svg.querySelector(
        `path[data-path-id="${pathId}"], path[data-edge-id="${pathId}"], path#${pathId}`
      ) as SVGPathElement | null;
      if (p) return resolveEdgeFromElement(p, svg, availableEdges);
    }
  }

  return null;
}

/**
 * Finds an edge whose rendered SVG path is within `tolerance` pixels of the screen click point.
 * Ensures effortless edge selection even if clicking slightly off the thin line.
 */
export function findEdgeNearPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  availableEdges: EdgeInfo[],
  tolerance: number = 24
): EdgeInfo | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const svgPt = pt.matrixTransform(ctm.inverse());

  const paths = Array.from(
    svg.querySelectorAll<SVGPathElement>('path.tc-edge-path, g.edgePaths path[data-orig-d], g.edgePaths path')
  ).filter(
    (p) => !p.closest('defs') && !p.closest('marker') && p.getAttribute('d') && !p.classList.contains('tc-edge-hitbox')
  );

  let bestEdge: EdgeInfo | null = null;
  let bestDist = tolerance;

  for (const path of paths) {
    try {
      const len = path.getTotalLength();
      if (len <= 0) continue;
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const p = path.getPointAtLength((i / steps) * len);
        const dist = Math.hypot(p.x - svgPt.x, p.y - svgPt.y);
        if (dist < bestDist) {
          const resolved = resolveEdgeFromElement(path, svg, availableEdges);
          if (resolved && resolved.from?.trim() && resolved.to?.trim()) {
            bestDist = dist;
            bestEdge = resolved;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return bestEdge;
}

function enhanceSvgWithPriorityCircles(
  svgString: string,
  selectedStateId?: string | null,
  customStyles?: CustomNodeStylesMap,
  selectedEdgeId?: string | null,
  notes?: DiagramNotes,
  isInteractiveMode?: boolean,
  activeEdgeId?: string | null
): string {
  if (typeof window === 'undefined' || !svgString) return svgString;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgEl = doc.documentElement;
    if (!svgEl || svgEl.nodeName.toLowerCase() === 'parsererror') return svgString;

    // 1. Mark state nodes with data attributes, clickability, and selection classes
    const nodes = Array.from(doc.querySelectorAll('g.node'));
    for (const node of nodes) {
      const id = node.getAttribute('id') || '';
      let rawId = cleanNodeId(id);
      if (!rawId) {
        const dataId = node.getAttribute('data-id') || node.getAttribute('data-node-id');
        if (dataId) rawId = cleanNodeId(dataId);
      }
      if (!rawId) {
        const labelText = node.querySelector('.nodeLabel')?.textContent?.trim() || node.textContent?.trim();
        if (labelText) rawId = cleanNodeId(labelText);
      }
      if (rawId && rawId !== 'root_start' && rawId !== 'root_end' && rawId !== 'startNode') {
        node.setAttribute('data-state-id', rawId);
        const label =
          node.querySelector('.nodeLabel')?.textContent?.trim() ||
          node.textContent?.trim() ||
          rawId;
        node.setAttribute('data-state-label', label);
        node.classList.add('clickable-state-node');

        // Preserve pristine original Mermaid transform & coordinates
        const origTf = node.getAttribute('transform') || '';
        if (origTf && !node.getAttribute('data-orig-transform')) {
          node.setAttribute('data-orig-transform', origTf);
          const { x, y } = parseTranslation(origTf);
          node.setAttribute('data-orig-x', String(x));
          node.setAttribute('data-orig-y', String(y));
        }

        if (selectedStateId && rawId === selectedStateId) {
          node.classList.add('diagram-selected-node');
        }

        if (notes?.nodes && notes.nodes[rawId]) {
          node.classList.add('has-diagram-note');
          node.setAttribute('title', `Note: ${notes.nodes[rawId]}`);
        }

        // Apply custom styles directly to SVG elements for instant robustness across all themes
        if (customStyles && customStyles[rawId]) {
          const st = customStyles[rawId];
          const shapes = node.querySelectorAll('rect, polygon, circle, path.basic');
          shapes.forEach((shape) => {
            if (st.fill) (shape as HTMLElement).style.setProperty('fill', st.fill, 'important');
            if (st.stroke) (shape as HTMLElement).style.setProperty('stroke', st.stroke, 'important');
            if (st.strokeWidth) (shape as HTMLElement).style.setProperty('stroke-width', st.strokeWidth, 'important');
          });
          const textEls = node.querySelectorAll('.nodeLabel, span, p, text, div');
          textEls.forEach((txt) => {
            if (st.color) (txt as HTMLElement).style.setProperty('color', st.color, 'important');
          });
        }
      }
    }

    // Find all edgePaths groups across root and subgraphs / composite states
    const pGroups = Array.from(doc.querySelectorAll('g.edgePaths'));
    if (pGroups.length === 0) {
      const serializer = new XMLSerializer();
      return serializer.serializeToString(doc);
    }

    let anyBadgeAdded = false;

    for (const pGroup of pGroups) {
      const parent = pGroup.parentElement;
      if (!parent) continue;

      // Find matching edgeLabels group within the same cluster container
      const lGroup =
        parent.querySelector(':scope > g.edgeLabels') ||
        Array.from(parent.children).find((c) => c.classList && c.classList.contains('edgeLabels'));

      if (!lGroup) continue;

      const paths = Array.from(pGroup.querySelectorAll('path')).filter(
        (p) => !p.closest('defs') && !p.closest('marker') && p.getAttribute('d')
      );
      const labels = Array.from(lGroup.querySelectorAll('g.edgeLabel'));

      for (let pIdx = 0; pIdx < paths.length; pIdx++) {
        const p = paths[pIdx];
        p.classList.add('tc-edge-path', 'clickable-edge-path');
        p.setAttribute('data-edge', 'true');
        const pId = p.getAttribute('id') || p.getAttribute('data-id') || `path-${pIdx}`;
        p.setAttribute('data-path-id', pId);
      }
      for (let lIdx = 0; lIdx < labels.length; lIdx++) {
        const l = labels[lIdx];
        l.classList.add('clickable-edge-label');
        l.setAttribute('data-edge', 'true');
        if (isInteractiveMode) {
          l.classList.add('tc-interactive-edge-label');
          l.setAttribute('title', 'Click to toggle full transition condition details');
        }
      }

      if (paths.length === 0 || labels.length === 0) continue;

      // Dedicated priority layer inside this cluster (rendered directly after edgePaths)
      const clusterBadgeLayer = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
      clusterBadgeLayer.setAttribute('class', 'priority-badges-cluster');

      const usedPathIndices = new Set<number>();

      for (let i = 0; i < labels.length; i++) {
        const labelEl = labels[i];
        const text = labelEl.textContent || '';
        const prioInfo = extractPriorityFromText(text);

        // In Mermaid, edges and labels can be linked via data-id (ELK / Flowchart-v2) or 1-to-1 index (Dagre)
        let pathEl: Element | null = null;

        // 1. Check data-id attribute (Flowchart-v2 / ELK provides matching data-id on path and label)
        const labelDataId =
          labelEl.getAttribute('data-id') ||
          labelEl.querySelector('[data-id]')?.getAttribute('data-id');
        if (labelDataId) {
          const match = paths.find(
            (p) => p.getAttribute('data-id') === labelDataId && !usedPathIndices.has(paths.indexOf(p))
          );
          if (match) {
            pathEl = match;
            usedPathIndices.add(paths.indexOf(match));
          }
        }

        // 2. 1-to-1 index matching (Standard Dagre behavior where edgePaths and edgeLabels have identical counts)
        if (!pathEl && i < paths.length && !usedPathIndices.has(i)) {
          pathEl = paths[i];
          usedPathIndices.add(i);
        }

        // 3. Proximity fallback: find the closest path whose spline points pass near the label
        if (!pathEl) {
          const labelPos = getLabelPos(labelEl);
          if (labelPos) {
            let bestDist = Infinity;
            let bestIdx = -1;
            for (let pIdx = 0; pIdx < paths.length; pIdx++) {
              if (usedPathIndices.has(pIdx)) continue;
              const pData = parsePathData(paths[pIdx]);
              if (!pData) continue;
              const dist = minDistanceToPath(labelPos, pData.allPoints);
              if (dist < bestDist) {
                bestDist = dist;
                bestIdx = pIdx;
              }
            }
            if (bestIdx >= 0 && bestDist < 150) {
              pathEl = paths[bestIdx];
              usedPathIndices.add(bestIdx);
            }
          }
        }

        // 4. Fallback: search for first unused path in this cluster
        if (!pathEl) {
          for (let pIdx = 0; pIdx < paths.length; pIdx++) {
            if (!usedPathIndices.has(pIdx)) {
              pathEl = paths[pIdx];
              usedPathIndices.add(pIdx);
              break;
            }
          }
        }

        if (pathEl) {
          const pId = pathEl.getAttribute('id') || pathEl.getAttribute('data-id') || `path-${paths.indexOf(pathEl as SVGPathElement)}`;
          labelEl.setAttribute('data-linked-path-id', pId);
          if (isInteractiveMode && activeEdgeId && (pId === activeEdgeId || labelEl.getAttribute('data-edge-id') === activeEdgeId)) {
            labelEl.classList.add('tc-interactive-edge-label-active');
          }
        }

        if (!prioInfo || !pathEl) continue;

        const parsed = parsePathData(pathEl);
        if (!parsed) continue;

        // Position badge 20px from edge start endpoint along direction vector to ensure clean clearance from state border
        const offset = 20;
        const cx = parsed.startX + parsed.dirX * offset;
        const cy = parsed.startY + parsed.dirY * offset;

        // TwinCAT XAE UML Statechart style circular badge
        const badgeG = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
        badgeG.setAttribute('class', 'priority-badge tc-priority-badge');
        const pathDataId = pathEl.getAttribute('id') || pathEl.getAttribute('data-id') || `path-${paths.indexOf(pathEl as SVGPathElement)}`;
        badgeG.setAttribute('data-path-id', pathDataId);
        if (!pathEl.getAttribute('data-path-id')) {
          pathEl.setAttribute('data-path-id', pathDataId);
        }

        const circle = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', cx.toFixed(1));
        circle.setAttribute('cy', cy.toFixed(1));
        circle.setAttribute('r', '8.5');
        circle.setAttribute('fill', '#ffffff');
        circle.setAttribute('stroke', '#0f172a');
        circle.setAttribute('stroke-width', '1.5');
        circle.setAttribute('filter', 'drop-shadow(0px 1px 2px rgba(0,0,0,0.35))');

        const textEl = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
        textEl.setAttribute('x', cx.toFixed(1));
        textEl.setAttribute('y', cy.toFixed(1));
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('dominant-baseline', 'central');
        textEl.setAttribute('font-family', 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif');
        textEl.setAttribute('font-size', prioInfo.priority >= 10 ? '9' : '10.5');
        textEl.setAttribute('font-weight', '700');
        textEl.setAttribute('fill', '#0f172a');
        textEl.textContent = String(prioInfo.priority);

        badgeG.appendChild(circle);
        badgeG.appendChild(textEl);
        clusterBadgeLayer.appendChild(badgeG);
        anyBadgeAdded = true;

        // Clean priority symbol from label text
        cleanSymbolFromLabel(labelEl, prioInfo.symbol);
      }

      if (clusterBadgeLayer.childNodes.length > 0) {
        // Append as last child of parent container so badges render on top of nodes and edges in SVG painter's model
        parent.appendChild(clusterBadgeLayer);
      }
    }

    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
  } catch (err) {
    console.warn('Failed to enhance SVG with priority circles:', err);
    return svgString;
  }
}

export const MermaidViewer: React.FC<MermaidViewerProps> = ({
  code,
  layoutEngine = 'elk',
  flowchartCurve = 'basis',
  mermaidTheme = 'dark',
  searchQuery: externalSearchQuery,
  onSearchQueryChange,
  selectedStateId: externalSelectedStateId,
  selectedStateLabel: externalSelectedStateLabel,
  onSelectState: onSelectStateProp,
  customStyles: externalCustomStyles,
  onStyleChange: onStyleChangeProp,
  onResetStateStyle: onResetStateStyleProp,
  onClearAllCustomStyles: onClearAllCustomStylesProp,
  nodeOffsets: externalNodeOffsets,
  onNodeOffsetsChange,
  notes,
  onSaveNote,
  onDeleteNote,
  onClearAllNotes,
  onUpdateNotePosition: onUpdateNotePositionProp,
  onUpdateNoteStyle,
  onCanvasPositionsChange,
  onOpenMermaidLive,
  fileName = 'statechart',
  interactiveMode: externalInteractiveMode,
  onInteractiveModeChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const mouseDownPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [copiedSvg, setCopiedSvg] = useState<boolean>(false);

  // Interactive Mode & Transition Condition Detail Overlay
  const [internalInteractiveMode, setInternalInteractiveMode] = useState<boolean>(true);
  const isInteractiveMode = externalInteractiveMode !== undefined ? externalInteractiveMode : internalInteractiveMode;
  const setIsInteractiveMode = (valOrFn: boolean | ((prev: boolean) => boolean)) => {
    const nextVal = typeof valOrFn === 'function' ? valOrFn(isInteractiveMode) : valOrFn;
    if (onInteractiveModeChange) {
      onInteractiveModeChange(nextVal);
    } else {
      setInternalInteractiveMode(nextVal);
    }
  };

  const [isCompactLabels, setIsCompactLabels] = useState<boolean>(true);
  const [activeConditionOverlay, setActiveConditionOverlay] = useState<{
    edge: EdgeInfo;
    anchorPos: { x: number; y: number };
  } | null>(null);

  // High-Resolution Export States
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [exportModalDefaultFormat, setExportModalDefaultFormat] = useState<ExportFormat>('png');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState<boolean>(false);
  const [exportingNotification, setExportingNotification] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Notes & Edge Selection State
  const [selectedEdge, setSelectedEdge] = useState<EdgeInfo | null>(null);
  const [contextMenuState, setContextMenuState] = useState<{
    x: number;
    y: number;
    target: ContextMenuTarget;
  } | null>(null);
  const [isNoteDialogOpen, setIsNoteDialogOpen] = useState<boolean>(false);
  const [activeNoteTarget, setActiveNoteTarget] = useState<ContextMenuTarget | null>(null);
  const [isNotesDrawerOpen, setIsNotesDrawerOpen] = useState<boolean>(false);
  const [renderedSvg, setRenderedSvg] = useState<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || !svgContent) {
      setRenderedSvg(null);
      return;
    }
    const svg = containerRef.current.querySelector('svg');
    setRenderedSvg(svg);
  }, [svgContent]);

  const effectiveNotes: DiagramNotes = useMemo(() => {
    return notes || { nodes: {}, edges: {} };
  }, [notes]);

  const availableEdges = useMemo(() => {
    return extractEdgesFromMermaid(code, effectiveNotes);
  }, [code, effectiveNotes]);

  const totalNotesCount = useMemo(() => {
    return countTotalNotes(effectiveNotes);
  }, [effectiveNotes]);

  // Manual Node Dragging & Offsets state
  const [internalNodeOffsets, setInternalNodeOffsets] = useState<NodeOffsetsMap>({});
  const effectiveNodeOffsets = externalNodeOffsets !== undefined ? externalNodeOffsets : internalNodeOffsets;
  const currentNodeOffsetsRef = useRef<NodeOffsetsMap>({});

  useEffect(() => {
    currentNodeOffsetsRef.current = { ...effectiveNodeOffsets };
  }, [effectiveNodeOffsets]);

  const setNodeOffsets = (updater: NodeOffsetsMap | ((prev: NodeOffsetsMap) => NodeOffsetsMap)) => {
    const nextOffsets = typeof updater === 'function' ? updater(effectiveNodeOffsets) : updater;
    currentNodeOffsetsRef.current = nextOffsets;
    if (onNodeOffsetsChange) {
      onNodeOffsetsChange(nextOffsets);
    } else {
      setInternalNodeOffsets(nextOffsets);
    }
  };

  const [isNodeDragging, setIsNodeDragging] = useState<boolean>(false);
  const isDraggingNodeRef = useRef<boolean>(false);
  const draggedNodeIdRef = useRef<string | null>(null);
  const draggedNodeElRef = useRef<SVGGElement | null>(null);
  const nodeDragStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const nodeInitialOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const nodeMovedRef = useRef<boolean>(false);

  // Edge Offsets & Endpoint Dragging State
  const [edgeOffsets, setEdgeOffsets] = useState<EdgeOffsetsMap>({});
  const currentEdgeOffsetsRef = useRef<EdgeOffsetsMap>({});
  useEffect(() => {
    currentEdgeOffsetsRef.current = { ...edgeOffsets };
  }, [edgeOffsets]);

  const isDraggingEdgeHandleRef = useRef<boolean>(false);
  const draggedEdgeIdRef = useRef<string | null>(null);
  const draggedHandleTypeRef = useRef<'start' | 'end' | 'mid' | null>(null);
  const edgeHandleDragStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const edgeInitialOffsetRef = useRef<EdgeOffset>({ x: 0, y: 0 });
  const edgeMovedRef = useRef<boolean>(false);

  // State selection and inspector
  const [internalSelectedStateId, setInternalSelectedStateId] = useState<string | null>(null);
  const [internalSelectedStateLabel, setInternalSelectedStateLabel] = useState<string>('');
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false);

  const effectiveSelectedStateId =
    externalSelectedStateId !== undefined ? externalSelectedStateId : internalSelectedStateId;
  const effectiveSelectedStateLabel =
    externalSelectedStateLabel !== undefined ? externalSelectedStateLabel : internalSelectedStateLabel;

  // Custom node styles (fallback to local if not controlled)
  const [internalCustomStyles, setInternalCustomStyles] = useState<CustomNodeStylesMap>({});
  const effectiveCustomStyles = externalCustomStyles !== undefined ? externalCustomStyles : internalCustomStyles;

  // Available states from Mermaid code
  const availableStates = useMemo(() => {
    return extractStateNodesFromMermaid(code);
  }, [code]);

  // Search state
  const [internalSearchQuery, setInternalSearchQuery] = useState<string>('');
  const effectiveSearchQuery = externalSearchQuery !== undefined ? externalSearchQuery : internalSearchQuery;
  const [matches, setMatches] = useState<SearchMatchItem[]>([]);
  const [activeMatchIndex, setActiveMatchIndex] = useState<number>(0);
  const [matchesBreakdown, setMatchesBreakdown] = useState<{ states: number; transitions: number }>({
    states: 0,
    transitions: 0,
  });

  const panToElement = (elem: Element) => {
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const elemRect = elem.getBoundingClientRect();

    if (elemRect.width === 0 && elemRect.height === 0) return;

    const currentElemCenterX = elemRect.left + elemRect.width / 2;
    const currentElemCenterY = elemRect.top + elemRect.height / 2;
    const targetCenterX = containerRect.left + containerRect.width / 2;
    const targetCenterY = containerRect.top + containerRect.height / 2;

    const deltaX = targetCenterX - currentElemCenterX;
    const deltaY = targetCenterY - currentElemCenterY;

    setPan((prev) => ({
      x: prev.x + deltaX,
      y: prev.y + deltaY,
    }));
  };

  const clearHighlighting = () => {
    if (!containerRef.current) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;

    svg.classList.remove('diagram-search-active');
    const prevHighlighted = svg.querySelectorAll(
      '.diagram-match-node, .diagram-match-edge, .diagram-match-path, .diagram-match-active'
    );
    prevHighlighted.forEach((el) => {
      el.classList.remove(
        'diagram-match-node',
        'diagram-match-edge',
        'diagram-match-path',
        'diagram-match-active'
      );
    });
  };

  const applySearchHighlighting = (
    query: string,
    targetActiveIndex = 0,
    shouldPan = false
  ) => {
    if (!containerRef.current) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;

    const term = query.trim().toLowerCase();

    // Reset previous search classes
    clearHighlighting();

    if (!term) {
      setMatches([]);
      setMatchesBreakdown({ states: 0, transitions: 0 });
      setActiveMatchIndex(0);
      return;
    }

    svg.classList.add('diagram-search-active');

    const newMatches: SearchMatchItem[] = [];
    let stateMatches = 0;
    let transitionMatches = 0;

    // 1. Match States (g.node)
    const nodes = Array.from(svg.querySelectorAll('g.node'));
    nodes.forEach((node) => {
      const text = node.textContent || '';
      if (text.toLowerCase().includes(term)) {
        node.classList.add('diagram-match-node');
        stateMatches++;
        newMatches.push({
          type: 'state',
          name: text.trim().replace(/\s+/g, ' '),
          element: node,
        });
      }
    });

    // 2. Match Transitions (g.edgeLabel & corresponding paths)
    const pGroup = svg.querySelector('g.edgePaths');
    const allPaths = pGroup
      ? Array.from(pGroup.querySelectorAll('path')).filter(
          (p) => !p.closest('defs') && p.getAttribute('d')
        )
      : [];
    const edgeLabels = Array.from(svg.querySelectorAll('g.edgeLabel'));

    edgeLabels.forEach((labelEl, idx) => {
      const text = labelEl.textContent || '';
      if (text.toLowerCase().includes(term)) {
        labelEl.classList.add('diagram-match-edge');
        transitionMatches++;

        // Find linked path
        let matchedPath: Element | null = null;
        const labelDataId =
          labelEl.getAttribute('data-id') ||
          labelEl.querySelector('[data-id]')?.getAttribute('data-id');

        if (labelDataId) {
          matchedPath =
            allPaths.find((p) => p.getAttribute('data-id') === labelDataId) ||
            null;
        }

        if (!matchedPath && idx < allPaths.length) {
          matchedPath = allPaths[idx];
        }

        const associatedPaths: Element[] = [];
        if (matchedPath) {
          matchedPath.classList.add('diagram-match-path');
          associatedPaths.push(matchedPath);

          const pathId =
            matchedPath.getAttribute('id') ||
            matchedPath.getAttribute('data-id') ||
            matchedPath.getAttribute('data-path-id') ||
            String(allPaths.indexOf(matchedPath as SVGPathElement));

          const badges = svg.querySelectorAll(
            `.tc-priority-badge[data-path-id="${pathId}"]`
          );
          badges.forEach((b) => {
            b.classList.add('diagram-match-path');
            associatedPaths.push(b);
          });
        }

        newMatches.push({
          type: 'transition',
          name: text.trim().replace(/\s+/g, ' '),
          element: labelEl,
          associatedPaths,
        });
      }
    });

    setMatches(newMatches);
    setMatchesBreakdown({ states: stateMatches, transitions: transitionMatches });

    if (newMatches.length > 0) {
      const idx = Math.max(0, Math.min(targetActiveIndex, newMatches.length - 1));
      setActiveMatchIndex(idx);
      const activeMatch = newMatches[idx];
      activeMatch.element.classList.add('diagram-match-active');
      activeMatch.associatedPaths?.forEach((p) =>
        p.classList.add('diagram-match-active')
      );

      if (shouldPan) {
        panToElement(activeMatch.element);
      }
    } else {
      setActiveMatchIndex(0);
    }
  };

  const handleSearchChange = (val: string) => {
    if (onSearchQueryChange) {
      onSearchQueryChange(val);
    } else {
      setInternalSearchQuery(val);
    }
    applySearchHighlighting(val, 0, true);
  };

  const clearSearch = () => {
    if (onSearchQueryChange) {
      onSearchQueryChange('');
    } else {
      setInternalSearchQuery('');
    }
    clearHighlighting();
    setMatches([]);
    setMatchesBreakdown({ states: 0, transitions: 0 });
    setActiveMatchIndex(0);
  };

  const switchActiveMatch = (newIdx: number) => {
    if (!containerRef.current || matches.length === 0) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;

    const prevActives = svg.querySelectorAll('.diagram-match-active');
    prevActives.forEach((el) => el.classList.remove('diagram-match-active'));

    const item = matches[newIdx];
    if (item) {
      item.element.classList.add('diagram-match-active');
      item.associatedPaths?.forEach((p) =>
        p.classList.add('diagram-match-active')
      );
      setActiveMatchIndex(newIdx);
      panToElement(item.element);
    }
  };

  const goToNextMatch = () => {
    if (matches.length <= 1) return;
    const nextIdx = (activeMatchIndex + 1) % matches.length;
    switchActiveMatch(nextIdx);
  };

  const goToPrevMatch = () => {
    if (matches.length <= 1) return;
    const prevIdx = (activeMatchIndex - 1 + matches.length) % matches.length;
    switchActiveMatch(prevIdx);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        goToPrevMatch();
      } else {
        goToNextMatch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clearSearch();
      searchInputRef.current?.blur();
    }
  };

  // Re-apply search highlighting when svgContent updates
  useEffect(() => {
    if (svgContent && effectiveSearchQuery.trim()) {
      const timer = setTimeout(() => {
        applySearchHighlighting(effectiveSearchQuery, activeMatchIndex, false);
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [svgContent, effectiveSearchQuery]);

  // Global shortcut to focus search
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const renderDiagram = async () => {
      if (!code.trim()) {
        setSvgContent('');
        setError(null);
        return;
      }
      try {
        setError(null);
        ensureElkRegistered();
        mermaid.initialize({
          startOnLoad: false,
          theme: mermaidTheme,
          securityLevel: 'loose',
          layout: layoutEngine,
          flowchart: {
            useMaxWidth: false,
            htmlLabels: true,
            curve: flowchartCurve,
            wrappingWidth: 360,
          },
          state: {
            useMaxWidth: false,
          },
        });
        const uniqueId = `mermaid-render-${Math.random().toString(36).substring(2, 9)}`;
        const codeForRendering =
          isInteractiveMode && isCompactLabels
            ? createInteractiveMermaidCode(code, true)
            : code;
        const { svg } = await mermaid.render(uniqueId, codeForRendering);
        if (isMounted) {
          const enhancedSvg = enhanceSvgWithPriorityCircles(
            svg,
            effectiveSelectedStateId,
            effectiveCustomStyles,
            selectedEdge?.id,
            effectiveNotes,
            isInteractiveMode,
            activeConditionOverlay?.edge?.id
          );
          setSvgContent(enhancedSvg);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : String(err));
          setSvgContent('');
        }
      }
    };

    renderDiagram();
    return () => {
      isMounted = false;
    };
  }, [code, layoutEngine, flowchartCurve, mermaidTheme, effectiveCustomStyles, isInteractiveMode, isCompactLabels, effectiveNotes]);

  // Synchronize active transition detail overlay label highlighting in SVG
  useEffect(() => {
    if (!containerRef.current) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;
    svg.querySelectorAll('.tc-interactive-edge-label-active').forEach((el) => {
      el.classList.remove('tc-interactive-edge-label-active');
    });
    if (activeConditionOverlay) {
      const activeId = activeConditionOverlay.edge.id;
      const labels = Array.from(svg.querySelectorAll('g.edgeLabel, .clickable-edge-label, .tc-interactive-edge-label'));
      for (const l of labels) {
        const lEdgeId = l.getAttribute('data-edge-id');
        const lPathId = l.getAttribute('data-linked-path-id');
        if (
          (lEdgeId && lEdgeId === activeId) ||
          (lPathId && lPathId === activeId) ||
          (activeConditionOverlay.edge.label && l.textContent?.includes(activeConditionOverlay.edge.label))
        ) {
          l.classList.add('tc-interactive-edge-label-active');
          break;
        }
      }
    }
  }, [activeConditionOverlay]);

  // 1. Initialize SVG metadata and active offsets whenever SVG content updates
  useEffect(() => {
    if (!containerRef.current || !svgContent) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;
    initializeSvgDragMetadata(svg, availableEdges);
    applyDiagramOffsetsToSvg(
      svg,
      effectiveNodeOffsets,
      edgeOffsets,
      null,
      selectedEdge?.id || null,
      layoutEngine,
      flowchartCurve
    );
    if (onCanvasPositionsChange) {
      const positions = extractCanvasNodePositions(svg, effectiveNodeOffsets);
      onCanvasPositionsChange(positions);
    }
  }, [svgContent, availableEdges]);

  // 2. Synchronize node selection highlight class in SVG
  useEffect(() => {
    if (!containerRef.current) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;
    svg.querySelectorAll('.diagram-selected-node').forEach((el) => {
      el.classList.remove('diagram-selected-node');
    });
    if (effectiveSelectedStateId) {
      const target = svg.querySelector(`g.node[data-state-id="${effectiveSelectedStateId}"]`);
      if (target) {
        target.classList.add('diagram-selected-node');
      }
    }
  }, [effectiveSelectedStateId, svgContent]);

  // 3. Synchronize edge selection highlight and active offsets in SVG
  useEffect(() => {
    if (!containerRef.current || !svgContent) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;

    svg.querySelectorAll('.diagram-selected-edge, .selected-edge').forEach((el) => {
      el.classList.remove('diagram-selected-edge', 'selected-edge');
    });
    svg.querySelectorAll('.diagram-selected-edge-label').forEach((el) => {
      el.classList.remove('diagram-selected-edge-label');
    });

    const selId = selectedEdge && selectedEdge.id && selectedEdge.id.trim() !== '->' ? selectedEdge.id.trim() : null;
    if (selId) {
      let targetPath = svg.querySelector<SVGPathElement>(`path.tc-edge-path[data-path-id="${selId}"]`);
      if (!targetPath) {
        targetPath = svg.querySelector<SVGPathElement>(`path.tc-edge-path[data-edge-id="${selId}"]`);
      }
      if (!targetPath && selectedEdge?.from && selectedEdge?.to) {
        const key = `${selectedEdge.from.trim()}->${selectedEdge.to.trim()}`;
        targetPath = svg.querySelector<SVGPathElement>(`path.tc-edge-path[data-edge-id="${key}"]`);
      }

      if (targetPath) {
        targetPath.classList.add('diagram-selected-edge', 'selected-edge');
        const pId = targetPath.getAttribute('data-path-id') || targetPath.getAttribute('data-edge-id');
        const hitbox = targetPath.parentElement?.querySelector(
          `.tc-edge-hitbox[data-path-id="${pId}"], .tc-edge-hitbox[data-edge-id="${pId}"]`
        );
        hitbox?.classList.add('selected-edge');

        const labels = svg.querySelectorAll<SVGGElement>('g.edgeLabel');
        labels.forEach((l) => {
          const lPid = l.getAttribute('data-linked-path-id');
          if (lPid === pId || (selectedEdge?.label && l.textContent?.includes(selectedEdge.label))) {
            l.classList.add('diagram-selected-edge-label');
          }
        });
      }
    }

    applyDiagramOffsetsToSvg(
      svg,
      effectiveNodeOffsets,
      edgeOffsets,
      null,
      selId,
      layoutEngine,
      flowchartCurve
    );

    if (onCanvasPositionsChange) {
      const positions = extractCanvasNodePositions(svg, effectiveNodeOffsets);
      onCanvasPositionsChange(positions);
    }
  }, [selectedEdge, effectiveNodeOffsets, edgeOffsets, layoutEngine, flowchartCurve]);

  const handleSelectState = (stateId: string | null, label?: string) => {
    if (onSelectStateProp) {
      onSelectStateProp(stateId, label);
    } else {
      setInternalSelectedStateId(stateId);
      if (label) setInternalSelectedStateLabel(label);
    }
    if (stateId) {
      setIsInspectorOpen(true);
    }
  };

  const handleCloseInspector = () => {
    setIsInspectorOpen(false);
    if (onSelectStateProp) {
      onSelectStateProp(null);
    } else {
      setInternalSelectedStateId(null);
    }
  };

  const handleToggleInspector = () => {
    if (isInspectorOpen) {
      handleCloseInspector();
    } else {
      setIsInspectorOpen(true);
      if (!effectiveSelectedStateId && availableStates.length > 0) {
        handleSelectState(availableStates[0].id, availableStates[0].label);
      }
    }
  };

  const panToState = (stateId: string) => {
    if (!containerRef.current) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;
    const nodeEl = svg.querySelector(`g.node[data-state-id="${stateId}"]`);
    if (!nodeEl) return;
    panToElement(nodeEl);
  };

  const handleStyleChange = (stateId: string, style: NodeDisplayProperties) => {
    // 1. Immediately update DOM element in SVG for instantaneous live response
    if (containerRef.current) {
      const svg = containerRef.current.querySelector('svg');
      if (svg) {
        const nodeEl = svg.querySelector(`g.node[data-state-id="${stateId}"]`);
        if (nodeEl) {
          const shapes = nodeEl.querySelectorAll('rect, polygon, circle, path.basic');
          shapes.forEach((s) => {
            if (style.fill) (s as HTMLElement).style.setProperty('fill', style.fill, 'important');
            else (s as HTMLElement).style.removeProperty('fill');

            if (style.stroke) (s as HTMLElement).style.setProperty('stroke', style.stroke, 'important');
            else (s as HTMLElement).style.removeProperty('stroke');

            if (style.strokeWidth) (s as HTMLElement).style.setProperty('stroke-width', style.strokeWidth, 'important');
            else (s as HTMLElement).style.removeProperty('stroke-width');
          });
          const textEls = nodeEl.querySelectorAll('.nodeLabel, span, p, text, div');
          textEls.forEach((t) => {
            if (style.color) (t as HTMLElement).style.setProperty('color', style.color, 'important');
            else (t as HTMLElement).style.removeProperty('color');
          });
        }
      }
    }

    // 2. Propagate to parent state & Mermaid generator
    if (onStyleChangeProp) {
      onStyleChangeProp(stateId, style);
    } else {
      setInternalCustomStyles((prev) => ({
        ...prev,
        [stateId]: style,
      }));
    }
  };

  const handleResetStateStyle = (stateId: string) => {
    if (onResetStateStyleProp) {
      onResetStateStyleProp(stateId);
    } else {
      setInternalCustomStyles((prev) => {
        const next = { ...prev };
        delete next[stateId];
        return next;
      });
    }
  };

  const handleClearAllCustomStyles = () => {
    if (onClearAllCustomStylesProp) {
      onClearAllCustomStylesProp();
    } else {
      setInternalCustomStyles({});
    }
  };

  const customizedStatesCount = Object.values(effectiveCustomStyles).filter(
    (s) => s.fill || s.color || s.stroke || s.strokeWidth
  ).length;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };

    const target = e.target as Element;
    // If clicking inside inspector, toolbar, context menu, or dialogs, don't initiate drag
    if (
      target.closest('#state-style-inspector') ||
      target.closest('#mermaid-toolbar') ||
      target.closest('#diagram-context-menu') ||
      target.closest('#note-dialog-overlay') ||
      target.closest('#notes-drawer-overlay')
    ) {
      return;
    }

    // A. Check if user clicked on an edge handle (waypoint, start endpoint, or end endpoint)
    const handleEl = (target.closest('g.tc-edge-handle[data-handle-type]') ||
      target.closest('[data-handle-type]')) as SVGGElement | null;
    if (handleEl) {
      const eId = handleEl.getAttribute('data-edge-id');
      const hType = handleEl.getAttribute('data-handle-type') as 'start' | 'end' | 'mid';
      if (eId && hType) {
        isDraggingEdgeHandleRef.current = true;
        draggedEdgeIdRef.current = eId;
        draggedHandleTypeRef.current = hType;
        edgeHandleDragStartPosRef.current = { x: e.clientX, y: e.clientY };
        edgeMovedRef.current = false;
        const currentEdgeOffset = currentEdgeOffsetsRef.current[eId] || { x: 0, y: 0 };
        edgeInitialOffsetRef.current = { ...currentEdgeOffset };
        setIsNodeDragging(true);
        return;
      }
    }

    // B. Check if user clicked on a state node
    const nodeEl = (target.closest('g.clickable-state-node') ||
      target.closest('g.node[data-state-id]')) as SVGGElement | null;
    if (nodeEl) {
      const stateId = nodeEl.getAttribute('data-state-id');
      if (stateId) {
        isDraggingNodeRef.current = true;
        draggedNodeIdRef.current = stateId;
        draggedNodeElRef.current = nodeEl;
        nodeDragStartPosRef.current = { x: e.clientX, y: e.clientY };
        nodeMovedRef.current = false;
        const currentOffset = effectiveNodeOffsets[stateId] || { x: 0, y: 0 };
        nodeInitialOffsetRef.current = { ...currentOffset };
        nodeEl.classList.add('dragging-state-node');
        setIsNodeDragging(true);
        return;
      }
    }

    // C. Check if user clicked on an edge path or hitbox
    const svg = containerRef.current?.querySelector('svg') || null;
    let clickedEdge = resolveEdgeFromElement(target, svg, availableEdges);
    if (!clickedEdge && svg && (target.tagName.toLowerCase() === 'svg' || target.closest('svg'))) {
      clickedEdge = findEdgeNearPoint(svg, e.clientX, e.clientY, availableEdges, 24);
    }
    if (clickedEdge && clickedEdge.from && clickedEdge.to && clickedEdge.from.trim() && clickedEdge.to.trim()) {
      setSelectedEdge(clickedEdge);
      if (effectiveSelectedStateId) {
        if (onSelectStateProp) {
          onSelectStateProp(null);
        } else {
          setInternalSelectedStateId(null);
        }
      }
      if (svg) {
        applyDiagramOffsetsToSvg(
          svg,
          currentNodeOffsetsRef.current,
          currentEdgeOffsetsRef.current,
          null,
          clickedEdge.id,
          layoutEngine,
          flowchartCurve
        );
      }
      isDraggingEdgeHandleRef.current = true;
      draggedEdgeIdRef.current = clickedEdge.id;
      draggedHandleTypeRef.current = 'mid';
      edgeHandleDragStartPosRef.current = { x: e.clientX, y: e.clientY };
      edgeMovedRef.current = false;
      const currentEdgeOffset = currentEdgeOffsetsRef.current[clickedEdge.id] || { x: 0, y: 0 };
      edgeInitialOffsetRef.current = { ...currentEdgeOffset };
      setIsNodeDragging(true);
      return;
    }

    // Otherwise initiate canvas panning
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // 1. Dragging edge handle (Start endpoint, End endpoint, or Midpoint)
    if (isDraggingEdgeHandleRef.current && draggedEdgeIdRef.current && draggedHandleTypeRef.current) {
      const edgeId = draggedEdgeIdRef.current;
      const handleType = draggedHandleTypeRef.current;
      const screenDx = e.clientX - edgeHandleDragStartPosRef.current.x;
      const screenDy = e.clientY - edgeHandleDragStartPosRef.current.y;

      if (Math.hypot(screenDx, screenDy) >= 3) {
        edgeMovedRef.current = true;
      }

      if (edgeMovedRef.current) {
        const canvasDx = screenDx / zoom;
        const canvasDy = screenDy / zoom;
        const initial = edgeInitialOffsetRef.current;

        const nextOffset: EdgeOffset = { ...initial };
        if (handleType === 'start') {
          nextOffset.startDx = Math.round((initial.startDx || 0) + canvasDx);
          nextOffset.startDy = Math.round((initial.startDy || 0) + canvasDy);
        } else if (handleType === 'end') {
          nextOffset.endDx = Math.round((initial.endDx || 0) + canvasDx);
          nextOffset.endDy = Math.round((initial.endDy || 0) + canvasDy);
        } else if (handleType === 'mid') {
          nextOffset.x = Math.round(initial.x + canvasDx);
          nextOffset.y = Math.round(initial.y + canvasDy);
        }

        currentEdgeOffsetsRef.current = {
          ...currentEdgeOffsetsRef.current,
          [edgeId]: nextOffset,
        };

        if (containerRef.current) {
          const svg = containerRef.current.querySelector('svg');
          if (svg) {
            applyDiagramOffsetsToSvg(
              svg,
              currentNodeOffsetsRef.current,
              currentEdgeOffsetsRef.current,
              null,
              selectedEdge?.id || edgeId,
              layoutEngine,
              flowchartCurve
            );
          }
        }
      }
      return;
    }

    // 2. Dragging a state node (reroute all edges to match current engine and curve settings without distortion)
    if (isDraggingNodeRef.current && draggedNodeIdRef.current) {
      const stateId = draggedNodeIdRef.current;
      const screenDx = e.clientX - nodeDragStartPosRef.current.x;
      const screenDy = e.clientY - nodeDragStartPosRef.current.y;

      if (Math.hypot(screenDx, screenDy) >= 3) {
        nodeMovedRef.current = true;
      }

      if (nodeMovedRef.current) {
        const canvasDx = screenDx / zoom;
        const canvasDy = screenDy / zoom;
        const newOffset = {
          x: Math.round(nodeInitialOffsetRef.current.x + canvasDx),
          y: Math.round(nodeInitialOffsetRef.current.y + canvasDy),
        };

        currentNodeOffsetsRef.current = {
          ...currentNodeOffsetsRef.current,
          [stateId]: newOffset,
        };

        if (containerRef.current) {
          const svg = containerRef.current.querySelector('svg');
          if (svg) {
            applyDiagramOffsetsToSvg(
              svg,
              currentNodeOffsetsRef.current,
              currentEdgeOffsetsRef.current,
              null,
              selectedEdge?.id,
              layoutEngine,
              flowchartCurve
            );
          }
        }
      }
      return;
    }

    // 3. Panning canvas
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    // 1. Released edge handle
    if (isDraggingEdgeHandleRef.current) {
      const edgeId = draggedEdgeIdRef.current;
      const wasMoved = edgeMovedRef.current;
      isDraggingEdgeHandleRef.current = false;
      draggedEdgeIdRef.current = null;
      draggedHandleTypeRef.current = null;
      setIsNodeDragging(false);

      if (wasMoved && edgeId) {
        setEdgeOffsets({ ...currentEdgeOffsetsRef.current });
      }
      return;
    }

    // 2. Released while dragging a state node
    if (isDraggingNodeRef.current) {
      const stateId = draggedNodeIdRef.current;
      const wasMoved = nodeMovedRef.current;
      if (draggedNodeElRef.current) {
        draggedNodeElRef.current.classList.remove('dragging-state-node');
      }
      isDraggingNodeRef.current = false;
      draggedNodeIdRef.current = null;
      draggedNodeElRef.current = null;
      setIsNodeDragging(false);

      if (wasMoved && stateId) {
        const nextOffsets = { ...currentNodeOffsetsRef.current };
        setNodeOffsets(nextOffsets);
        if (onNodeOffsetsChange) {
          onNodeOffsetsChange(nextOffsets);
        }
        if (onCanvasPositionsChange && containerRef.current) {
          const svg = containerRef.current.querySelector('svg');
          if (svg) {
            onCanvasPositionsChange(extractCanvasNodePositions(svg, nextOffsets));
          }
        }
        return;
      }

      // Click without drag -> select state and open inspector
      if (!wasMoved && stateId) {
        const targetNode = containerRef.current?.querySelector(`g.node[data-state-id="${stateId}"]`);
        const stateLabel = targetNode?.getAttribute('data-state-label') || stateId;
        handleSelectState(stateId, stateLabel);
        setSelectedEdge(null);
        return;
      }
    }

    // 3. Released canvas panning
    setIsDragging(false);
    const dx = Math.abs(e.clientX - mouseDownPosRef.current.x);
    const dy = Math.abs(e.clientY - mouseDownPosRef.current.y);

    // If mouse moved less than 6 pixels, treat as a click
    if (dx < 6 && dy < 6) {
      const target = e.target as Element;
      // If clicking inside inspector, toolbar, context menu, dialogs, or note overlays, don't change selection
      if (
        target.closest('#state-style-inspector') ||
        target.closest('#mermaid-toolbar') ||
        target.closest('#diagram-context-menu') ||
        target.closest('#note-dialog-overlay') ||
        target.closest('#notes-drawer-overlay') ||
        target.closest('#mermaid-note-overlays-layer') ||
        target.closest('#edge-condition-detail-overlay')
      ) {
        return;
      }

      // Check if user clicked an SVG note
      const svgNote = target.closest('g.note');
      if (svgNote) {
        const text = svgNote.textContent?.trim() || '';
        const matchingNodeId = Object.keys(effectiveNotes.nodes || {}).find(
          (k) => (effectiveNotes.nodes[k] || '').trim() === text || text.includes((effectiveNotes.nodes[k] || '').trim())
        );
        if (matchingNodeId) {
          handleOpenAddNote({
            type: 'node',
            id: matchingNodeId,
            label: matchingNodeId,
            note: effectiveNotes.nodes[matchingNodeId],
          });
          return;
        }
      }

      // Check if user clicked on a state node
      const nodeEl =
        target.closest('g.clickable-state-node') || target.closest('g.node[data-state-id]');
      if (nodeEl) {
        const stateId = nodeEl.getAttribute('data-state-id');
        const stateLabel = nodeEl.getAttribute('data-state-label') || stateId || '';
        if (stateId) {
          handleSelectState(stateId, stateLabel);
          setSelectedEdge(null);
          setActiveConditionOverlay(null);
          return;
        }
      }

      // Check if user clicked on an edge path, label, or priority badge
      const svg = containerRef.current?.querySelector('svg') || null;
      let clickedEdge = resolveEdgeFromElement(target, svg, availableEdges);
      if (!clickedEdge && svg && (target.tagName.toLowerCase() === 'svg' || target.closest('svg'))) {
        clickedEdge = findEdgeNearPoint(svg, e.clientX, e.clientY, availableEdges, 24);
      }
      if (clickedEdge && clickedEdge.from && clickedEdge.to && clickedEdge.from.trim() && clickedEdge.to.trim()) {
        setSelectedEdge(clickedEdge);

        // Check if user clicked an edge label or priority badge to toggle transition condition detail overlay
        const labelOrBadgeEl = (target.closest('g.edgeLabel') ||
          target.closest('.clickable-edge-label') ||
          target.closest('.tc-interactive-edge-label') ||
          target.closest('.tc-priority-badge')) as HTMLElement | SVGElement | null;

        if (labelOrBadgeEl || isInteractiveMode) {
          const rect = labelOrBadgeEl?.getBoundingClientRect() || {
            left: e.clientX - 10,
            width: 20,
            top: e.clientY - 10,
          };
          // Toggle detail view overlay
          if (
            activeConditionOverlay &&
            (activeConditionOverlay.edge.id === clickedEdge.id ||
              (activeConditionOverlay.edge.from === clickedEdge.from &&
                activeConditionOverlay.edge.to === clickedEdge.to))
          ) {
            setActiveConditionOverlay(null);
          } else {
            setActiveConditionOverlay({
              edge: clickedEdge,
              anchorPos: {
                x: rect.left + rect.width / 2,
                y: rect.top,
              },
            });
          }
        }

        if (effectiveSelectedStateId) {
          if (onSelectStateProp) {
            onSelectStateProp(null);
          } else {
            setInternalSelectedStateId(null);
          }
        }
        if (svg) {
          applyDiagramOffsetsToSvg(
            svg,
            currentNodeOffsetsRef.current,
            currentEdgeOffsetsRef.current,
            null,
            clickedEdge.id,
            layoutEngine,
            flowchartCurve
          );
        }
        return;
      }

      // Clicked on empty canvas background -> deselect edge, close inspector, and close condition overlay
      setSelectedEdge(null);
      setActiveConditionOverlay(null);
      if (svg) {
        applyDiagramOffsetsToSvg(
          svg,
          currentNodeOffsetsRef.current,
          currentEdgeOffsetsRef.current,
          null,
          null,
          layoutEngine,
          flowchartCurve
        );
      }
      if (effectiveSelectedStateId || isInspectorOpen) {
        handleCloseInspector();
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const target = e.target as Element;

    // 0. Clicked on a note overlay card
    const noteCardEl = target.closest('[id^="note-overlay-"]');
    if (noteCardEl) {
      const noteCardId = noteCardEl.id.replace('note-overlay-', '');
      const isNodeNote = effectiveNotes.nodes?.[noteCardId] !== undefined;
      const isEdgeNote = effectiveNotes.edges?.[noteCardId] !== undefined;
      if (isNodeNote) {
        const state = availableStates.find((s) => s.id === noteCardId || cleanNodeId(s.id) === cleanNodeId(noteCardId));
        const menuTarget: ContextMenuTarget = {
          type: 'node',
          id: noteCardId,
          label: state?.label || noteCardId,
          note: effectiveNotes.nodes[noteCardId],
        };
        setContextMenuState({ x: e.clientX, y: e.clientY, target: menuTarget });
        return;
      }
      if (isEdgeNote) {
        const edge = availableEdges.find(
          (e) =>
            e.id === noteCardId ||
            `${e.from}->${e.to}` === noteCardId ||
            (e.pathId && e.pathId === noteCardId)
        );
        const menuTarget: ContextMenuTarget = {
          type: 'edge',
          id: edge?.id || noteCardId,
          pathId: edge?.pathId,
          from: edge?.from || '',
          to: edge?.to || '',
          label: edge?.label,
          note: effectiveNotes.edges[noteCardId] || (edge ? effectiveNotes.edges[edge.id] : ''),
        };
        setContextMenuState({ x: e.clientX, y: e.clientY, target: menuTarget });
        return;
      }
    }

    // 1. Clicked on a state node
    const nodeEl = (target.closest('g.clickable-state-node') ||
      target.closest('g.node[data-state-id]') ||
      target.closest('g.node')) as SVGGElement | null;
    if (nodeEl) {
      const rawStateId =
        nodeEl.getAttribute('data-state-id') ||
        nodeEl.id.replace(/^flowchart-/, '').replace(/-\d+$/, '');
      const stateId = cleanNodeId(rawStateId);
      const stateLabel = nodeEl.getAttribute('data-state-label') || stateId;
      const note = effectiveNotes.nodes[stateId] || effectiveNotes.nodes[rawStateId] || '';
      const menuTarget: ContextMenuTarget = {
        type: 'node',
        id: stateId,
        label: stateLabel,
        note,
      };
      handleSelectState(stateId, stateLabel);
      setSelectedEdge(null);
      setContextMenuState({ x: e.clientX, y: e.clientY, target: menuTarget });
      return;
    }

    // 2. Clicked on an edge
    const svg = containerRef.current?.querySelector('svg') || null;
    let edge = resolveEdgeFromElement(target, svg, availableEdges);
    if (!edge && svg) {
      edge = findEdgeNearPoint(svg, e.clientX, e.clientY, availableEdges, 24);
    }
    if (edge && edge.from && edge.to && edge.from.trim() && edge.to.trim()) {
      const note =
        effectiveNotes.edges[edge.id] ||
        effectiveNotes.edges[`${edge.from}->${edge.to}`] ||
        (edge.pathId ? effectiveNotes.edges[edge.pathId] : '') ||
        '';
      const menuTarget: ContextMenuTarget = {
        type: 'edge',
        id: edge.id,
        pathId: edge.pathId,
        from: edge.from,
        to: edge.to,
        label: edge.label,
        note,
      };
      setSelectedEdge(edge);
      if (onSelectStateProp) {
        onSelectStateProp(null);
      } else {
        setInternalSelectedStateId(null);
      }
      setContextMenuState({ x: e.clientX, y: e.clientY, target: menuTarget });
      return;
    }

    // 3. Fallback: canvas context menu or selected item context menu
    if (selectedEdge && selectedEdge.id !== '->') {
      const note = effectiveNotes.edges[selectedEdge.id] || '';
      setContextMenuState({
        x: e.clientX,
        y: e.clientY,
        target: { type: 'edge', ...selectedEdge, note },
      });
      return;
    }
    if (effectiveSelectedStateId) {
      const note = effectiveNotes.nodes[effectiveSelectedStateId] || '';
      setContextMenuState({
        x: e.clientX,
        y: e.clientY,
        target: {
          type: 'node',
          id: effectiveSelectedStateId,
          label: effectiveSelectedStateLabel || effectiveSelectedStateId,
          note,
        },
      });
      return;
    }

    setContextMenuState({
      x: e.clientX,
      y: e.clientY,
      target: { type: 'canvas', x: e.clientX, y: e.clientY },
    });
  };

  const handleOpenAddNote = (target: ContextMenuTarget) => {
    setActiveNoteTarget(target);
    setIsNoteDialogOpen(true);
  };

  const handleSaveActiveNote = (target: ContextMenuTarget, noteText: string) => {
    onSaveNote?.(target, noteText);
    setIsNoteDialogOpen(false);
  };

  const handleDeleteActiveNote = (target: ContextMenuTarget) => {
    onDeleteNote?.(target);
    setIsNoteDialogOpen(false);
  };

  const panToEdge = (edgeId: string) => {
    if (!containerRef.current) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;
    const pathEl = findEdgePathElement(svg, edgeId, availableEdges);
    if (pathEl) {
      panToElement(pathEl);
    }
  };

  // Window-level mouseup listener to guarantee drag never gets orphaned
  useEffect(() => {
    const handleWindowMouseUp = () => {
      if (isDraggingEdgeHandleRef.current) {
        const edgeId = draggedEdgeIdRef.current;
        const wasMoved = edgeMovedRef.current;
        isDraggingEdgeHandleRef.current = false;
        draggedEdgeIdRef.current = null;
        draggedHandleTypeRef.current = null;
        setIsNodeDragging(false);

        if (wasMoved && edgeId) {
          setEdgeOffsets({ ...currentEdgeOffsetsRef.current });
        }
      }
      if (isDraggingNodeRef.current) {
        const stateId = draggedNodeIdRef.current;
        const wasMoved = nodeMovedRef.current;
        if (draggedNodeElRef.current) {
          draggedNodeElRef.current.classList.remove('dragging-state-node');
        }
        isDraggingNodeRef.current = false;
        draggedNodeIdRef.current = null;
        draggedNodeElRef.current = null;
        setIsNodeDragging(false);

        if (wasMoved && stateId) {
          setNodeOffsets({ ...currentNodeOffsetsRef.current });
        }
      }
      setIsDragging(false);
    };

    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, []);

  const handleResetLayout = () => {
    currentNodeOffsetsRef.current = {};
    currentEdgeOffsetsRef.current = {};
    setNodeOffsets({});
    setEdgeOffsets({});
    if (containerRef.current) {
      const svg = containerRef.current.querySelector('svg');
      if (svg) {
        resetSvgDiagramOffsets(svg);
      }
    }
  };

  const movedElementsCount =
    Object.keys(effectiveNodeOffsets).filter(
      (id) => effectiveNodeOffsets[id].x !== 0 || effectiveNodeOffsets[id].y !== 0
    ).length +
    Object.keys(edgeOffsets).filter(
      (id) =>
        edgeOffsets[id].x !== 0 ||
        edgeOffsets[id].y !== 0 ||
        (edgeOffsets[id].startDx !== undefined && edgeOffsets[id].startDx !== 0) ||
        (edgeOffsets[id].startDy !== undefined && edgeOffsets[id].startDy !== 0) ||
        (edgeOffsets[id].endDx !== undefined && edgeOffsets[id].endDx !== 0) ||
        (edgeOffsets[id].endDy !== undefined && edgeOffsets[id].endDy !== 0)
    ).length;

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((prev) => Math.min(Math.max(0.2, prev * factor), 5));
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const getActiveSvgElement = (): SVGSVGElement | null => {
    return renderedSvg || containerRef.current?.querySelector('svg') || null;
  };

  const handleOpenExportModal = (format: ExportFormat = 'png') => {
    setExportModalDefaultFormat(format);
    setIsExportModalOpen(true);
    setIsExportMenuOpen(false);
  };

  const handleQuickDownloadPng = async (scale: ExportScale = 2) => {
    const svgEl = getActiveSvgElement();
    if (!svgEl) return;
    setIsExportMenuOpen(false);
    setExportingNotification(`Exporting ${scale}x PNG...`);
    try {
      const result = await exportHighResPng(svgEl, {
        scale,
        background: mermaidTheme === 'dark' || !mermaidTheme ? 'dark' : 'white',
        fileName: (fileName || 'statechart').replace(/\.statechart|\.TcPOU/gi, ''),
        notes: effectiveNotes,
        customStyles: effectiveCustomStyles,
        theme: mermaidTheme,
      });
      triggerDownload(result.blob, result.fileName);
      setExportingNotification(`Downloaded ${result.fileName}`);
      setTimeout(() => setExportingNotification(null), 2500);
    } catch (e) {
      console.error('PNG export failed:', e);
      const msg = e instanceof Error ? e.message : 'PNG export failed';
      setExportingNotification(`PNG export failed: ${msg}`);
      setTimeout(() => setExportingNotification(null), 3500);
    }
  };

  const handleQuickDownloadSvg = async (scale: ExportScale = 1) => {
    const svgEl = getActiveSvgElement();
    if (!svgEl) return;
    setIsExportMenuOpen(false);
    setExportingNotification('Exporting vector SVG...');
    try {
      const result = await exportHighResSvg(svgEl, {
        scale,
        background: mermaidTheme === 'dark' || !mermaidTheme ? 'dark' : 'white',
        fileName: (fileName || 'statechart').replace(/\.statechart|\.TcPOU/gi, ''),
        notes: effectiveNotes,
        customStyles: effectiveCustomStyles,
        theme: mermaidTheme,
      });
      triggerDownload(result.blob, result.fileName);
      setExportingNotification(`Downloaded ${result.fileName}`);
      setTimeout(() => setExportingNotification(null), 2500);
    } catch (e) {
      console.error('SVG export failed:', e);
      const msg = e instanceof Error ? e.message : 'SVG export failed';
      setExportingNotification(`SVG export failed: ${msg}`);
      setTimeout(() => setExportingNotification(null), 3500);
    }
  };

  const handleQuickCopyPng = async (scale: ExportScale = 2) => {
    const svgEl = getActiveSvgElement();
    if (!svgEl) return;
    setIsExportMenuOpen(false);
    setExportingNotification('Copying 2x PNG to clipboard...');
    try {
      const res = await copyToClipboard(svgEl, {
        format: 'png',
        scale,
        background: mermaidTheme === 'dark' || !mermaidTheme ? 'dark' : 'white',
        notes: effectiveNotes,
        customStyles: effectiveCustomStyles,
        theme: mermaidTheme,
      });
      setExportingNotification(res.message || 'Copied 2x PNG to clipboard!');
      setTimeout(() => setExportingNotification(null), 2500);
    } catch (e) {
      console.error('Copy PNG failed:', e);
      const msg = e instanceof Error ? e.message : 'Clipboard copy failed';
      setExportingNotification(`Copy failed: ${msg}`);
      setTimeout(() => setExportingNotification(null), 3500);
    }
  };

  const handleQuickCopySvg = async () => {
    const svgEl = getActiveSvgElement();
    if (!svgEl) return;
    setIsExportMenuOpen(false);
    setExportingNotification('Copying SVG to clipboard...');
    try {
      const res = await copyToClipboard(svgEl, {
        format: 'svg',
        notes: effectiveNotes,
        customStyles: effectiveCustomStyles,
        theme: mermaidTheme,
      });
      setCopiedSvg(true);
      setTimeout(() => setCopiedSvg(false), 2000);
      setExportingNotification(res.message || 'Copied SVG vector to clipboard!');
      setTimeout(() => setExportingNotification(null), 2500);
    } catch (e) {
      console.error('Copy SVG failed:', e);
      const msg = e instanceof Error ? e.message : 'Clipboard copy failed';
      setExportingNotification(`Copy failed: ${msg}`);
      setTimeout(() => setExportingNotification(null), 3500);
    }
  };

  const handleCopySvg = handleQuickCopySvg;
  const handleDownloadSvg = () => handleQuickDownloadSvg(1);

  const toggleFullscreen = async () => {
    if (!isFullscreen) {
      setIsFullscreen(true);
      try {
        if (document.fullscreenEnabled && !document.fullscreenElement) {
          await document.documentElement.requestFullscreen?.().catch(() => {});
        }
      } catch {
        // Fallback gracefully to CSS fixed window expansion
      }
    } else {
      setIsFullscreen(false);
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen?.().catch(() => {});
        }
      } catch {
        // Fallback
      }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDraggingNodeRef.current) {
          const stateId = draggedNodeIdRef.current;
          if (stateId && containerRef.current) {
            const svg = containerRef.current.querySelector('svg');
            if (svg) {
              currentNodeOffsetsRef.current[stateId] = { ...nodeInitialOffsetRef.current };
              applyDiagramOffsetsToSvg(
                svg,
                currentNodeOffsetsRef.current,
                currentEdgeOffsetsRef.current,
                null,
                selectedEdge?.id,
                layoutEngine,
                flowchartCurve
              );
            }
          }
          if (draggedNodeElRef.current) {
            draggedNodeElRef.current.classList.remove('dragging-state-node');
          }
          isDraggingNodeRef.current = false;
          draggedNodeIdRef.current = null;
          draggedNodeElRef.current = null;
          setIsNodeDragging(false);
          return;
        }
        if (isInspectorOpen) {
          handleCloseInspector();
          return;
        }
        if (isFullscreen) {
          setIsFullscreen(false);
          if (document.fullscreenElement) {
            document.exitFullscreen?.().catch(() => {});
          }
        }
      }

      // Keyboard arrow keys to nudge selected state node position
      if (effectiveSelectedStateId && !isInspectorOpen && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const isArrow =
          e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight';
        if (isArrow) {
          const activeEl = document.activeElement;
          const isTyping =
            activeEl &&
            (activeEl.tagName === 'INPUT' ||
              activeEl.tagName === 'TEXTAREA' ||
              activeEl.getAttribute('contenteditable') === 'true');
          if (!isTyping) {
            e.preventDefault();
            const step = e.shiftKey ? 15 : 3;
            const delta = {
              x: e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
              y: e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
            };
            const current = effectiveNodeOffsets[effectiveSelectedStateId] || { x: 0, y: 0 };
            const next = { x: current.x + delta.x, y: current.y + delta.y };
            const nextOffsets = { ...effectiveNodeOffsets, [effectiveSelectedStateId]: next };
            currentNodeOffsetsRef.current = nextOffsets;
            setNodeOffsets(nextOffsets);
            if (containerRef.current) {
              const svg = containerRef.current.querySelector('svg');
              if (svg) {
                applyDiagramOffsetsToSvg(
                  svg,
                  nextOffsets,
                  currentEdgeOffsetsRef.current,
                  null,
                  selectedEdge?.id,
                  layoutEngine,
                  flowchartCurve
                );
              }
            }
          }
        }
      }
    };
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [isFullscreen, isInspectorOpen, effectiveSelectedStateId, effectiveNodeOffsets]);

  return (
    <div
      id="mermaid-viewer-container"
      className={`relative flex flex-col w-full h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden ${
        isFullscreen ? 'fixed inset-0 z-[100] w-screen h-screen rounded-none border-none shadow-2xl' : ''
      }`}
    >
      {/* Viewer Header / Toolbar */}
      <div
        id="mermaid-toolbar"
        className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2 bg-slate-950/90 border-b border-slate-800 backdrop-blur text-xs text-slate-300 z-10"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex items-center gap-2 font-medium shrink-0">
            <span className={`inline-block w-2 h-2 rounded-full ${isFullscreen ? 'bg-sky-400 animate-pulse' : 'bg-emerald-400'}`}></span>
            <span className="hidden xl:inline">Interactive Diagram View</span>
            <span className="xl:hidden font-semibold">Diagram</span>
          </div>

          {/* Drag layout hint badge */}
          <div className="hidden lg:flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 select-none">
            <Move className="w-3 h-3 text-sky-400" />
            <span>Drag nodes to adjust layout</span>
          </div>

          {/* Search Input for States and Transitions */}
          <div className="relative flex items-center min-w-[200px] max-w-xs sm:max-w-sm md:max-w-md w-full">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
            <input
              ref={searchInputRef}
              id="diagram-search-input"
              type="text"
              value={effectiveSearchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search states or transitions... (Ctrl+F)"
              className="w-full bg-slate-900/90 border border-slate-700/80 rounded-lg pl-8 pr-20 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50 transition-all"
            />
            {effectiveSearchQuery.trim() && (
              <div className="absolute right-1.5 flex items-center gap-0.5">
                <span
                  id="diagram-search-matches-count"
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded border leading-none ${
                    matches.length > 0
                      ? 'bg-sky-950/90 text-sky-300 border-sky-800/80'
                      : 'bg-rose-950/90 text-rose-300 border-rose-800/80'
                  }`}
                  title={
                    matches.length > 0
                      ? `${matchesBreakdown.states} states, ${matchesBreakdown.transitions} transitions matching`
                      : 'No matching states or transitions'
                  }
                >
                  {matches.length > 0 ? `${activeMatchIndex + 1}/${matches.length}` : '0 found'}
                </span>

                {matches.length > 1 && (
                  <div className="flex items-center">
                    <button
                      id="diagram-search-prev-btn"
                      type="button"
                      onClick={goToPrevMatch}
                      className="p-0.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors"
                      title="Previous match (Shift+Enter)"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      id="diagram-search-next-btn"
                      type="button"
                      onClick={goToNextMatch}
                      className="p-0.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors"
                      title="Next match (Enter)"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <button
                  id="diagram-search-clear-btn"
                  type="button"
                  onClick={clearSearch}
                  className="p-0.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors"
                  title="Clear search (Esc)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Interactive Mode Toggle */}
          <button
            id="toggle-interactive-mode-btn"
            type="button"
            onClick={() => setIsInteractiveMode((prev) => !prev)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all text-xs font-medium ${
              isInteractiveMode
                ? 'bg-emerald-600/90 hover:bg-emerald-500 text-white shadow-sm ring-1 ring-emerald-400/40'
                : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60'
            }`}
            title="Toggle Interactive Mode: Clean compact transition labels with click-to-expand condition details overlay"
          >
            <MousePointerClick className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Interactive</span>
            <span
              className={`px-1.5 py-0.2 rounded-full font-bold text-[10px] ${
                isInteractiveMode
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-700/60'
                  : 'bg-slate-900 text-slate-400'
              }`}
            >
              {isInteractiveMode ? 'ON' : 'OFF'}
            </span>
          </button>

          {isInteractiveMode && (
            <button
              id="toggle-compact-labels-btn"
              type="button"
              onClick={() => setIsCompactLabels((prev) => !prev)}
              className={`hidden md:flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                isCompactLabels
                  ? 'bg-slate-800/90 text-sky-300 border border-sky-500/30'
                  : 'bg-slate-900/60 text-slate-400 hover:text-slate-300 border border-slate-800'
              }`}
              title={
                isCompactLabels
                  ? 'Compact labels enabled: long transition guards are shortened for a cleaner diagram layout'
                  : 'Full labels enabled: showing full condition text on transitions'
              }
            >
              <SlidersHorizontal className="w-3 h-3 text-sky-400" />
              <span>{isCompactLabels ? 'Clean Layout' : 'Full Labels'}</span>
            </button>
          )}

          {/* Node Styles Inspector Toggle */}
          <button
            id="toggle-node-styles-btn"
            type="button"
            onClick={handleToggleInspector}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all text-xs font-medium ${
              isInspectorOpen
                ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-sm ring-1 ring-sky-400/40'
                : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60'
            }`}
            title="Customize State Node Colors (Background & Foreground)"
          >
            <Palette className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Node Styles</span>
            {customizedStatesCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-emerald-500 text-slate-950 font-bold text-[10px]">
                {customizedStatesCount}
              </span>
            )}
          </button>

          {/* Reset Diagram Layout Button (shown when any node or edge has been repositioned) */}
          {movedElementsCount > 0 && (
            <button
              id="reset-diagram-layout-btn"
              type="button"
              onClick={handleResetLayout}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-medium transition-all shadow-sm"
              title="Reset manual node and edge positions back to default Mermaid layout"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Reset Layout</span>
              <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 font-bold text-[10px]">
                {movedElementsCount}
              </span>
            </button>
          )}

          {/* Notes Drawer Button */}
          <button
            id="toggle-notes-drawer-btn"
            type="button"
            onClick={() => setIsNotesDrawerOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all text-xs font-medium ${
              totalNotesCount > 0
                ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30'
                : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60'
            }`}
            title="View and manage diagram notes (Right-click any node or transition to add a note)"
          >
            <StickyNote className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Notes</span>
            {totalNotesCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 font-bold text-[10px]">
                {totalNotesCount}
              </span>
            )}
          </button>

          <div className="w-[1px] h-4 bg-slate-800 mx-1"></div>

          <button
            id="zoom-out-button"
            type="button"
            onClick={() => setZoom((z) => Math.max(0.2, z * 0.85))}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="px-2 py-0.5 font-mono text-[11px] text-slate-400 select-none">
            {Math.round(zoom * 100)}%
          </span>
          <button
            id="zoom-in-button"
            type="button"
            onClick={() => setZoom((z) => Math.min(5, z * 1.15))}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            id="zoom-reset-button"
            type="button"
            onClick={handleResetZoom}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title="Reset View"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <div className="w-[1px] h-4 bg-slate-800 mx-1"></div>

          {/* Quick High-Res PNG Button */}
          <button
            id="quick-download-png-button"
            type="button"
            onClick={() => handleQuickDownloadPng(2)}
            disabled={!svgContent}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white transition-colors disabled:opacity-40 text-xs font-medium border border-slate-700/50 bg-slate-800/40"
            title="Download High-Resolution 2x PNG (Retina Quality)"
          >
            <FileImage className="w-3.5 h-3.5 text-sky-400" />
            <span>PNG</span>
            <span className="text-[10px] px-1 py-0.2 rounded bg-sky-950 text-sky-400 font-mono border border-sky-800/60 leading-none">2x</span>
          </button>

          {/* Quick SVG Vector Button */}
          <button
            id="quick-download-svg-button"
            type="button"
            onClick={() => handleQuickDownloadSvg(1)}
            disabled={!svgContent}
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40 text-xs font-medium"
            title="Download Standalone Vector SVG diagram"
          >
            <FileCode className="w-3.5 h-3.5 text-indigo-400" />
            <span>SVG</span>
          </button>

          {/* High-Resolution Export Dropdown Menu */}
          <div className="relative" ref={exportMenuRef}>
            <button
              id="export-dropdown-button"
              type="button"
              onClick={() => setIsExportMenuOpen((prev) => !prev)}
              disabled={!svgContent}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-600/90 hover:bg-sky-500 text-white font-medium text-xs shadow-sm transition-all disabled:opacity-40"
              title="Export high-resolution PNG/SVG with custom scale and options"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${isExportMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isExportMenuOpen && (
              <div
                id="export-options-dropdown"
                className="absolute right-0 top-full mt-1.5 w-60 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl py-1.5 z-40 text-xs text-slate-200 divide-y divide-slate-800/70"
              >
                <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  High-Resolution Export
                </div>
                <div className="py-1">
                  <button
                    id="dropdown-open-modal-btn"
                    type="button"
                    onClick={() => handleOpenExportModal('png')}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-800 text-sky-400 font-medium transition-colors"
                  >
                    <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
                    <div>
                      <div className="text-white text-xs">High-Res Export Dialog...</div>
                      <div className="text-[10px] text-slate-400">Custom scale (1x-4x), background & DPI</div>
                    </div>
                  </button>
                </div>
                <div className="py-1">
                  <div className="px-3 py-1 text-[10px] text-slate-500 font-medium">Quick Downloads</div>
                  <button
                    id="dropdown-png-2x-btn"
                    type="button"
                    onClick={() => handleQuickDownloadPng(2)}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <FileImage className="w-3.5 h-3.5 text-sky-400" />
                      Download PNG
                    </span>
                    <span className="text-[10px] font-mono text-sky-400 bg-sky-950/80 px-1 rounded border border-sky-800/50">2x Retina</span>
                  </button>
                  <button
                    id="dropdown-png-4x-btn"
                    type="button"
                    onClick={() => handleQuickDownloadPng(4)}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <FileImage className="w-3.5 h-3.5 text-emerald-400" />
                      Download PNG
                    </span>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/80 px-1 rounded border border-emerald-800/50">4x UHD 4K</span>
                  </button>
                  <button
                    id="dropdown-svg-btn"
                    type="button"
                    onClick={() => handleQuickDownloadSvg(1)}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <FileCode className="w-3.5 h-3.5 text-indigo-400" />
                      Download SVG
                    </span>
                    <span className="text-[10px] font-mono text-indigo-400 bg-indigo-950/80 px-1 rounded border border-indigo-800/50">Vector</span>
                  </button>
                </div>
                <div className="py-1">
                  <div className="px-3 py-1 text-[10px] text-slate-500 font-medium">Copy to System Clipboard</div>
                  <button
                    id="dropdown-copy-png-btn"
                    type="button"
                    onClick={() => handleQuickCopyPng(2)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                    <span>Copy PNG (2x Retina)</span>
                  </button>
                  <button
                    id="dropdown-copy-svg-btn"
                    type="button"
                    onClick={handleQuickCopySvg}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
                  >
                    {copiedSvg ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                    <span>{copiedSvg ? 'Copied SVG!' : 'Copy SVG Vector'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="w-[1px] h-4 bg-slate-800 mx-1"></div>
          <button
            id="fullscreen-button"
            type="button"
            onClick={toggleFullscreen}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all text-xs font-medium ${
              isFullscreen
                ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-sm ring-1 ring-sky-400/40'
                : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60'
            }`}
            title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Expand diagram canvas to fill the entire browser window'}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Exit Fullscreen</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Fullscreen</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Diagram Canvas */}
      <div
        ref={containerRef}
        id="mermaid-canvas-area"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        className={`flex-1 relative overflow-hidden [background-size:16px_16px] cursor-grab transition-colors duration-200 ${
          mermaidTheme === 'dark'
            ? 'bg-slate-900 bg-[radial-gradient(#1e293b_1px,transparent_1px)]'
            : mermaidTheme === 'forest'
            ? 'bg-[#f4f7f4] bg-[radial-gradient(#cbd5e1_1px,transparent_1px)]'
            : mermaidTheme === 'neutral'
            ? 'bg-[#f5f5f4] bg-[radial-gradient(#d6d3d1_1px,transparent_1px)]'
            : 'bg-[#f8fafc] bg-[radial-gradient(#cbd5e1_1px,transparent_1px)]'
        } ${isDragging || isNodeDragging ? 'cursor-grabbing select-none' : ''}`}
      >
        {error ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center text-rose-400 max-w-md mx-auto">
            <AlertCircle className="w-8 h-8 mb-2" />
            <p className="font-semibold text-sm">Mermaid Render Error</p>
            <p className="text-xs text-slate-400 mt-1 font-mono break-all bg-slate-950/80 p-3 rounded border border-rose-900/50">
              {error}
            </p>
          </div>
        ) : svgContent ? (
          <div
            id="mermaid-svg-wrapper"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              transition: 'none',
            }}
            className="w-full h-full p-8 select-none flex items-center justify-center [&>svg]:max-w-none [&>svg]:max-h-none relative"
          >
            <div
              className="contents"
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
            <NoteOverlaysLayer
              notes={effectiveNotes}
              availableStates={availableStates}
              availableEdges={availableEdges}
              svgElement={renderedSvg || containerRef.current?.querySelector('svg') || null}
              zoom={zoom}
              onEditNote={handleOpenAddNote}
              onDeleteNote={handleDeleteActiveNote}
              onUpdateNotePosition={onUpdateNotePositionProp || (() => {})}
              onUpdateNoteStyle={onUpdateNoteStyle}
              onSelectTarget={(target) => {
                if (target.type === 'node') {
                  handleSelectState(target.id, target.label || target.id);
                  panToState(target.id);
                } else if (target.type === 'edge') {
                  const edge = availableEdges.find((e) => e.id === target.id);
                  if (edge) setSelectedEdge(edge);
                  panToEdge(target.id);
                }
              }}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            Diagram will appear here once generated
          </div>
        )}

        {/* Floating State Node Style Inspector */}
        {isInspectorOpen && effectiveSelectedStateId && (
          <StateNodeStyleInspector
            selectedStateId={effectiveSelectedStateId}
            selectedStateLabel={effectiveSelectedStateLabel}
            availableStates={availableStates}
            customStyles={effectiveCustomStyles}
            onStyleChange={handleStyleChange}
            onResetStateStyle={handleResetStateStyle}
            onClearAllCustomStyles={handleClearAllCustomStyles}
            onSelectState={(id, label) => {
              handleSelectState(id, label);
              if (id) panToState(id);
            }}
            onClose={handleCloseInspector}
          />
        )}

        {/* Floating Transition Condition Detail Overlay */}
        {activeConditionOverlay && (
          <EdgeConditionDetailOverlay
            edge={activeConditionOverlay.edge}
            anchorPos={activeConditionOverlay.anchorPos}
            containerRef={containerRef}
            notes={effectiveNotes}
            onClose={() => setActiveConditionOverlay(null)}
            onSelectState={(id, label) => {
              handleSelectState(id, label);
              panToState(id);
            }}
            onOpenNoteEditor={(edge) => {
              handleOpenAddNote({
                type: 'edge',
                id: edge.id,
                from: edge.from,
                to: edge.to,
                label: edge.label,
                note: edge.note,
                pathId: edge.pathId,
              });
            }}
          />
        )}

        {/* Right-click Context Menu */}
        {contextMenuState && (
          <DiagramContextMenu
            x={contextMenuState.x}
            y={contextMenuState.y}
            target={contextMenuState.target}
            onAddOrEditNote={handleOpenAddNote}
            onDeleteNote={handleDeleteActiveNote}
            onOpenStyleCustomizer={(stateId: string) => {
              const st = availableStates.find((s) => s.id === stateId);
              handleSelectState(stateId, st?.label || stateId);
              setIsInspectorOpen(true);
            }}
            onOpenMermaidLive={onOpenMermaidLive}
            onExportImage={(fmt) => handleOpenExportModal(fmt)}
            onClose={() => setContextMenuState(null)}
          />
        )}

        {/* High-Resolution Export Modal */}
        <ExportModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          svgElement={getActiveSvgElement()}
          baseFileName={fileName}
          notes={effectiveNotes}
          customStyles={effectiveCustomStyles}
          theme={mermaidTheme}
          defaultFormat={exportModalDefaultFormat}
        />

        {/* Export Notification Toast */}
        {exportingNotification && (
          <div
            id="export-toast-notification"
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900/95 border border-sky-500/50 shadow-2xl text-xs text-white backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-200 pointer-events-none"
          >
            <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
            <span>{exportingNotification}</span>
          </div>
        )}

        {/* Note Dialog Modal */}
        <NoteDialog
          isOpen={isNoteDialogOpen}
          target={activeNoteTarget}
          currentNote={activeNoteTarget && activeNoteTarget.type !== 'canvas' ? activeNoteTarget.note : ''}
          onSave={handleSaveActiveNote}
          onDelete={handleDeleteActiveNote}
          onClose={() => setIsNoteDialogOpen(false)}
        />

        {/* Notes Drawer */}
        <NotesDrawer
          isOpen={isNotesDrawerOpen}
          notes={effectiveNotes}
          onSelectTarget={(target: ContextMenuTarget) => {
            if (target.type === 'node') {
              handleSelectState(target.id, target.label || target.id);
              panToState(target.id);
            } else if (target.type === 'edge') {
              const edge = availableEdges.find((e) => e.id === target.id);
              if (edge) setSelectedEdge(edge);
              panToEdge(target.id);
            }
          }}
          onEditNote={(target: ContextMenuTarget) => {
            setActiveNoteTarget(target);
            setIsNoteDialogOpen(true);
          }}
          onDeleteNote={(target: ContextMenuTarget) => {
            handleDeleteActiveNote(target);
          }}
          onClearAllNotes={() => {
            onClearAllNotes?.();
          }}
          onOpenMermaidLive={() => {
            onOpenMermaidLive?.();
          }}
          onClose={() => setIsNotesDrawerOpen(false)}
        />
      </div>
    </div>
  );
};
