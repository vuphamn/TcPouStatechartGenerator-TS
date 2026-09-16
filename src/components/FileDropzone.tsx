import React, { useRef } from 'react';
import { Upload, FileCode } from 'lucide-react';

interface FileDropzoneProps {
  label: string;
  fileExtension: string;
  fileName: string | null;
  content: string;
  onFileLoaded: (name: string, content: string) => void;
  onContentChanged: (content: string) => void;
  idPrefix: string;
}

export const FileDropzone: React.FC<FileDropzoneProps> = ({
  label,
  fileExtension,
  fileName,
  content,
  onFileLoaded,
  onContentChanged,
  idPrefix,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result as string) || '';
      onFileLoaded(file.name, text);
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(fileExtension.toLowerCase())) {
      // allow anyway or alert
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result as string) || '';
      onFileLoaded(file.name, text);
    };
    reader.readAsText(file);
  };

  return (
    <div
      id={`${idPrefix}-container`}
      className="flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden p-3 transition-colors hover:border-slate-700"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <FileCode className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-semibold text-slate-200">{label}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-sky-400 font-mono">
            {fileExtension}
          </span>
        </div>
        <button
          id={`${idPrefix}-choose-file-btn`}
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="text-[11px] text-sky-400 hover:text-sky-300 font-medium hover:underline flex items-center gap-1"
        >
          <Upload className="w-3 h-3" />
          Browse
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={fileExtension}
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      <div
        id={`${idPrefix}-dropzone`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="flex-1 flex flex-col min-h-[140px] bg-slate-950/60 rounded-lg border border-dashed border-slate-800 hover:border-sky-500/50 transition-colors p-2 text-xs"
      >
        {content ? (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between pb-1 border-b border-slate-800 text-[11px] text-slate-400 mb-1">
              <span className="font-mono text-slate-300 truncate max-w-[180px]">
                {fileName || `Custom ${fileExtension}`}
              </span>
              <span>{content.split('\n').length} lines</span>
            </div>
            <textarea
              id={`${idPrefix}-editor`}
              value={content}
              onChange={(e) => onContentChanged(e.target.value)}
              placeholder={`Paste or edit ${fileExtension} content here...`}
              className="flex-1 w-full bg-transparent text-slate-300 font-mono text-[11px] resize-none focus:outline-none focus:ring-0 leading-relaxed custom-scrollbar"
              spellCheck={false}
            />
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center flex-1 cursor-pointer text-slate-500 hover:text-slate-400 transition-colors"
          >
            <Upload className="w-6 h-6 mb-1 text-slate-600" />
            <p className="text-xs font-medium">Drop {fileExtension} file here</p>
            <p className="text-[10px] text-slate-600 mt-0.5">or click to browse from computer</p>
          </div>
        )}
      </div>
    </div>
  );
};
