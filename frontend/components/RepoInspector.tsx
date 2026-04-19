"use client";
import { useState } from "react";
import { getRepoTree, getFileContent } from "@/lib/api";

type TreeItem = { path: string; type: string; size?: number };

type Props = {
  onSelectDockerfile: (path: string, repoUrl: string) => void;
};

function buildTree(items: TreeItem[]) {
  const tree: Record<string, any> = {};
  for (const item of items) {
    const parts = item.path.split("/");
    let node = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!node[part]) {
        node[part] = i === parts.length - 1
          ? { __file: true, __path: item.path, __size: item.size }
          : {};
      }
      node = node[part];
    }
  }
  return tree;
}

function isDockerfile(name: string) {
  return name === "Dockerfile" || name.startsWith("Dockerfile.");
}

function TreeNode({
  name,
  node,
  depth = 0,
  onSelect,
  onPreview,
}: {
  name: string;
  node: any;
  depth?: number;
  onSelect: (path: string) => void;
  onPreview: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isFile = node.__file;
  const isDocker = isFile && isDockerfile(name);

  if (isFile) {
    return (
      <div
        className={`flex items-center justify-between gap-2 py-1 px-2 rounded text-sm group ${
          isDocker ? "bg-orange-500/10 border border-orange-500/20" : "hover:bg-zinc-800/50"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs shrink-0">{isDocker ? "🐳" : "📄"}</span>
          <span className={`truncate ${isDocker ? "text-orange-400 font-medium" : "text-zinc-300"}`}>
            {name}
          </span>
          {isDocker && (
            <span className="text-xs bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded shrink-0">
              Dockerfile
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 shrink-0">
          <button
            onClick={() => onPreview(node.__path)}
            className="text-xs text-zinc-400 hover:text-zinc-100 px-2 py-0.5 rounded border border-zinc-700 hover:border-zinc-500"
          >
            View
          </button>
          {isDocker && (
            <button
              onClick={() => onSelect(node.__path)}
              className="text-xs text-white bg-orange-500 hover:bg-orange-600 px-2 py-0.5 rounded"
            >
              Use
            </button>
          )}
        </div>
      </div>
    );
  }

  const children = Object.entries(node).filter(([k]) => !k.startsWith("__"));

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 py-1 px-2 w-full text-left hover:bg-zinc-800/50 rounded text-sm"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <span className="text-xs shrink-0">{open ? "📂" : "📁"}</span>
        <span className="text-zinc-200 font-medium">{name}</span>
      </button>
      {open && (
        <div>
          {children
            .sort(([, a], [, b]) => {
              const aIsFile = (a as any).__file;
              const bIsFile = (b as any).__file;
              if (aIsFile && !bIsFile) return 1;
              if (!aIsFile && bIsFile) return -1;
              return 0;
            })
            .map(([childName, childNode]) => (
              <TreeNode
                key={childName}
                name={childName}
                node={childNode}
                depth={depth + 1}
                onSelect={onSelect}
                onPreview={onPreview}
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
    const repoUrl = `https://github.com/${repoName}`;
    onSelectDockerfile(dockerfilePath, repoUrl);
  }

  const dockerfiles = tree?.filter((i) => i.type === "blob" && isDockerfile(i.path.split("/").pop()!)) ?? [];
  const builtTree = tree ? buildTree(tree) : null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={repoInput}
          onChange={(e) => setRepoInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLoad()}
          placeholder="https://github.com/username/repo or username/repo"
          className="flex-1 border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
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
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted px-4 py-2 border-b flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{repoName}</span>
              <span className="text-xs text-muted-foreground">{tree?.length} files</span>
            </div>
            <div className="overflow-y-auto max-h-96 py-2">
              {Object.entries(builtTree)
                .sort(([, a], [, b]) => {
                  const aIsFile = (a as any).__file;
                  const bIsFile = (b as any).__file;
                  if (aIsFile && !bIsFile) return 1;
                  if (!aIsFile && bIsFile) return -1;
                  return 0;
                })
                .map(([name, node]) => (
                  <TreeNode
                    key={name}
                    name={name}
                    node={node}
                    depth={0}
                    onSelect={handleSelect}
                    onPreview={handlePreview}
                  />
                ))}
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted px-4 py-2 border-b">
              <span className="text-xs font-medium text-muted-foreground">
                {preview ? preview.path : "Select a file to preview"}
              </span>
            </div>
            <div className="overflow-y-auto max-h-96">
              {previewLoading ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                  Loading...
                </div>
              ) : preview ? (
                <pre className="p-4 text-xs text-foreground whitespace-pre-wrap break-words font-mono">
                  {preview.content}
                </pre>
              ) : (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                  Click "View" on any file
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
