"use client";

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

const DEFAULT_CONTENT = `# Welcome to Pulse Markdown

A fast, clean markdown editor with **live preview**.

## Features

- **Real-time preview** as you type
- GitHub Flavored Markdown (tables, checklists, strikethrough)
- Clean, distraction-free interface

## Try it out

Edit the left pane and watch the preview update instantly.

### Code blocks

\`\`\`javascript
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

### Tables

| Feature | Status |
|---------|--------|
| Live preview | Done |
| GFM support | Done |
| Dark mode | Done |
| Export | Coming soon |

### Task list

- [x] Build the editor
- [x] Add live preview
- [ ] Share with the world

> Built with care by **Pulse Pro**
`;

export default function Editor() {
  const [content, setContent] = useState(DEFAULT_CONTENT);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const handleClear = useCallback(() => {
    setContent("");
  }, []);

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-white text-sm" style={{ background: "var(--accent)" }}>
            P
          </div>
          <span className="font-semibold text-sm tracking-tight">Pulse Markdown</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs mr-2" style={{ color: "var(--text-secondary)" }}>
            {wordCount} words / {charCount} chars
          </span>
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            {copied ? "Copied!" : "Copy MD"}
          </button>
          <button
            onClick={handleClear}
            className="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            Clear
          </button>
        </div>
      </header>

      {/* Split pane */}
      <div className="flex flex-1 min-h-0">
        {/* Editor */}
        <div className="flex-1 flex flex-col border-r" style={{ borderColor: "var(--border)" }}>
          <div className="px-4 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-secondary)", background: "var(--bg-secondary)" }}>
            Markdown
          </div>
          <textarea
            className="editor-textarea flex-1 w-full p-4"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Start writing markdown..."
            spellCheck={false}
          />
        </div>

        {/* Preview */}
        <div className="flex-1 flex flex-col">
          <div className="px-4 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-secondary)", background: "var(--bg-secondary)" }}>
            Preview
          </div>
          <div className="flex-1 overflow-auto p-6">
            <div className="preview-content max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                {content}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
