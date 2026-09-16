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
          setSvgContent(svg);
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
