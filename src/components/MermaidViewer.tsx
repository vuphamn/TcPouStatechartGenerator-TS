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
} from 'lucide-react';
import { StateNodeStyleInspector } from './StateNodeStyleInspector.tsx';
import { CustomNodeStylesMap, NodeDisplayProperties } from '../types.ts';
import { extractStateNodesFromMermaid } from '../utils/nodeStyles.ts';
import {
  NodeOffsetsMap,
  initializeSvgDragMetadata,
  applyNodeOffsetsToSvg,
  resetSvgNodeOffsets,
} from '../utils/nodeDragger.ts';

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

function enhanceSvgWithPriorityCircles(
  svgString: string,
  selectedStateId?: string | null,
  customStyles?: CustomNodeStylesMap
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
      const match = id.match(/(?:flowchart|state)-([A-Za-z0-9_]+)-\d+$/);
      let rawId = match ? match[1] : '';
      if (!rawId) {
        const dataId = node.getAttribute('data-id') || node.getAttribute('data-node-id');
        if (dataId) rawId = dataId;
      }
      if (rawId && rawId !== 'root_start' && rawId !== 'root_end' && rawId !== 'startNode') {
        node.setAttribute('data-state-id', rawId);
        const label =
          node.querySelector('.nodeLabel')?.textContent?.trim() ||
          node.textContent?.trim() ||
          rawId;
        node.setAttribute('data-state-label', label);
        node.classList.add('clickable-state-node');

        if (selectedStateId && rawId === selectedStateId) {
          node.classList.add('diagram-selected-node');
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

      if (paths.length === 0 || labels.length === 0) continue;

      // Dedicated priority layer inside this cluster (rendered directly after edgePaths)
      const clusterBadgeLayer = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
      clusterBadgeLayer.setAttribute('class', 'priority-badges-cluster');

      const usedPathIndices = new Set<number>();

      for (let i = 0; i < labels.length; i++) {
        const labelEl = labels[i];
        const text = labelEl.textContent || '';
        const prioInfo = extractPriorityFromText(text);
        if (!prioInfo) continue;

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

        if (!pathEl) continue;

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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const mouseDownPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [copiedSvg, setCopiedSvg] = useState<boolean>(false);

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
          },
          state: {
            useMaxWidth: false,
          },
        });
        const uniqueId = `mermaid-render-${Math.random().toString(36).substring(2, 9)}`;
        const { svg } = await mermaid.render(uniqueId, code);
        if (isMounted) {
          const enhancedSvg = enhanceSvgWithPriorityCircles(
            svg,
            effectiveSelectedStateId,
            effectiveCustomStyles
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
  }, [code, layoutEngine, flowchartCurve, mermaidTheme, effectiveCustomStyles]);

  // Synchronize selection highlight class in SVG
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

  // Initialize SVG metadata for draggable state nodes and apply active offsets
  useEffect(() => {
    if (!containerRef.current || !svgContent) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;
    initializeSvgDragMetadata(svg);
    if (Object.keys(effectiveNodeOffsets).length > 0) {
      applyNodeOffsetsToSvg(svg, effectiveNodeOffsets);
    }
  }, [svgContent, effectiveNodeOffsets]);

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
    // If clicking inside inspector or toolbar, don't initiate drag
    if (target.closest('#state-style-inspector') || target.closest('#mermaid-toolbar')) {
      return;
    }

    // Check if user clicked on a state node
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

    // Otherwise initiate canvas panning
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // 1. Dragging a state node
    if (isDraggingNodeRef.current && draggedNodeIdRef.current) {
      const stateId = draggedNodeIdRef.current;
      const screenDx = e.clientX - nodeDragStartPosRef.current.x;
      const screenDy = e.clientY - nodeDragStartPosRef.current.y;

      if (Math.hypot(screenDx, screenDy) >= 4) {
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
            applyNodeOffsetsToSvg(svg, currentNodeOffsetsRef.current, [stateId]);
          }
        }
      }
      return;
    }

    // 2. Panning canvas
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    // 1. Released while dragging a state node
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
        return;
      }

      // Click without drag -> select state and open inspector
      if (!wasMoved && stateId) {
        const targetNode = containerRef.current?.querySelector(`g.node[data-state-id="${stateId}"]`);
        const stateLabel = targetNode?.getAttribute('data-state-label') || stateId;
        handleSelectState(stateId, stateLabel);
        return;
      }
    }

    // 2. Released canvas panning
    setIsDragging(false);
    const dx = Math.abs(e.clientX - mouseDownPosRef.current.x);
    const dy = Math.abs(e.clientY - mouseDownPosRef.current.y);

    // If mouse moved less than 6 pixels, treat as a click
    if (dx < 6 && dy < 6) {
      const target = e.target as Element;
      // If clicking inside inspector or toolbar, don't change selection
      if (target.closest('#state-style-inspector') || target.closest('#mermaid-toolbar')) {
        return;
      }

      // Check if user clicked on a state node
      const nodeEl =
        target.closest('g.clickable-state-node') || target.closest('g.node[data-state-id]');
      if (nodeEl) {
        const stateId = nodeEl.getAttribute('data-state-id');
        const stateLabel = nodeEl.getAttribute('data-state-label') || stateId || '';
        if (stateId) {
          handleSelectState(stateId, stateLabel);
          return;
        }
      }

      // Clicked on empty canvas background -> close inspector and deselect
      if (effectiveSelectedStateId || isInspectorOpen) {
        handleCloseInspector();
      }
    }
  };

  // Window-level mouseup listener to guarantee drag never gets orphaned
  useEffect(() => {
    const handleWindowMouseUp = () => {
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
    setNodeOffsets({});
    if (containerRef.current) {
      const svg = containerRef.current.querySelector('svg');
      if (svg) {
        resetSvgNodeOffsets(svg);
      }
    }
  };

  const movedNodesCount = Object.keys(effectiveNodeOffsets).filter(
    (id) => effectiveNodeOffsets[id].x !== 0 || effectiveNodeOffsets[id].y !== 0
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

  const handleCopySvg = () => {
    if (!containerRef.current) return;
    const svg = containerRef.current.querySelector('svg');
    const svgToExport = svg ? new XMLSerializer().serializeToString(svg) : svgContent;
    if (!svgToExport) return;
    navigator.clipboard.writeText(svgToExport);
    setCopiedSvg(true);
    setTimeout(() => setCopiedSvg(false), 2000);
  };

  const handleDownloadSvg = () => {
    if (!containerRef.current) return;
    const svg = containerRef.current.querySelector('svg');
    const svgToExport = svg ? new XMLSerializer().serializeToString(svg) : svgContent;
    if (!svgToExport) return;
    const blob = new Blob([svgToExport], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'statechart.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

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
              applyNodeOffsetsToSvg(svg, currentNodeOffsetsRef.current, [stateId]);
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
                applyNodeOffsetsToSvg(svg, nextOffsets, [effectiveSelectedStateId]);
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

          {/* Reset Diagram Layout Button (shown when any node has been repositioned) */}
          {movedNodesCount > 0 && (
            <button
              id="reset-diagram-layout-btn"
              type="button"
              onClick={handleResetLayout}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-medium transition-all shadow-sm"
              title="Reset manual node positions back to default Mermaid layout"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Reset Layout</span>
              <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 font-bold text-[10px]">
                {movedNodesCount}
              </span>
            </button>
          )}

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
          <button
            id="copy-svg-button"
            type="button"
            onClick={handleCopySvg}
            disabled={!svgContent}
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40"
            title="Copy SVG (includes TwinCAT-style endpoint priority badges)"
          >
            {copiedSvg ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{copiedSvg ? 'Copied SVG' : 'Copy SVG'}</span>
          </button>
          <button
            id="download-svg-button"
            type="button"
            onClick={handleDownloadSvg}
            disabled={!svgContent}
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40"
            title="Download SVG vector diagram"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">SVG</span>
          </button>
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
              transition: isDragging || isNodeDragging ? 'none' : 'transform 0.05s ease-out',
            }}
            className="w-full h-full p-8 select-none flex items-center justify-center [&>svg]:max-w-none [&>svg]:max-h-none"
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
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
      </div>
    </div>
  );
};
