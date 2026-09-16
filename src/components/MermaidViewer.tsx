import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { ZoomIn, ZoomOut, RotateCcw, Maximize2, Minimize2, AlertCircle, Copy, Check } from 'lucide-react';

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  flowchart: {
    useMaxWidth: false,
    htmlLabels: true,
    curve: 'basis',
  },
  state: {
    useMaxWidth: false,
  },
});

interface MermaidViewerProps {
  code: string;
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
  const textNodes = labelEl.querySelectorAll('tspan, text, span, p, div');
  if (textNodes.length > 0) {
    textNodes.forEach((node) => {
      if (node.textContent && node.textContent.includes(symbol)) {
        node.textContent = node.textContent.replace(symbol, '').trim();
      }
    });
  } else if (labelEl.textContent && labelEl.textContent.includes(symbol)) {
    labelEl.textContent = labelEl.textContent.replace(symbol, '').trim();
  }
}

function enhanceSvgWithPriorityCircles(svgString: string): string {
  if (typeof window === 'undefined' || !svgString) return svgString;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgEl = doc.documentElement;
    if (!svgEl || svgEl.nodeName.toLowerCase() === 'parsererror') return svgString;

    const edgeLabels = Array.from(doc.querySelectorAll('.edgeLabel, .edgeLabels .edgeLabel'));
    if (edgeLabels.length === 0) return svgString;

    const allPaths = Array.from(
      doc.querySelectorAll('.edgePath path, .edgePaths path, path.transition, path.path')
    ).filter((p) => !p.closest('defs') && !p.closest('marker') && p.getAttribute('d'));

    const parsedPaths: ParsedPath[] = [];
    for (const p of allPaths) {
      const parsed = parsePathData(p);
      if (parsed) parsedPaths.push(parsed);
    }

    if (parsedPaths.length === 0) return svgString;

    const usedPaths = new Set<ParsedPath>();
    const badgesToDraw: { cx: number; cy: number; priority: number }[] = [];

    for (const labelEl of edgeLabels) {
      const text = labelEl.textContent || '';
      const prioInfo = extractPriorityFromText(text);
      if (!prioInfo) continue;

      const labelPos = getLabelPos(labelEl);

      // Try matching by class/id tokens first (e.g. LS-X LE-Y)
      let matchedPath: ParsedPath | null = null;
      const labelClass = labelEl.getAttribute('class') || '';
      const classTokens = labelClass.match(/L[SE]-[A-Za-z0-9_]+/g);

      if (classTokens && classTokens.length > 0) {
        for (const pp of parsedPaths) {
          if (usedPaths.has(pp)) continue;
          if (classTokens.every((tok) => pp.classes.includes(tok) || pp.id.includes(tok))) {
            matchedPath = pp;
            break;
          }
        }
      }

      // Fallback: match by geometric distance
      if (!matchedPath && labelPos) {
        let bestDist = Infinity;
        for (const pp of parsedPaths) {
          if (usedPaths.has(pp)) continue;
          const dist = minDistanceToPath(labelPos, pp.allPoints);
          if (dist < bestDist) {
            bestDist = dist;
            matchedPath = pp;
          }
        }
      }

      if (matchedPath) {
        usedPaths.add(matchedPath);
        // Position circle badge 10px from edge start endpoint along direction
        const offset = 10;
        const cx = matchedPath.startX + matchedPath.dirX * offset;
        const cy = matchedPath.startY + matchedPath.dirY * offset;
        badgesToDraw.push({ cx, cy, priority: prioInfo.priority });

        // Clean symbol from label in diagram view
        cleanSymbolFromLabel(labelEl, prioInfo.symbol);
      }
    }

    if (badgesToDraw.length === 0) return svgString;

    // Create or get priority circles layer
    let layer: Element | null = doc.getElementById('priority-circles-layer');
    if (!layer) {
      const gLayer = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
      gLayer.setAttribute('id', 'priority-circles-layer');
      gLayer.setAttribute('class', 'priority-layer');
      svgEl.appendChild(gLayer);
      layer = gLayer;
    }

    for (const badge of badgesToDraw) {
      const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'priority-badge');

      // Outer circle: TwinCAT XAE styling (crisp white circle, 1.5px dark border)
      const circle = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', badge.cx.toFixed(1));
      circle.setAttribute('cy', badge.cy.toFixed(1));
      circle.setAttribute('r', '9');
      circle.setAttribute('fill', '#ffffff');
      circle.setAttribute('stroke', '#0f172a');
      circle.setAttribute('stroke-width', '1.5');
      circle.setAttribute('filter', 'drop-shadow(0px 1px 2px rgba(0,0,0,0.35))');

      // Centered priority number
      const text = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', badge.cx.toFixed(1));
      text.setAttribute('y', badge.cy.toFixed(1));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('font-family', 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif');
      text.setAttribute('font-size', badge.priority >= 10 ? '9.5' : '11');
      text.setAttribute('font-weight', '700');
      text.setAttribute('fill', '#0f172a');
      text.textContent = String(badge.priority);

      g.appendChild(circle);
      g.appendChild(text);
      layer.appendChild(g);
    }

    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
  } catch (err) {
    console.warn('Failed to enhance SVG with priority circles:', err);
    return svgString;
  }
}

export const MermaidViewer: React.FC<MermaidViewerProps> = ({ code }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [copiedSvg, setCopiedSvg] = useState<boolean>(false);

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
        const uniqueId = `mermaid-render-${Math.random().toString(36).substring(2, 9)}`;
        const { svg } = await mermaid.render(uniqueId, code);
        if (isMounted) {
          const enhancedSvg = enhanceSvgWithPriorityCircles(svg);
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
  }, [code]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

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
    if (!svgContent) return;
    navigator.clipboard.writeText(svgContent);
    setCopiedSvg(true);
    setTimeout(() => setCopiedSvg(false), 2000);
  };

  return (
    <div
      id="mermaid-viewer-container"
      className={`relative flex flex-col w-full h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none border-none' : ''
      }`}
    >
      {/* Viewer Header / Toolbar */}
      <div
        id="mermaid-toolbar"
        className="flex items-center justify-between px-4 py-2 bg-slate-950/80 border-b border-slate-800 backdrop-blur text-xs text-slate-300 z-10"
      >
        <div className="flex items-center gap-2 font-medium">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>Interactive Diagram View</span>
          <span className="text-slate-500 text-[11px]">(Drag to pan, scroll to zoom)</span>
        </div>

        <div className="flex items-center gap-1">
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
            title="Copy SVG"
          >
            {copiedSvg ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{copiedSvg ? 'Copied SVG' : 'Copy SVG'}</span>
          </button>
          <button
            id="fullscreen-toggle-button"
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
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
        className={`flex-1 relative overflow-hidden bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] cursor-grab ${
          isDragging ? 'cursor-grabbing' : ''
        }`}
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
              transition: isDragging ? 'none' : 'transform 0.05s ease-out',
            }}
            className="w-full h-full p-8 select-none flex items-center justify-center [&>svg]:max-w-none [&>svg]:max-h-none"
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            Diagram will appear here once generated
          </div>
        )}
      </div>
    </div>
  );
};
