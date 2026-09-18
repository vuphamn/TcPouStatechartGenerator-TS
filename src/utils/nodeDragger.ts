/**
 * Utilities for interactive SVG node dragging, connected edge deformation,
 * distortion-free edge rerouting, and manual edge selection/curve adjustments in Mermaid diagrams.
 */

import { EdgeInfo } from '../types.ts';

export interface Point {
  x: number;
  y: number;
}

export interface NodeOffset {
  x: number;
  y: number;
}

export interface EdgeOffset {
  x: number;
  y: number;
  startDx?: number;
  startDy?: number;
  endDx?: number;
  endDy?: number;
}

export type NodeOffsetsMap = Record<string, NodeOffset>;
export type EdgeOffsetsMap = Record<string, EdgeOffset>;

export interface PathCommand {
  type: string;
  args: number[];
}

export interface NodeGeometry {
  id: string;
  origCenterX: number;
  origCenterY: number;
  width: number;
  height: number;
  halfWidth: number;
  halfHeight: number;
}

export interface BoundaryIntersection {
  x: number;
  y: number;
  normalX: number;
  normalY: number;
}

/**
 * Parse an SVG path `d` string into commands and argument numbers.
 */
export function parseSvgPathCommands(d: string): PathCommand[] {
  if (!d) return [];
  const commands: PathCommand[] = [];
  const cmdRegex = /([a-df-z])([^a-df-z]*)/gi;
  let match: RegExpExecArray | null;
  let curX = 0;
  let curY = 0;

  while ((match = cmdRegex.exec(d)) !== null) {
    const type = match[1];
    const rawArgs = match[2].trim();
    const args = rawArgs
      ? (rawArgs.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number) || [])
      : [];

    const upper = type.toUpperCase();
    if (upper === 'H') {
      if (args.length >= 1) {
        const targetX = type === 'h' ? curX + args[0] : args[0];
        commands.push({ type: 'L', args: [targetX, curY] });
        curX = targetX;
      }
    } else if (upper === 'V') {
      if (args.length >= 1) {
        const targetY = type === 'v' ? curY + args[0] : args[0];
        commands.push({ type: 'L', args: [curX, targetY] });
        curY = targetY;
      }
    } else {
      commands.push({ type, args });
      if (args.length >= 2) {
        curX = args[args.length - 2];
        curY = args[args.length - 1];
      }
    }
  }
  return commands;
}

/**
 * Extract coordinate points (x, y pairs) from path commands.
 */
export function extractCoordinatePoints(commands: PathCommand[]): Point[] {
  const points: Point[] = [];
  for (const cmd of commands) {
    const type = cmd.type.toUpperCase();
    if (type === 'M' || type === 'L' || type === 'T' || type === 'C' || type === 'S' || type === 'Q') {
      for (let i = 0; i < cmd.args.length - 1; i += 2) {
        points.push({ x: cmd.args[i], y: cmd.args[i + 1] });
      }
    } else if (type === 'A') {
      if (cmd.args.length >= 7) {
        points.push({ x: cmd.args[5], y: cmd.args[6] });
      }
    }
  }
  return points;
}

/**
 * Parses translation from transform string, e.g. "translate(120, 340)" or "matrix(1, 0, 0, 1, 120, 340)".
 */
export function parseTranslation(transformStr: string): { x: number; y: number } {
  if (!transformStr) return { x: 0, y: 0 };
  const tm = transformStr.match(
    /translate\(\s*(-?[\d.]+(?:e[+-]?\d+)?)[,\s]+(-?[\d.]+(?:e[+-]?\d+)?)\s*\)/i
  );
  if (tm) {
    return { x: parseFloat(tm[1]), y: parseFloat(tm[2]) };
  }
  const singleTm = transformStr.match(/translate\(\s*(-?[\d.]+(?:e[+-]?\d+)?)\s*\)/i);
  if (singleTm) {
    return { x: parseFloat(singleTm[1]), y: 0 };
  }
  const mm = transformStr.match(
    /matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*(-?[\d.]+(?:e[+-]?\d+)?)[,\s]+(-?[\d.]+(?:e[+-]?\d+)?)\s*\)/i
  );
  if (mm) {
    return { x: parseFloat(mm[1]), y: parseFloat(mm[2]) };
  }
  return { x: 0, y: 0 };
}

/**
 * Compute the intersection of a ray from a box center towards a target point with the box's outer perimeter.
 */
export function computeBoxBoundaryIntersection(
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  tx: number,
  ty: number,
  padding = 2
): BoundaryIntersection {
  const dx = tx - cx;
  const dy = ty - cy;

  if (Math.abs(dx) < 1e-5 && Math.abs(dy) < 1e-5) {
    return { x: cx, y: cy - hh - padding, normalX: 0, normalY: -1 };
  }

  const effectiveHw = Math.max(12, hw + padding);
  const effectiveHh = Math.max(10, hh + padding);

  const scaleX = Math.abs(dx) > 1e-5 ? effectiveHw / Math.abs(dx) : Infinity;
  const scaleY = Math.abs(dy) > 1e-5 ? effectiveHh / Math.abs(dy) : Infinity;

  if (scaleX < scaleY) {
    // Exits left or right face
    const nx = dx > 0 ? 1 : -1;
    return {
      x: cx + nx * effectiveHw,
      y: cy + dy * scaleX,
      normalX: nx,
      normalY: 0,
    };
  } else {
    // Exits top or bottom face
    const ny = dy > 0 ? 1 : -1;
    return {
      x: cx + dx * scaleY,
      y: cy + ny * effectiveHh,
      normalX: 0,
      normalY: ny,
    };
  }
}

/**
 * Extract node bounding geometry (center and half-dimensions in diagram coordinate space).
 * Accumulates parent group transforms to match edgePaths coordinate space.
 */
export function getNodeGeometry(node: SVGGElement, svgRoot?: SVGSVGElement | null): NodeGeometry {
  const stateId = node.getAttribute('data-state-id') || '';
  
  // Accumulate transforms from node up to the common parent or svgRoot
  let totalTx = 0;
  let totalTy = 0;
  let curr: Element | null = node;
  const stopAt = svgRoot?.querySelector('g.edgePaths')?.parentElement || svgRoot || null;

  while (curr && curr !== stopAt && curr.tagName !== 'svg') {
    const tf = (curr === node ? curr.getAttribute('data-orig-transform') : null) || curr.getAttribute('transform') || '';
    if (tf) {
      const { x, y } = parseTranslation(tf);
      totalTx += x;
      totalTy += y;
    }
    curr = curr.parentElement;
  }

  let w = 120;
  let h = 50;
  let localCx = 0;
  let localCy = 0;

  try {
    const bbox = node.getBBox();
    if (bbox && bbox.width > 0 && bbox.height > 0) {
      w = bbox.width;
      h = bbox.height;
      localCx = bbox.x + bbox.width / 2;
      localCy = bbox.y + bbox.height / 2;
    }
  } catch {
    const rect = node.querySelector('rect');
    if (rect) {
      const rw = parseFloat(rect.getAttribute('width') || '120');
      const rh = parseFloat(rect.getAttribute('height') || '50');
      const rx = parseFloat(rect.getAttribute('x') || '0');
      const ry = parseFloat(rect.getAttribute('y') || '0');
      w = rw;
      h = rh;
      localCx = rx + rw / 2;
      localCy = ry + rh / 2;
    } else {
      const circle = node.querySelector('circle');
      if (circle) {
        const r = parseFloat(circle.getAttribute('r') || '12');
        w = 2 * r;
        h = 2 * r;
        localCx = 0;
        localCy = 0;
      }
    }
  }

  const origCenterX = totalTx + localCx;
  const origCenterY = totalTy + localCy;
  const halfWidth = Math.max(14, w / 2);
  const halfHeight = Math.max(12, h / 2);

  return {
    id: stateId,
    origCenterX,
    origCenterY,
    width: w,
    height: h,
    halfWidth,
    halfHeight,
  };
}

/**
 * Translates all coordinates in an SVG path by (dx, dy).
 */
export function translateSvgPath(d: string, dx: number, dy: number): string {
  if (!d || (dx === 0 && dy === 0)) return d;
  const commands = parseSvgPathCommands(d);
  let result = '';

  for (const cmd of commands) {
    const type = cmd.type;
    const upper = type.toUpperCase();
    const newArgs = [...cmd.args];

    if (upper === 'M' || upper === 'L' || upper === 'T' || upper === 'C' || upper === 'S' || upper === 'Q') {
      for (let i = 0; i < newArgs.length - 1; i += 2) {
        newArgs[i] = Math.round((newArgs[i] + dx) * 10) / 10;
        newArgs[i + 1] = Math.round((newArgs[i + 1] + dy) * 10) / 10;
      }
    } else if (upper === 'A') {
      if (newArgs.length >= 7) {
        newArgs[5] = Math.round((newArgs[5] + dx) * 10) / 10;
        newArgs[6] = Math.round((newArgs[6] + dy) * 10) / 10;
      }
    }

    if (newArgs.length === 0) {
      result += type;
    } else {
      result += `${type}${newArgs.join(',')}`;
    }
  }

  return result;
}

/**
 * Cleans raw Mermaid node IDs (removing diagram-id prefixes, 'flowchart-', 'state-', and trailing instance numbers like '-0').
 * Preserves user hyphens like 'step-1' or 'node-2'.
 */
export function cleanNodeId(raw: string): string {
  if (!raw) return '';
  let id = raw.trim();
  // Strip any diagram ID prefix before 'state-' or 'flowchart-'
  id = id.replace(/^[A-Za-z0-9_.-]+?-(?:state|flowchart)-/, '');
  id = id.replace(/^(?:state|flowchart)-/, '');
  // Strip trailing instance numbers like -0, -1, _0, _1
  id = id.replace(/[-_]\d+$/, '');
  return id.trim();
}

/**
 * Robustly finds an SVG node element in the diagram by stateId.
 */
export function findNodeElement(svg: SVGSVGElement, stateId: string): SVGGElement | null {
  if (!stateId) return null;
  const cleanId = cleanNodeId(stateId);
  const isStartEnd = cleanId === '[*]' || cleanId === 'root_start' || cleanId === 'root_end' || cleanId === 'startNode';

  const direct = (
    svg.querySelector(`g.node[data-state-id="${stateId}"]`) ||
    svg.querySelector(`g.node[data-state-id="${cleanId}"]`) ||
    svg.querySelector(`g.node[id="${stateId}"]`) ||
    svg.querySelector(`g.node[id="${cleanId}"]`) ||
    svg.querySelector(`g.node[id="flowchart-${cleanId}-0"]`) ||
    svg.querySelector(`g.node[id="state-${cleanId}-0"]`) ||
    svg.querySelector(`g.node[id*="flowchart-${cleanId}-"]`) ||
    svg.querySelector(`g.node[id*="state-${cleanId}-"]`) ||
    (isStartEnd
      ? (svg.querySelector('g.node[id*="root_start"], g.node[id*="root_end"], g.node[id*="startNode"], g.node.startNode') as SVGGElement | null)
      : null)
  ) as SVGGElement | null;
  if (direct) return direct;

  // Fallback: scan all nodes checking cleanNodeId(id) or data-state-label
  const allNodes = Array.from(svg.querySelectorAll('g.node')) as SVGGElement[];
  for (const n of allNodes) {
    const nStateId = n.getAttribute('data-state-id') || '';
    if (nStateId === stateId || nStateId === cleanId || cleanNodeId(nStateId) === cleanId) return n;

    const nId = n.getAttribute('id') || '';
    if (nId === stateId || cleanNodeId(nId) === cleanId || cleanNodeId(nId) === stateId) return n;

    const nLabel = n.getAttribute('data-state-label') || '';
    if (nLabel && (nLabel === stateId || nLabel === cleanId)) return n;
  }
  return null;
}

/**
 * Initializes SVG metadata for draggable state nodes, interactive edge paths, and edge hitboxes.
 * Should be called once whenever a new SVG is rendered.
 */
export function initializeSvgDragMetadata(
  svg: SVGSVGElement,
  availableEdges: EdgeInfo[] = []
): void {
  svg.setAttribute('data-drag-initialized', 'true');
  // 1. Gather all state nodes with initial transforms and geometry
  const nodes = Array.from(svg.querySelectorAll('g.node')) as SVGGElement[];
  const nodeCenters: { id: string; x: number; y: number; hw: number; hh: number }[] = [];

  for (const node of nodes) {
    const rawStateId = node.getAttribute('data-state-id') || node.getAttribute('id') || '';
    let stateId = cleanNodeId(rawStateId);
    if (!stateId && (rawStateId.includes('root_start') || rawStateId.includes('startNode'))) {
      stateId = '[*]';
    }
    if (!stateId) continue;
    node.setAttribute('data-state-id', stateId);

    if (!node.getAttribute('data-orig-transform')) {
      const origTf = node.getAttribute('transform') || '';
      node.setAttribute('data-orig-transform', origTf);
      const { x, y } = parseTranslation(origTf);
      node.setAttribute('data-orig-x', String(x));
      node.setAttribute('data-orig-y', String(y));
    }

    const geom = getNodeGeometry(node, svg);
    node.setAttribute('data-orig-cx', geom.origCenterX.toFixed(1));
    node.setAttribute('data-orig-cy', geom.origCenterY.toFixed(1));
    node.setAttribute('data-hw', geom.halfWidth.toFixed(1));
    node.setAttribute('data-hh', geom.halfHeight.toFixed(1));

    nodeCenters.push({
      id: stateId,
      x: geom.origCenterX,
      y: geom.origCenterY,
      hw: geom.halfWidth,
      hh: geom.halfHeight,
    });
  }

  // 2. Map all edge paths to their source and target nodes, and setup interactive hitboxes
  const allPaths = (Array.from(svg.querySelectorAll('g.edgePaths path')).filter(
    (p) => !p.closest('defs') && !p.closest('marker') && p.getAttribute('d') && !p.classList.contains('tc-edge-hitbox')
  ) as SVGPathElement[]);

  for (let idx = 0; idx < allPaths.length; idx++) {
    const path = allPaths[idx];
    const rawPathId = path.getAttribute('id') || path.getAttribute('data-id') || `path-${idx}`;
    const uniquePathId = rawPathId.startsWith('path-') ? `${rawPathId}_${idx}` : rawPathId;

    if (!path.getAttribute('data-orig-d')) {
      const d = path.getAttribute('d') || '';
      path.setAttribute('data-orig-d', d);
    }

    const origD = path.getAttribute('data-orig-d') || '';
    const points = extractCoordinatePoints(parseSvgPathCommands(origD));

    // Try finding source and target from classes, id, geometric proximity, or availableEdges
    const parent = path.parentElement;
    const classStr = `${path.getAttribute('class') || ''} ${parent?.getAttribute('class') || ''}`;
    const idStr = `${path.getAttribute('id') || ''} ${parent?.getAttribute('id') || ''}`;

    let sourceId: string | null = null;
    let targetId: string | null = null;

    // 1. Mermaid stateDiagram ID check: id="<diagramId>-edge<N>"
    const edgeIndexMatch = rawPathId.match(/-edge(\d+)$/) || path.getAttribute('id')?.match(/-edge(\d+)$/);
    if (edgeIndexMatch) {
      const edgeIdx = parseInt(edgeIndexMatch[1], 10);
      if (edgeIdx >= 0 && edgeIdx < availableEdges.length) {
        sourceId = availableEdges[edgeIdx].from;
        targetId = availableEdges[edgeIdx].to;
        path.setAttribute('data-edge-index', String(edgeIdx));
      }
    }

    // 2. Class check: LS-<source> LE-<target>
    if (!sourceId || !targetId) {
      const lsMatch = classStr.match(/\bLS-([A-Za-z0-9_.-]+)\b/);
      if (lsMatch) {
        const raw = lsMatch[1];
        sourceId = raw.includes('root_start') || raw.includes('startNode') ? '[*]' : cleanNodeId(raw);
      }
      const leMatch = classStr.match(/\bLE-([A-Za-z0-9_.-]+)\b/);
      if (leMatch) {
        const raw = leMatch[1];
        targetId = raw.includes('root_end') || raw.includes('startNode') || raw.includes('root_start') ? '[*]' : cleanNodeId(raw);
      }
    }

    // 3. Match against availableEdges by link name in id/classes
    if (!sourceId || !targetId) {
      for (let eIdx = 0; eIdx < availableEdges.length; eIdx++) {
        const e = availableEdges[eIdx];
        const cf = cleanNodeId(e.from);
        const ct = cleanNodeId(e.to);
        if (
          (cf && ct && (idStr.includes(`L_${cf}_${ct}`) || idStr.includes(`L-${cf}-${ct}`))) ||
          (classStr.includes(`LS-${cf}`) && classStr.includes(`LE-${ct}`)) ||
          (classStr.includes(`LS-state-${cf}`) && classStr.includes(`LE-state-${ct}`))
        ) {
          sourceId = e.from;
          targetId = e.to;
          path.setAttribute('data-edge-index', String(eIdx));
          break;
        }
      }
    }

    // 4. Sequential fallback if index matches
    if (!sourceId || !targetId) {
      if (idx < availableEdges.length) {
        sourceId = availableEdges[idx].from;
        targetId = availableEdges[idx].to;
        path.setAttribute('data-edge-index', String(idx));
      }
    }

    sourceId = sourceId ? cleanNodeId(sourceId) : '';
    targetId = targetId ? cleanNodeId(targetId) : '';

    if (sourceId) path.setAttribute('data-source-id', sourceId);
    if (targetId) path.setAttribute('data-target-id', targetId);

    const edgeKey = sourceId && targetId ? `${sourceId}->${targetId}` : uniquePathId;
    path.setAttribute('data-edge-id', uniquePathId);
    path.setAttribute('data-path-id', uniquePathId);
    path.setAttribute('data-edge-key', edgeKey);
    path.setAttribute('data-path-index', String(idx));
    path.classList.add('tc-edge-path');

    // Compute baseline curvature/offset of the original path to preserve natural curve
    if (points.length >= 2) {
      const p0 = points[0];
      const pEnd = points[points.length - 1];
      const midPoint = points[Math.floor(points.length / 2)];
      const lineDx = pEnd.x - p0.x;
      const lineDy = pEnd.y - p0.y;
      const lineLen = Math.hypot(lineDx, lineDy);
      if (lineLen > 10) {
        const lineMidX = (p0.x + pEnd.x) / 2;
        const lineMidY = (p0.y + pEnd.y) / 2;
        const normX = -lineDy / lineLen;
        const normY = lineDx / lineLen;
        const curvature = (midPoint.x - lineMidX) * normX + (midPoint.y - lineMidY) * normY;
        path.setAttribute('data-base-curvature', curvature.toFixed(1));
      }
    }

    // Add transparent wider hitbox alongside path
    if (parent) {
      let hitbox = parent.querySelector(`.tc-edge-hitbox[data-path-id="${uniquePathId}"]`) as SVGPathElement | null;
      if (!hitbox) {
        hitbox = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitbox.setAttribute('class', 'tc-edge-hitbox');
        hitbox.setAttribute('data-edge-id', uniquePathId);
        hitbox.setAttribute('data-path-id', uniquePathId);
        hitbox.setAttribute('data-edge-key', edgeKey);
        hitbox.setAttribute('data-path-index', String(idx));
        if (sourceId) hitbox.setAttribute('data-source-id', sourceId);
        if (targetId) hitbox.setAttribute('data-target-id', targetId);
        hitbox.setAttribute('d', path.getAttribute('d') || '');
        hitbox.setAttribute('fill', 'none');
        hitbox.setAttribute('stroke', 'rgba(0, 0, 0, 0.001)');
        hitbox.setAttribute('stroke-width', '28');
        hitbox.setAttribute('stroke-linecap', 'round');
        hitbox.setAttribute('stroke-linejoin', 'round');
        hitbox.setAttribute('pointer-events', 'stroke');
        hitbox.setAttribute('cursor', 'pointer');
        // Insert AFTER path so it sits on top in SVG painter's order
        if (path.nextSibling) {
          parent.insertBefore(hitbox, path.nextSibling);
        } else {
          parent.appendChild(hitbox);
        }
      } else {
        hitbox.setAttribute('d', path.getAttribute('d') || '');
        hitbox.setAttribute('data-edge-id', uniquePathId);
        hitbox.setAttribute('data-path-id', uniquePathId);
        hitbox.setAttribute('data-edge-key', edgeKey);
        hitbox.setAttribute('data-path-index', String(idx));
        if (sourceId) hitbox.setAttribute('data-source-id', sourceId);
        if (targetId) hitbox.setAttribute('data-target-id', targetId);
      }
    }
    path.setAttribute('pointer-events', 'stroke');
    path.setAttribute('cursor', 'pointer');
  }

  // 3. Link edge labels to edge paths
  const edgeLabels = Array.from(svg.querySelectorAll('g.edgeLabel')) as SVGGElement[];
  edgeLabels.forEach((labelEl, idx) => {
    if (!labelEl.getAttribute('data-orig-transform')) {
      const origTf = labelEl.getAttribute('transform') || '';
      labelEl.setAttribute('data-orig-transform', origTf);
      const { x, y } = parseTranslation(origTf);
      labelEl.setAttribute('data-orig-x', String(x));
      labelEl.setAttribute('data-orig-y', String(y));
    }

    // Match label to path
    let matchedPath: SVGPathElement | null = null;
    const labelDataId =
      labelEl.getAttribute('data-id') ||
      labelEl.querySelector('[data-id]')?.getAttribute('data-id');

    if (labelDataId) {
      matchedPath = allPaths.find((p) => p.getAttribute('data-id') === labelDataId) || null;
    }
    if (!matchedPath && idx < allPaths.length) {
      matchedPath = allPaths[idx];
    }

    if (matchedPath) {
      const pId = matchedPath.getAttribute('data-path-id') || String(idx);
      labelEl.setAttribute('data-linked-path-id', pId);
    }
  });

  // 4. Link priority badges
  const badges = Array.from(svg.querySelectorAll('.tc-priority-badge')) as SVGGElement[];
  for (const badge of badges) {
    if (!badge.getAttribute('data-orig-transform')) {
      const origTf = badge.getAttribute('transform') || '';
      badge.setAttribute('data-orig-transform', origTf);
      const { x, y } = parseTranslation(origTf);
      badge.setAttribute('data-orig-x', String(x));
      badge.setAttribute('data-orig-y', String(y));
    }
  }
}

/**
 * Resolve node offset flexibly by ID, element data-state-id, raw ID, or clean ID.
 */
export function resolveNodeOffset(
  id: string | null,
  nodeEl: SVGGElement | null,
  nodeOffsets: NodeOffsetsMap
): NodeOffset {
  if (!id && !nodeEl) return { x: 0, y: 0 };
  if (id && nodeOffsets[id]) return nodeOffsets[id];
  if (nodeEl) {
    const stateId = nodeEl.getAttribute('data-state-id');
    if (stateId && nodeOffsets[stateId]) return nodeOffsets[stateId];
    const rawId = nodeEl.getAttribute('id');
    if (rawId && nodeOffsets[rawId]) return nodeOffsets[rawId];
    const cleanRaw = cleanNodeId(rawId || '');
    if (cleanRaw && nodeOffsets[cleanRaw]) return nodeOffsets[cleanRaw];
  }
  const clean = cleanNodeId(id || '');
  if (clean && nodeOffsets[clean]) return nodeOffsets[clean];
  for (const [k, v] of Object.entries(nodeOffsets)) {
    if (cleanNodeId(k) === clean || cleanNodeId(k) === id || k === clean) {
      return v;
    }
  }
  return { x: 0, y: 0 };
}

/**
 * Deforms an existing SVG path string based on source node movement, target node movement,
 * and edge waypoint or endpoint offsets.
 * Preserves the pristine curvature and routing topology calculated by Mermaid while smoothly
 * anchoring endpoints to moving nodes so edges never disconnect.
 */
export function deformSvgPathWithOffsets(
  origD: string,
  srcOffset: NodeOffset,
  tgtOffset: NodeOffset,
  edgeOffset: EdgeOffset
): { d: string; midPoint: Point; startPoint: Point; endPoint: Point } {
  const commands = parseSvgPathCommands(origD);
  const points = extractCoordinatePoints(commands);
  if (points.length === 0) {
    return {
      d: origD,
      midPoint: { x: 0, y: 0 },
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 0 },
    };
  }

  // Calculate cumulative arc-length along the points
  const distances: number[] = [0];
  let totalDist = 0;
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    totalDist += seg;
    distances.push(totalDist);
  }

  const updatedPoints: Point[] = points.map((p, k) => {
    const t = totalDist > 0 ? distances[k] / totalDist : k / Math.max(1, points.length - 1);

    // 1. Interpolated node movement: start moves with srcOffset, end moves with tgtOffset
    const nodeDx = srcOffset.x * (1 - t) + tgtOffset.x * t;
    const nodeDy = srcOffset.y * (1 - t) + tgtOffset.y * t;

    // 2. Waypoint handle offset (smooth parabolic curve, max at t=0.5, 0 at endpoints)
    const midInfluence = 4 * t * (1 - t);
    const wpDx = (edgeOffset.x || 0) * midInfluence;
    const wpDy = (edgeOffset.y || 0) * midInfluence;

    // 3. Endpoint handle manual dragging
    const startDx = (edgeOffset.startDx || 0) * (1 - t);
    const startDy = (edgeOffset.startDy || 0) * (1 - t);
    const endDx = (edgeOffset.endDx || 0) * t;
    const endDy = (edgeOffset.endDy || 0) * t;

    return {
      x: p.x + nodeDx + wpDx + startDx + endDx,
      y: p.y + nodeDy + wpDy + startDy + endDy,
    };
  });

  // Reconstruct SVG path string preserving command types
  let ptIdx = 0;
  let newD = '';
  for (const cmd of commands) {
    const type = cmd.type;
    const upper = type.toUpperCase();
    if (upper === 'M' || upper === 'L' || upper === 'T') {
      const p = updatedPoints[ptIdx++];
      if (p) newD += `${type}${p.x.toFixed(1)},${p.y.toFixed(1)} `;
    } else if (upper === 'C') {
      const p1 = updatedPoints[ptIdx++];
      const p2 = updatedPoints[ptIdx++];
      const p3 = updatedPoints[ptIdx++];
      if (p1 && p2 && p3) {
        newD += `${type}${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)} ${p3.x.toFixed(1)},${p3.y.toFixed(1)} `;
      }
    } else if (upper === 'Q' || upper === 'S') {
      const p1 = updatedPoints[ptIdx++];
      const p2 = updatedPoints[ptIdx++];
      if (p1 && p2) {
        newD += `${type}${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)} `;
      }
    } else if (upper === 'A') {
      const p = updatedPoints[ptIdx++];
      if (p) {
        newD += `${type}${cmd.args[0]},${cmd.args[1]} ${cmd.args[2]} ${cmd.args[3]} ${cmd.args[4]} ${p.x.toFixed(1)},${p.y.toFixed(1)} `;
      }
    } else if (upper === 'Z') {
      newD += `${type} `;
    }
  }

  const startPoint = updatedPoints[0] || { x: 0, y: 0 };
  const endPoint = updatedPoints[updatedPoints.length - 1] || startPoint;
  const midPoint = updatedPoints[Math.floor(updatedPoints.length / 2)] || startPoint;

  return {
    d: newD.trim(),
    midPoint,
    startPoint,
    endPoint,
  };
}

/**
 * Calculate rerouted curve for an edge between two nodes, preventing distortion and matching curve/engine settings.
 */
export function calculateReroutedEdgePath(
  path: SVGPathElement,
  svg: SVGSVGElement,
  nodeOffsets: NodeOffsetsMap,
  edgeOffsets: EdgeOffsetsMap,
  layoutEngine: 'dagre' | 'elk' = 'elk',
  flowchartCurve: string = 'basis'
): { d: string; midPoint: Point; startPoint: Point; endPoint: Point } {
  const origD = path.getAttribute('data-orig-d') || path.getAttribute('d') || '';
  const rawPathId = path.getAttribute('data-path-id') || path.getAttribute('id') || '';
  const edgeId = path.getAttribute('data-edge-id') || rawPathId;
  const srcId = path.getAttribute('data-source-id');
  const tgtId = path.getAttribute('data-target-id');
  const edgeKey = srcId && tgtId ? `${srcId}->${tgtId}` : edgeId;

  const srcNodeEl = srcId ? findNodeElement(svg, srcId) : null;
  const tgtNodeEl = tgtId ? findNodeElement(svg, tgtId) : null;

  const srcOffset = resolveNodeOffset(srcId, srcNodeEl, nodeOffsets);
  const tgtOffset = resolveNodeOffset(tgtId, tgtNodeEl, nodeOffsets);
  const edgeOffset =
    edgeOffsets[rawPathId] ||
    edgeOffsets[edgeId] ||
    (edgeKey ? edgeOffsets[edgeKey] : undefined) ||
    { x: 0, y: 0 };

  const hasNodeMovement = srcOffset.x !== 0 || srcOffset.y !== 0 || tgtOffset.x !== 0 || tgtOffset.y !== 0;
  const hasEdgeMovement =
    edgeOffset.x !== 0 ||
    edgeOffset.y !== 0 ||
    (edgeOffset.startDx !== undefined && edgeOffset.startDx !== 0) ||
    (edgeOffset.startDy !== undefined && edgeOffset.startDy !== 0) ||
    (edgeOffset.endDx !== undefined && edgeOffset.endDx !== 0) ||
    (edgeOffset.endDy !== undefined && edgeOffset.endDy !== 0);

  // If no node moved and edge wasn't dragged, extract original endpoints and return original path
  if (!hasNodeMovement && !hasEdgeMovement) {
    const origPoints = extractCoordinatePoints(parseSvgPathCommands(origD));
    const startPoint = origPoints[0] || { x: 0, y: 0 };
    const endPoint = origPoints[origPoints.length - 1] || startPoint;
    const midPoint = origPoints[Math.floor(origPoints.length / 2)] || startPoint;
    return { d: origD, midPoint, startPoint, endPoint };
  }

  // Self-loop (srcId === tgtId): Rigidly translate loop to maintain pristine circular/oval shape
  if (srcId && tgtId && srcId === tgtId) {
    const totalDx = srcOffset.x + edgeOffset.x;
    const totalDy = srcOffset.y + edgeOffset.y;
    const newD = translateSvgPath(origD, totalDx, totalDy);
    const loopPoints = extractCoordinatePoints(parseSvgPathCommands(newD));
    const startPoint = loopPoints[0] || { x: 0, y: 0 };
    const endPoint = loopPoints[loopPoints.length - 1] || startPoint;
    const midPoint = loopPoints[Math.floor(loopPoints.length / 2)] || startPoint;
    return { d: newD, midPoint, startPoint, endPoint };
  }

  return deformSvgPathWithOffsets(origD, srcOffset, tgtOffset, edgeOffset);
}

/**
 * Apply both node offsets and edge offsets to the SVG diagram in real-time.
 * Manages draggable state nodes, rerouted edges, and interactive edge endpoint handles.
 */
export function applyDiagramOffsetsToSvg(
  svg: SVGSVGElement,
  nodeOffsets: NodeOffsetsMap,
  edgeOffsets: EdgeOffsetsMap,
  targetEdgeId?: string | null,
  selectedEdgeId?: string | null,
  layoutEngine: 'dagre' | 'elk' = 'elk',
  flowchartCurve: string = 'basis'
): void {
  const actualSelectedEdgeId =
    selectedEdgeId !== undefined && selectedEdgeId !== null
      ? selectedEdgeId
      : targetEdgeId && (targetEdgeId.includes('->') || targetEdgeId.includes('#') || targetEdgeId.startsWith('path-'))
      ? targetEdgeId
      : null;

  // Ensure metadata is initialized first on this SVG element
  if (!svg.getAttribute('data-drag-initialized')) {
    initializeSvgDragMetadata(svg);
  }

  // 1. Update node transforms
  const nodesToUpdate = Array.from(svg.querySelectorAll('g.node')) as SVGGElement[];
  for (const node of nodesToUpdate) {
    const rawStateId = node.getAttribute('data-state-id') || node.getAttribute('id') || '';
    let stateId = cleanNodeId(rawStateId);
    if (!stateId && (rawStateId.includes('root_start') || rawStateId.includes('startNode'))) {
      stateId = '[*]';
    }
    if (!stateId) continue;
    if (!node.getAttribute('data-state-id')) {
      node.setAttribute('data-state-id', stateId);
    }

    // Ensure original transform is captured from pristine Mermaid layout if not yet saved
    if (!node.getAttribute('data-orig-transform')) {
      const currentTf = node.getAttribute('transform') || '';
      node.setAttribute('data-orig-transform', currentTf);
      const { x, y } = parseTranslation(currentTf);
      node.setAttribute('data-orig-x', String(x));
      node.setAttribute('data-orig-y', String(y));
    }

    const offset = resolveNodeOffset(stateId, node, nodeOffsets);
    if (offset.x === 0 && offset.y === 0) {
      // Node has NOT been moved - restore pristine original transform from Mermaid!
      const origTf = node.getAttribute('data-orig-transform');
      if (origTf !== null && origTf !== undefined) {
        node.setAttribute('transform', origTf);
      }
    } else {
      // Node has been moved by user dragging
      const origX = parseFloat(node.getAttribute('data-orig-x') || '0');
      const origY = parseFloat(node.getAttribute('data-orig-y') || '0');
      node.setAttribute('transform', `translate(${origX + offset.x}, ${origY + offset.y})`);
    }
  }

  // 2. Update edge paths, hitboxes, labels, and handles
  const allPaths = (Array.from(svg.querySelectorAll('g.edgePaths path')).filter(
    (p) => !p.closest('defs') && !p.closest('marker') && p.getAttribute('d') && !p.classList.contains('tc-edge-hitbox')
  ) as SVGPathElement[]);

  // Ensure waypoint handle group exists in the same coordinate space on top
  const edgePathsGroup = svg.querySelector('g.edgePaths');
  const parentContainer = (edgePathsGroup?.parentElement || svg) as SVGElement;
  let handlesGroup = parentContainer.querySelector('g.tc-edge-handles') as SVGGElement | null;
  if (!handlesGroup) {
    handlesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    handlesGroup.setAttribute('class', 'tc-edge-handles');
    parentContainer.appendChild(handlesGroup);
  } else if ((handlesGroup.parentElement as Element | null) !== parentContainer) {
    parentContainer.appendChild(handlesGroup);
  }
  // Ensure handlesGroup is on top of edges
  parentContainer.appendChild(handlesGroup);
  handlesGroup.style.pointerEvents = 'all';

  let selectedFound = false;

  for (const path of allPaths) {
    const rawPathId = path.getAttribute('data-path-id') || path.getAttribute('id') || '';
    const edgeId = path.getAttribute('data-edge-id') || rawPathId;
    const srcId = path.getAttribute('data-source-id');
    const tgtId = path.getAttribute('data-target-id');
    const edgeKey = srcId && tgtId ? `${srcId}->${tgtId}` : edgeId;

    const { d: newD, midPoint, startPoint, endPoint } = calculateReroutedEdgePath(
      path,
      svg,
      nodeOffsets,
      edgeOffsets,
      layoutEngine,
      flowchartCurve
    );

    // Update path `d`
    path.setAttribute('d', newD);

    // Update hitbox `d`
    const parent = path.parentElement;
    const hitbox = parent?.querySelector(`.tc-edge-hitbox[data-path-id="${rawPathId}"]`);
    if (hitbox) {
      hitbox.setAttribute('d', newD);
    }

    // Update edge label position to follow rerouted midpoint
    if (edgeKey || edgeId) {
      const labels = Array.from(
        svg.querySelectorAll(`g.edgeLabel[data-linked-path-id="${rawPathId}"], g.edgeLabel[data-linked-path-id="${edgeKey}"]`)
      ) as SVGGElement[];
      for (const label of labels) {
        const origLx = parseFloat(label.getAttribute('data-orig-x') || '0');
        const origLy = parseFloat(label.getAttribute('data-orig-y') || '0');
        // Smoothly adjust label based on difference from original midpoint
        const origD = path.getAttribute('data-orig-d') || '';
        const origPoints = extractCoordinatePoints(parseSvgPathCommands(origD));
        const origMid = origPoints[Math.floor(origPoints.length / 2)] || { x: origLx, y: origLy };
        const dX = midPoint.x - origMid.x;
        const dY = midPoint.y - origMid.y;
        label.setAttribute('transform', `translate(${origLx + dX}, ${origLy + dY})`);
      }

      // Update priority badge position
      const badges = Array.from(
        svg.querySelectorAll(`.tc-priority-badge[data-path-id="${rawPathId}"], .tc-priority-badge[data-path-id="${edgeKey}"]`)
      ) as SVGGElement[];
      for (const badge of badges) {
        const origD = path.getAttribute('data-orig-d') || '';
        const origPoints = extractCoordinatePoints(parseSvgPathCommands(origD));
        const origStart = origPoints[0] || { x: 0, y: 0 };
        const origBx = parseFloat(badge.getAttribute('data-orig-x') || '0');
        const origBy = parseFloat(badge.getAttribute('data-orig-y') || '0');
        const dX = startPoint.x - origStart.x;
        const dY = startPoint.y - origStart.y;
        badge.setAttribute('transform', `translate(${origBx + dX}, ${origBy + dY})`);
      }
    }

    // Highlight selected edge and update/show its draggable waypoint & 2 endpoint handles
    const pathId = rawPathId;
    const normSelected = actualSelectedEdgeId && actualSelectedEdgeId.trim() !== '->' ? actualSelectedEdgeId.trim() : '';

    let isSelected = false;
    if (normSelected) {
      if (pathId === normSelected || path.id === normSelected) {
        isSelected = true;
      } else if (
        !selectedFound &&
        (edgeId === normSelected ||
          edgeKey === normSelected ||
          (srcId && tgtId && `${srcId}->${tgtId}` === normSelected))
      ) {
        isSelected = true;
        selectedFound = true;
      }
    }

    if (isSelected) {
      path.classList.add('selected-edge', 'diagram-selected-edge');
      hitbox?.classList.add('selected-edge');

      const handleKey = pathId;

      // 1. Midpoint / Curvature handle
      let midHandle = handlesGroup.querySelector(
        `.tc-edge-handle[data-edge-id="${handleKey}"][data-handle-type="mid"]`
      ) as SVGGElement | null;
      if (!midHandle) {
        midHandle = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        midHandle.setAttribute('class', 'tc-edge-handle tc-edge-handle-mid cursor-grab');
        midHandle.setAttribute('data-edge-id', handleKey);
        midHandle.setAttribute('data-source-id', srcId || '');
        midHandle.setAttribute('data-target-id', tgtId || '');
        midHandle.setAttribute('data-handle-type', 'mid');

        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        halo.setAttribute('class', 'handle-halo');
        halo.setAttribute('r', '14');
        halo.setAttribute('fill', 'rgba(14, 165, 233, 0.2)');
        halo.setAttribute('stroke', '#0ea5e9');
        halo.setAttribute('stroke-width', '1.5');
        halo.setAttribute('stroke-dasharray', '3 2');

        const core = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        core.setAttribute('class', 'handle-core');
        core.setAttribute('r', '6');
        core.setAttribute('fill', '#38bdf8');
        core.setAttribute('stroke', '#0f172a');
        core.setAttribute('stroke-width', '2');
        core.setAttribute('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))');

        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = 'Curve Waypoint: Drag to adjust edge path and curve';

        midHandle.appendChild(halo);
        midHandle.appendChild(core);
        midHandle.appendChild(title);
        handlesGroup.appendChild(midHandle);
      } else {
        midHandle.setAttribute('data-source-id', srcId || '');
        midHandle.setAttribute('data-target-id', tgtId || '');
      }
      midHandle.setAttribute('transform', `translate(${midPoint.x.toFixed(1)}, ${midPoint.y.toFixed(1)})`);

      // 2. Start endpoint handle (Source anchor)
      let startHandle = handlesGroup.querySelector(
        `.tc-edge-handle[data-edge-id="${handleKey}"][data-handle-type="start"]`
      ) as SVGGElement | null;
      if (!startHandle) {
        startHandle = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        startHandle.setAttribute('class', 'tc-edge-handle tc-edge-endpoint-start cursor-crosshair');
        startHandle.setAttribute('data-edge-id', handleKey);
        startHandle.setAttribute('data-source-id', srcId || '');
        startHandle.setAttribute('data-target-id', tgtId || '');
        startHandle.setAttribute('data-handle-type', 'start');

        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        halo.setAttribute('class', 'handle-halo');
        halo.setAttribute('r', '14');
        halo.setAttribute('fill', 'rgba(16, 185, 129, 0.25)');
        halo.setAttribute('stroke', '#10b981');
        halo.setAttribute('stroke-width', '1.5');

        const core = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        core.setAttribute('class', 'handle-core');
        core.setAttribute('r', '6');
        core.setAttribute('fill', '#10b981');
        core.setAttribute('stroke', '#0f172a');
        core.setAttribute('stroke-width', '2');
        core.setAttribute('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))');

        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = 'Start Endpoint: Drag to reposition source anchor';

        startHandle.appendChild(halo);
        startHandle.appendChild(core);
        startHandle.appendChild(title);
        handlesGroup.appendChild(startHandle);
      } else {
        startHandle.setAttribute('data-source-id', srcId || '');
        startHandle.setAttribute('data-target-id', tgtId || '');
      }
      startHandle.setAttribute('transform', `translate(${startPoint.x.toFixed(1)}, ${startPoint.y.toFixed(1)})`);

      // 3. End endpoint handle (Target anchor)
      let endHandle = handlesGroup.querySelector(
        `.tc-edge-handle[data-edge-id="${handleKey}"][data-handle-type="end"]`
      ) as SVGGElement | null;
      if (!endHandle) {
        endHandle = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        endHandle.setAttribute('class', 'tc-edge-handle tc-edge-endpoint-end cursor-crosshair');
        endHandle.setAttribute('data-edge-id', handleKey);
        endHandle.setAttribute('data-source-id', srcId || '');
        endHandle.setAttribute('data-target-id', tgtId || '');
        endHandle.setAttribute('data-handle-type', 'end');

        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        halo.setAttribute('class', 'handle-halo');
        halo.setAttribute('r', '14');
        halo.setAttribute('fill', 'rgba(244, 63, 94, 0.25)');
        halo.setAttribute('stroke', '#f43f5e');
        halo.setAttribute('stroke-width', '1.5');

        const core = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        core.setAttribute('class', 'handle-core');
        core.setAttribute('r', '6');
        core.setAttribute('fill', '#f43f5e');
        core.setAttribute('stroke', '#0f172a');
        core.setAttribute('stroke-width', '2');
        core.setAttribute('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))');

        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = 'End Endpoint: Drag to reposition target anchor';

        endHandle.appendChild(halo);
        endHandle.appendChild(core);
        endHandle.appendChild(title);
        handlesGroup.appendChild(endHandle);
      } else {
        endHandle.setAttribute('data-source-id', srcId || '');
        endHandle.setAttribute('data-target-id', tgtId || '');
      }
      endHandle.setAttribute('transform', `translate(${endPoint.x.toFixed(1)}, ${endPoint.y.toFixed(1)})`);
    } else {
      path.classList.remove('selected-edge', 'diagram-selected-edge');
      hitbox?.classList.remove('selected-edge');
    }
  }

  // Remove handles for edges that are no longer selected
  if (handlesGroup) {
    const existingHandles = Array.from(handlesGroup.querySelectorAll('.tc-edge-handle'));
    const normSelected = actualSelectedEdgeId && actualSelectedEdgeId.trim() !== '->' ? actualSelectedEdgeId.trim() : '';
    for (const h of existingHandles) {
      const hEdgeId = (h.getAttribute('data-edge-id') || '').trim();
      const isStillSelected = Boolean(normSelected && hEdgeId === normSelected);
      if (!isStillSelected) {
        h.remove();
      }
    }
  }
}

/**
 * Convenience wrapper to maintain backward-compatibility with applyNodeOffsetsToSvg.
 */
export function applyNodeOffsetsToSvg(
  svg: SVGSVGElement,
  nodeOffsets: NodeOffsetsMap,
  targetNodeIds?: string[]
): void {
  applyDiagramOffsetsToSvg(svg, nodeOffsets, {}, null, null);
}

/**
 * Reset all manual node positions and edge offsets, restoring the original Mermaid layout.
 */
export function resetSvgDiagramOffsets(svg: SVGSVGElement): void {
  // 1. Reset all nodes to original transforms
  const nodes = Array.from(svg.querySelectorAll('g.node[data-orig-transform]')) as SVGGElement[];
  for (const node of nodes) {
    const origTf = node.getAttribute('data-orig-transform') || '';
    node.setAttribute('transform', origTf);
  }

  // 2. Reset all paths to original d
  const paths = Array.from(svg.querySelectorAll('g.edgePaths path[data-orig-d]')) as SVGPathElement[];
  for (const path of paths) {
    const origD = path.getAttribute('data-orig-d') || '';
    path.setAttribute('d', origD);
    path.classList.remove('selected-edge');

    const edgeId = path.getAttribute('data-edge-id') || path.getAttribute('data-path-id');
    const hitbox = path.parentElement?.querySelector(`.tc-edge-hitbox[data-edge-id="${edgeId}"]`);
    if (hitbox) {
      hitbox.setAttribute('d', origD);
      hitbox.classList.remove('selected-edge');
    }
  }

  // 3. Reset all edge labels
  const labels = Array.from(svg.querySelectorAll('g.edgeLabel[data-orig-transform]')) as SVGGElement[];
  for (const label of labels) {
    const origTf = label.getAttribute('data-orig-transform') || '';
    label.setAttribute('transform', origTf);
  }

  // 4. Reset all priority badges
  const badges = Array.from(svg.querySelectorAll('.tc-priority-badge[data-orig-transform]')) as SVGGElement[];
  for (const badge of badges) {
    const origTf = badge.getAttribute('data-orig-transform') || '';
    badge.setAttribute('transform', origTf);
  }

  // 5. Remove any waypoint handles
  const handles = svg.querySelector('g.tc-edge-handles');
  if (handles) {
    handles.remove();
  }
}

/**
 * Alias for backward-compatibility.
 */
export const resetSvgNodeOffsets = resetSvgDiagramOffsets;
