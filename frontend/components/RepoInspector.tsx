"use client";
import { useState } from "react";
import { getRepoTree, getFileContent } from "@/lib/api";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

type TreeItem = { path: string; type: string; size?: number };

type Props = {
  onSelectDockerfile: (path: string, repoUrl: string) => void;
};

function getLanguage(path: string): string {
  const name = path.split("/").pop() || "";
  if (name === "Dockerfile" || name.startsWith("Dockerfile.")) return "docker";
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    md: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    xml: "xml",
    sql: "sql",
    env: "bash",
    gitignore: "bash",
  };
  return map[ext] || "text";
}

function isDockerfile(name: string) {
  return name === "Dockerfile" || name.startsWith("Dockerfile.");
}

function buildTree(items: TreeItem[]) {
  const tree: Record<string, any> = {};
  for (const item of items) {
    if (item.type === "tree") {
      const parts = item.path.split("/");
      let node = tree;
      for (const part of parts) {
        if (!node[part]) node[part] = {};
        node = node[part];
      }
    }
  }
  for (const item of items) {
    if (item.type === "blob") {
      const parts = item.path.split("/");
      let node = tree;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node[parts[i]]) node[parts[i]] = {};
        node = node[parts[i]];
      }
      const fileName = parts[parts.length - 1];
      node[fileName] = { __file: true, __path: item.path, __size: item.size };
    }
  }
  return tree;
}

function getFileIcon(name: string): string {
  if (isDockerfile(name)) return "🐳";
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const icons: Record<string, string> = {
    ts: "🔷",
    tsx: "🔷",
    js: "🟨",
    jsx: "🟨",
    py: "🐍",
    rs: "🦀",
    go: "🐹",
    java: "☕",
    json: "📋",
    yaml: "📋",
    yml: "📋",
    toml: "📋",
    md: "📝",
    css: "🎨",
    scss: "🎨",
    html: "🌐",
    sh: "⚙️",
    bash: "⚙️",
    env: "🔐",
    gitignore: "🚫",
    sql: "🗄️",
    lock: "🔒",
  };
  return icons[ext] || "📄";
}

function TreeNode({
  name,
  node,
  depth = 0,
  onSelect,
  onPreview,
  activeFile,
}: {
  name: string;
  node: any;
  depth?: number;
  onSelect: (path: string) => void;
  onPreview: (path: string) => void;
  activeFile: string | null;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isFile = node.__file;
  const isDocker = isFile && isDockerfile(name);
  const isActive = isFile && activeFile === node.__path;

  if (isFile) {
    return (
      <div
        onClick={() => onPreview(node.__path)}
        className={`flex items-center justify-between gap-2 py-1.5 px-2 rounded cursor-pointer text-sm group transition-colors ${
          isActive
            ? "bg-primary/10 border border-primary/20"
            : isDocker
              ? "bg-orange-500/10 border border-orange-500/20 hover:bg-orange-500/15"
              : "hover:bg-muted/60"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs shrink-0">{getFileIcon(name)}</span>
          <span
            className={`truncate text-xs ${
              isDocker
                ? "text-orange-400 font-medium"
                : isActive
                  ? "text-primary font-medium"
                  : "text-zinc-300"
            }`}
          >
            {name}
          </span>
          {isDocker && (
            <span className="text-xs bg-orange-500/20 text-orange-400 px-1 py-0.5 rounded shrink-0">
              dockerfile
            </span>
          )}
        </div>
        {isDocker && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(node.__path);
            }}
            className="text-xs text-white bg-orange-500 hover:bg-orange-600 px-2 py-0.5 rounded shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            Use
          </button>
        )}
      </div>
    );
  }

  const children = Object.entries(node).filter(([k]) => !k.startsWith("__"));

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 py-1.5 px-2 w-full text-left hover:bg-muted/60 rounded text-sm transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <span className="text-xs shrink-0">{open ? "📂" : "📁"}</span>
        <span className="text-zinc-200 font-medium text-xs">{name}</span>
      </button>
      {open && (
        <div>
          {children
            .sort(([nameA, a], [nameB, b]) => {
              const aIsFile = (a as any).__file;
              const bIsFile = (b as any).__file;
              if (aIsFile && !bIsFile) return 1;
              if (!aIsFile && bIsFile) return -1;
              return nameA.localeCompare(nameB);
            })
            .map(([childName, childNode]) => (
              <TreeNode
                key={childName}
                name={childName}
                node={childNode}
                depth={depth + 1}
                onSelect={onSelect}
                onPreview={onPreview}
                activeFile={activeFile}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export default function RepoInspector({ onSelectDockerfile }: Props) {
  const [repoInput, setRepoInput] = useState("");
  const [tree, setTree] = useState<TreeItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [repoName, setRepoName] = useState("");
  const [activeFile, setActiveFile] = useState<string | null>(null);

  function parseRepo(input: string): string | null {
    try {
      if (input.includes("github.com")) {
        const url = new URL(input.startsWith("http") ? input : `https://${input}`);
        const parts = url.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
        if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
      }
      if (input.match(/^[\w.-]+\/[\w.-]+$/)) return input;
    } catch {}
    return null;
  }

  async function handleLoad() {
    setError("");
    const repo = parseRepo(repoInput);
    if (!repo) {
      setError("Enter a valid GitHub URL or owner/repo format");
      return;
    }
    setLoading(true);
    setTree(null);
    setPreview(null);
    setActiveFile(null);
    setRepoName(repo);
    try {
      const data = await getRepoTree(repo);
      setTree(data.tree);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePreview(path: string) {
    setActiveFile(path);
    setPreviewLoading(true);
    try {
      const data = await getFileContent(repoName, path);
      setPreview(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPreviewLoading(false);
    }
  }

  function handleSelect(dockerfilePath: string) {
    onSelectDockerfile(dockerfilePath, `https://github.com/${repoName}`);
  }

  const dockerfiles =
    tree?.filter((i) => i.type === "blob" && isDockerfile(i.path.split("/").pop()!)) ?? [];

  const builtTree = tree ? buildTree(tree) : null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={repoInput}
          onChange={(e) => setRepoInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleLoad();
            }
          }}
          placeholder="https://github.com/username/repo or username/repo"
          className="flex-1 border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="button"
          onClick={handleLoad}
          disabled={loading}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50 shrink-0"
        >
          {loading ? "Loading..." : "Browse"}
        </button>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {dockerfiles.length > 0 && (
        <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-3">
          <p className="text-xs text-orange-400 font-medium mb-2">
            🐳 {dockerfiles.length} Dockerfile{dockerfiles.length > 1 ? "s" : ""} found
          </p>
          <div className="flex flex-wrap gap-2">
            {dockerfiles.map((d) => (
              <button
                type="button"
                key={d.path}
                onClick={() => handleSelect(d.path)}
                className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-md transition-colors"
              >
                Use {d.path}
              </button>
            ))}
          </div>
        </div>
      )}

      {builtTree && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border rounded-lg overflow-hidden bg-zinc-950">
            <div className="bg-zinc-900 px-4 py-2 border-b border-zinc-800 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">{repoName}</span>
              <span className="text-xs text-zinc-500">{tree?.length} files</span>
            </div>
            <div className="overflow-y-auto max-h-[500px] py-1">
              {Object.entries(builtTree)
                .sort(([nameA, a], [nameB, b]) => {
                  const aIsFile = (a as any).__file;
                  const bIsFile = (b as any).__file;
                  if (aIsFile && !bIsFile) return 1;
                  if (!aIsFile && bIsFile) return -1;
                  return nameA.localeCompare(nameB);
                })
                .map(([name, node]) => (
                  <TreeNode
                    key={name}
                    name={name}
                    node={node}
                    depth={0}
                    onSelect={handleSelect}
                    onPreview={handlePreview}
                    activeFile={activeFile}
                  />
                ))}
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden bg-zinc-950">
            <div className="bg-zinc-900 px-4 py-2 border-b border-zinc-800 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">
                {preview ? preview.path : "Click a file to preview"}
              </span>
              {preview && isDockerfile(preview.path.split("/").pop()!) && (
                <button
                  type="button"
                  onClick={() => handleSelect(preview.path)}
                  className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-2 py-1 rounded"
                >
                  Use this Dockerfile
                </button>
              )}
            </div>
            <div className="overflow-y-auto max-h-[500px]">
              {previewLoading ? (
                <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">
                  <div className="w-4 h-4 border border-zinc-500 border-t-transparent rounded-full animate-spin mr-2" />
                  Loading...
                </div>
              ) : preview ? (
                <SyntaxHighlighter
                  language={getLanguage(preview.path)}
                  style={vscDarkPlus}
                  customStyle={{
                    margin: 0,
                    borderRadius: 0,
                    fontSize: "12px",
                    background: "transparent",
                    minHeight: "100%",
                  }}
                  showLineNumbers
                  wrapLongLines
                >
                  {preview.content}
                </SyntaxHighlighter>
              ) : (
                <div className="flex flex-col items-center justify-center h-32 text-zinc-500 text-sm gap-1">
                  <span className="text-2xl">📄</span>
                  <span>Click any file to preview</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
