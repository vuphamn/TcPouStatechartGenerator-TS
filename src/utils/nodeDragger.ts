/**
 * Utilities for interactive SVG node dragging, connected edge deformation,
 * distortion-free edge rerouting, and manual edge selection/curve adjustments in Mermaid diagrams.
 */

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
  while ((match = cmdRegex.exec(d)) !== null) {
    const type = match[1];
    const rawArgs = match[2].trim();
    const args = rawArgs
      ? (rawArgs.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number) || [])
      : [];
    commands.push({ type, args });
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
  const tm = transformStr.match(/translate\(\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)\s*\)/);
  if (tm) {
    return { x: parseFloat(tm[1]), y: parseFloat(tm[2]) };
  }
  const mm = transformStr.match(
    /matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)\s*\)/
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
 */
export function getNodeGeometry(node: SVGGElement): NodeGeometry {
  const stateId = node.getAttribute('data-state-id') || '';
  const origTf = node.getAttribute('data-orig-transform') || node.getAttribute('transform') || '';
  const { x: tx, y: ty } = parseTranslation(origTf);

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
    }
  }

  const origCenterX = tx + localCx;
  const origCenterY = ty + localCy;
  const halfWidth = Math.max(16, w / 2);
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
 * Initializes SVG metadata for draggable state nodes, interactive edge paths, and edge hitboxes.
 * Should be called once whenever a new SVG is rendered.
 */
export function initializeSvgDragMetadata(svg: SVGSVGElement): void {
  // 1. Gather all state nodes with initial transforms and geometry
  const nodes = Array.from(svg.querySelectorAll('g.node')) as SVGGElement[];
  const nodeCenters: { id: string; x: number; y: number }[] = [];

  for (const node of nodes) {
    const stateId = node.getAttribute('data-state-id');
    if (!stateId) continue;

    if (!node.getAttribute('data-orig-transform')) {
      const origTf = node.getAttribute('transform') || '';
      node.setAttribute('data-orig-transform', origTf);
      const { x, y } = parseTranslation(origTf);
      node.setAttribute('data-orig-x', String(x));
      node.setAttribute('data-orig-y', String(y));
    }

    const geom = getNodeGeometry(node);
    node.setAttribute('data-orig-cx', geom.origCenterX.toFixed(1));
    node.setAttribute('data-orig-cy', geom.origCenterY.toFixed(1));
    node.setAttribute('data-hw', geom.halfWidth.toFixed(1));
    node.setAttribute('data-hh', geom.halfHeight.toFixed(1));

    nodeCenters.push({ id: stateId, x: geom.origCenterX, y: geom.origCenterY });
  }

  // 2. Map all edge paths to their source and target nodes, and setup interactive hitboxes
  const allPaths = (Array.from(svg.querySelectorAll('g.edgePaths path')).filter(
    (p) => !p.closest('defs') && !p.closest('marker') && p.getAttribute('d')
  ) as SVGPathElement[]);

  for (let idx = 0; idx < allPaths.length; idx++) {
    const path = allPaths[idx];
    const pathId = path.getAttribute('id') || path.getAttribute('data-id') || `path-${idx}`;
    if (!path.getAttribute('data-path-id')) {
      path.setAttribute('data-path-id', pathId);
    }
    path.setAttribute('data-edge-id', pathId);
    path.classList.add('tc-edge-path');

    if (!path.getAttribute('data-orig-d')) {
      const d = path.getAttribute('d') || '';
      path.setAttribute('data-orig-d', d);
    }

    // Try finding source and target from classes or id
    const parent = path.parentElement;
    const classStr = `${path.getAttribute('class') || ''} ${parent?.getAttribute('class') || ''}`;
    const idStr = `${path.getAttribute('id') || ''} ${parent?.getAttribute('id') || ''}`;

    let sourceId: string | null = null;
    let targetId: string | null = null;

    const lsMatch = classStr.match(/\bLS-([A-Za-z0-9_]+)\b/);
    if (lsMatch) sourceId = lsMatch[1];
    const leMatch = classStr.match(/\bLE-([A-Za-z0-9_]+)\b/);
    if (leMatch) targetId = leMatch[1];

    if (!sourceId || !targetId) {
      const lMatch = idStr.match(/\bL-([A-Za-z0-9_]+)-([A-Za-z0-9_]+)/);
      if (lMatch) {
        if (!sourceId) sourceId = lMatch[1];
        if (!targetId) targetId = lMatch[2];
      }
    }

    // Proximity fallback using first and last coordinate
    const origD = path.getAttribute('data-orig-d') || '';
    const points = extractCoordinatePoints(parseSvgPathCommands(origD));
    if (points.length > 0 && nodeCenters.length > 0) {
      if (!sourceId) {
        const pStart = points[0];
        let bestDist = Infinity;
        let bestNodeId: string | null = null;
        for (const nc of nodeCenters) {
          const d = Math.hypot(nc.x - pStart.x, nc.y - pStart.y);
          if (d < bestDist) {
            bestDist = d;
            bestNodeId = nc.id;
          }
        }
        if (bestNodeId) sourceId = bestNodeId;
      }

      if (!targetId) {
        const pEnd = points[points.length - 1];
        let bestDist = Infinity;
        let bestNodeId: string | null = null;
        for (const nc of nodeCenters) {
          const d = Math.hypot(nc.x - pEnd.x, nc.y - pEnd.y);
          if (d < bestDist) {
            bestDist = d;
            bestNodeId = nc.id;
          }
        }
        if (bestNodeId) targetId = bestNodeId;
      }
    }

    if (sourceId) path.setAttribute('data-source-id', sourceId);
    if (targetId) path.setAttribute('data-target-id', targetId);

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

    // Add transparent wider hitbox alongside path if not already added
    if (parent && !parent.querySelector(`.tc-edge-hitbox[data-edge-id="${pathId}"]`)) {
      const hitbox = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hitbox.setAttribute('class', 'tc-edge-hitbox');
      hitbox.setAttribute('data-edge-id', pathId);
      hitbox.setAttribute('d', path.getAttribute('d') || '');
      hitbox.setAttribute('fill', 'none');
      hitbox.setAttribute('stroke', 'transparent');
      hitbox.setAttribute('stroke-width', '22');
      hitbox.setAttribute('cursor', 'pointer');
      parent.insertBefore(hitbox, path);
    }
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
 * Calculate rerouted curve for an edge between two nodes, preventing distortion.
 */
export function calculateReroutedEdgePath(
  path: SVGPathElement,
  svg: SVGSVGElement,
  nodeOffsets: NodeOffsetsMap,
  edgeOffsets: EdgeOffsetsMap
): { d: string; midPoint: Point; startPoint: Point } {
  const origD = path.getAttribute('data-orig-d') || '';
  const edgeId = path.getAttribute('data-edge-id') || path.getAttribute('data-path-id') || '';
  const srcId = path.getAttribute('data-source-id');
  const tgtId = path.getAttribute('data-target-id');

  const srcOffset = (srcId && nodeOffsets[srcId]) || { x: 0, y: 0 };
  const tgtOffset = (tgtId && nodeOffsets[tgtId]) || { x: 0, y: 0 };
  const edgeOffset = (edgeId && edgeOffsets[edgeId]) || { x: 0, y: 0 };

  const hasNodeMovement = srcOffset.x !== 0 || srcOffset.y !== 0 || tgtOffset.x !== 0 || tgtOffset.y !== 0;
  const hasEdgeMovement = edgeOffset.x !== 0 || edgeOffset.y !== 0;

  // If no node moved and edge wasn't dragged, return original path
  if (!hasNodeMovement && !hasEdgeMovement) {
    const origPoints = extractCoordinatePoints(parseSvgPathCommands(origD));
    const startPoint = origPoints[0] || { x: 0, y: 0 };
    const midPoint = origPoints[Math.floor(origPoints.length / 2)] || startPoint;
    return { d: origD, midPoint, startPoint };
  }

  // Self-loop (srcId === tgtId): Rigidly translate loop to maintain pristine circular/oval shape
  if (srcId && tgtId && srcId === tgtId) {
    const totalDx = srcOffset.x + edgeOffset.x;
    const totalDy = srcOffset.y + edgeOffset.y;
    const newD = translateSvgPath(origD, totalDx, totalDy);
    const origPoints = extractCoordinatePoints(parseSvgPathCommands(newD));
    const startPoint = origPoints[0] || { x: 0, y: 0 };
    const midPoint = origPoints[Math.floor(origPoints.length / 2)] || startPoint;
    return { d: newD, midPoint, startPoint };
  }

  // Distinct nodes: compute clean boundary-to-boundary Bézier routing
  const srcNodeEl = srcId ? (svg.querySelector(`g.node[data-state-id="${srcId}"]`) as SVGGElement | null) : null;
  const tgtNodeEl = tgtId ? (svg.querySelector(`g.node[data-state-id="${tgtId}"]`) as SVGGElement | null) : null;

  if (srcNodeEl && tgtNodeEl) {
    const sOrigCx = parseFloat(srcNodeEl.getAttribute('data-orig-cx') || '0');
    const sOrigCy = parseFloat(srcNodeEl.getAttribute('data-orig-cy') || '0');
    const sHw = parseFloat(srcNodeEl.getAttribute('data-hw') || '60');
    const sHh = parseFloat(srcNodeEl.getAttribute('data-hh') || '25');

    const tOrigCx = parseFloat(tgtNodeEl.getAttribute('data-orig-cx') || '0');
    const tOrigCy = parseFloat(tgtNodeEl.getAttribute('data-orig-cy') || '0');
    const tHw = parseFloat(tgtNodeEl.getAttribute('data-hw') || '60');
    const tHh = parseFloat(tgtNodeEl.getAttribute('data-hh') || '25');

    const sCx = sOrigCx + srcOffset.x;
    const sCy = sOrigCy + srcOffset.y;
    const tCx = tOrigCx + tgtOffset.x;
    const tCy = tOrigCy + tgtOffset.y;

    // Center-to-center baseline midpoint
    const baseMidX = (sCx + tCx) / 2;
    const baseMidY = (sCy + tCy) / 2;

    // Estimated intermediate midpoint accounting for user drag
    const midTargetX = baseMidX + edgeOffset.x;
    const midTargetY = baseMidY + edgeOffset.y;

    // Calculate boundary exit point on source node towards intermediate target
    const startBound = computeBoxBoundaryIntersection(sCx, sCy, sHw, sHh, midTargetX, midTargetY, 2);
    // Calculate boundary entry point on target node from intermediate target
    const endBound = computeBoxBoundaryIntersection(tCx, tCy, tHw, tHh, midTargetX, midTargetY, 3);

    const startX = startBound.x;
    const startY = startBound.y;
    const endX = endBound.x;
    const endY = endBound.y;

    const vX = endX - startX;
    const vY = endY - startY;
    const dist = Math.hypot(vX, vY);

    const lineMidX = (startX + endX) / 2;
    const lineMidY = (startY + endY) / 2;

    const baseCurvature = parseFloat(path.getAttribute('data-base-curvature') || '0');

    // Unit normal vector perpendicular to chord
    const normX = dist > 1 ? -vY / dist : 0;
    const normY = dist > 1 ? vX / dist : 1;

    // Determine actual target midpoint: chord midpoint + normal * baseline + user drag offset
    const actualMidX = lineMidX + normX * baseCurvature * 0.4 + edgeOffset.x;
    const actualMidY = lineMidY + normY * baseCurvature * 0.4 + edgeOffset.y;

    let newD: string;

    if (hasEdgeMovement || Math.abs(baseCurvature) > 10) {
      // Quadratic curve passing cleanly through actualMid
      const cpX = 2 * actualMidX - 0.5 * (startX + endX);
      const cpY = 2 * actualMidY - 0.5 * (startY + endY);
      newD = `M${startX.toFixed(1)},${startY.toFixed(1)}Q${cpX.toFixed(1)},${cpY.toFixed(1)} ${endX.toFixed(1)},${endY.toFixed(1)}`;
    } else {
      // Smooth cubic Bézier respecting exit and entry surface normals for clean, undistorted layout
      const bendDist = Math.min(Math.max(dist * 0.38, 20), 85);
      const cp1X = startX + startBound.normalX * bendDist;
      const cp1Y = startY + startBound.normalY * bendDist;
      const cp2X = endX + endBound.normalX * bendDist;
      const cp2Y = endY + endBound.normalY * bendDist;
      newD = `M${startX.toFixed(1)},${startY.toFixed(1)}C${cp1X.toFixed(1)},${cp1Y.toFixed(1)} ${cp2X.toFixed(1)},${cp2Y.toFixed(1)} ${endX.toFixed(1)},${endY.toFixed(1)}`;
    }

    return {
      d: newD,
      midPoint: { x: actualMidX, y: actualMidY },
      startPoint: { x: startX, y: startY },
    };
  }

  // Fallback if node elements could not be resolved: translate using available offsets
  const avgDx = (srcOffset.x + tgtOffset.x) / 2 + edgeOffset.x;
  const avgDy = (srcOffset.y + tgtOffset.y) / 2 + edgeOffset.y;
  const newD = translateSvgPath(origD, avgDx, avgDy);
  const origPoints = extractCoordinatePoints(parseSvgPathCommands(newD));
  const startPoint = origPoints[0] || { x: 0, y: 0 };
  const midPoint = origPoints[Math.floor(origPoints.length / 2)] || startPoint;
  return { d: newD, midPoint, startPoint };
}

/**
 * Apply both node offsets and edge offsets to the SVG diagram in real-time.
 */
export function applyDiagramOffsetsToSvg(
  svg: SVGSVGElement,
  nodeOffsets: NodeOffsetsMap,
  edgeOffsets: EdgeOffsetsMap,
  targetEdgeId?: string | null,
  selectedEdgeId?: string | null
): void {
  // 1. Update node transforms
  const nodesToUpdate = Array.from(svg.querySelectorAll('g.node[data-state-id]')) as SVGGElement[];
  for (const node of nodesToUpdate) {
    const stateId = node.getAttribute('data-state-id');
    if (!stateId) continue;
    const offset = nodeOffsets[stateId] || { x: 0, y: 0 };
    const origX = parseFloat(node.getAttribute('data-orig-x') || '0');
    const origY = parseFloat(node.getAttribute('data-orig-y') || '0');
    node.setAttribute('transform', `translate(${origX + offset.x}, ${origY + offset.y})`);
  }

  // 2. Update edge paths, hitboxes, labels, and handles
  const allPaths = Array.from(
    svg.querySelectorAll('g.edgePaths path[data-orig-d]')
  ) as SVGPathElement[];

  // Ensure waypoint handle group exists
  let handlesGroup = svg.querySelector('g.tc-edge-handles') as SVGGElement | null;
  if (!handlesGroup) {
    handlesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    handlesGroup.setAttribute('class', 'tc-edge-handles');
    svg.appendChild(handlesGroup);
  }

  for (const path of allPaths) {
    const edgeId = path.getAttribute('data-edge-id') || path.getAttribute('data-path-id') || '';
    if (targetEdgeId && edgeId !== targetEdgeId && !selectedEdgeId) {
      // If updating a specific edge only
      // continue;
    }

    const { d: newD, midPoint, startPoint } = calculateReroutedEdgePath(
      path,
      svg,
      nodeOffsets,
      edgeOffsets
    );

    // Update path `d`
    path.setAttribute('d', newD);

    // Update hitbox `d`
    const parent = path.parentElement;
    const hitbox = parent?.querySelector(`.tc-edge-hitbox[data-edge-id="${edgeId}"]`);
    if (hitbox) {
      hitbox.setAttribute('d', newD);
    }

    // Update edge label position to follow rerouted midpoint
    if (edgeId) {
      const labels = Array.from(
        svg.querySelectorAll(`g.edgeLabel[data-linked-path-id="${edgeId}"]`)
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
        svg.querySelectorAll(`.tc-priority-badge[data-path-id="${edgeId}"]`)
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

    // Highlight selected edge and update/show its draggable waypoint handle
    const isSelected = selectedEdgeId && edgeId === selectedEdgeId;
    if (isSelected) {
      path.classList.add('selected-edge');
      hitbox?.classList.add('selected-edge');

      // Update or create waypoint handle
      let handle = handlesGroup.querySelector(`.tc-edge-handle[data-edge-id="${edgeId}"]`) as SVGGElement | null;
      if (!handle) {
        handle = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        handle.setAttribute('class', 'tc-edge-handle');
        handle.setAttribute('data-edge-id', edgeId);

        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        halo.setAttribute('class', 'handle-halo');
        halo.setAttribute('r', '13');
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

        handle.appendChild(halo);
        handle.appendChild(core);
        handlesGroup.appendChild(handle);
      }
      handle.setAttribute('transform', `translate(${midPoint.x.toFixed(1)}, ${midPoint.y.toFixed(1)})`);
    } else {
      path.classList.remove('selected-edge');
      hitbox?.classList.remove('selected-edge');
    }
  }

  // Remove handles for edges that are no longer selected
  if (handlesGroup) {
    const existingHandles = Array.from(handlesGroup.querySelectorAll('.tc-edge-handle'));
    for (const h of existingHandles) {
      const hEdgeId = h.getAttribute('data-edge-id');
      if (hEdgeId !== selectedEdgeId) {
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
