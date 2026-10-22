import { useState } from "react";
import type { Facets, NavView } from "../types";
import {
  IconClock,
  IconCollection,
  IconFolderOpen,
  IconInbox,
  IconSource,
  IconStar,
  IconTag,
  IconTrash,
} from "./Icons";

interface SidebarProps {
  view: NavView;
  facets: Facets | undefined;
  libraryPath: string | null;
  onSelect: (view: NavView) => void;
  onCreateCollection: (name: string) => void;
}

function NavRow({
  active,
  icon,
  label,
  count,
  indent,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  indent?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`nav-row${active ? " is-active" : ""}${indent ? " is-indented" : ""}`} onClick={onClick}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      {count !== undefined && count > 0 && <span className="nav-count">{count}</span>}
    </button>
  );
}

export function Sidebar({ view, facets, libraryPath, onSelect, onCreateCollection }: SidebarProps) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");

  const submit = () => {
    const name = draft.trim();
    if (name) onCreateCollection(name);
    setDraft("");
    setCreating(false);
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden />
        <div>
          <p className="brand-name">RHINE LAB</p>
          <p className="brand-sub">资料工作台</p>
        </div>
      </div>

      <nav className="nav-scroll">
        <div className="nav-group">
          <p className="nav-group-title">资料库</p>
          <NavRow
            active={view.kind === "all"}
            icon={<IconCollection />}
            label="全部资源"
            count={facets?.all}
            onClick={() => onSelect({ kind: "all" })}
          />
          <NavRow
            active={view.kind === "inbox"}
            icon={<IconInbox />}
            label="收件箱"
            count={facets?.inbox}
            onClick={() => onSelect({ kind: "inbox" })}
          />
          <NavRow
            active={view.kind === "recent"}
            icon={<IconClock />}
            label="最近阅读"
            count={facets?.recent}
            onClick={() => onSelect({ kind: "recent" })}
          />
          <NavRow
            active={view.kind === "favorite"}
            icon={<IconStar />}
            label="收藏"
            count={facets?.favorite}
            onClick={() => onSelect({ kind: "favorite" })}
          />
        </div>

        <div className="nav-group">
          <p className="nav-group-title">
            集合
            <button type="button" className="nav-add" onClick={() => setCreating(true)} aria-label="新建集合">
              +
            </button>
          </p>
          {facets?.collections.map((item) => (
            <NavRow
              key={item.id}
              indent
              active={view.kind === "collection" && view.id === item.id}
              icon={<IconFolderOpen size={14} />}
              label={item.name}
              count={item.n}
              onClick={() => onSelect({ kind: "collection", id: item.id })}
            />
          ))}
          {creating && (
            <input
              className="nav-input"
              autoFocus
              value={draft}
              placeholder="集合名称"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={submit}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
                if (event.key === "Escape") {
                  setDraft("");
                  setCreating(false);
                }
              }}
            />
          )}
          {!creating && !facets?.collections.length && <p className="nav-empty">还没有集合</p>}
        </div>

        {!!facets?.tags.length && (
          <div className="nav-group">
            <p className="nav-group-title">标签</p>
            {facets.tags.slice(0, 12).map((item) => (
              <NavRow
                key={item.id}
                indent
                active={view.kind === "tag" && view.id === item.id}
                icon={<IconTag size={14} />}
                label={item.name}
                count={item.n}
                onClick={() => onSelect({ kind: "tag", id: item.id })}
              />
            ))}
          </div>
        )}

        {!!facets?.sources.length && (
          <div className="nav-group">
            <p className="nav-group-title">来源</p>
            {facets.sources.map((item) => (
              <NavRow
                key={item.id}
                indent
                active={view.kind === "source" && view.id === item.id}
                icon={<IconSource size={14} />}
                label={item.label}
                count={item.n}
                onClick={() => onSelect({ kind: "source", id: item.id })}
              />
            ))}
          </div>
        )}
      </nav>

      <div className="nav-footer">
        <NavRow
          active={view.kind === "trash"}
          icon={<IconTrash />}
          label="回收站"
          count={facets?.trash}
          onClick={() => onSelect({ kind: "trash" })}
        />
        <p className="library-path" title={libraryPath ?? undefined}>
          {libraryPath ?? "资料库未连接"}
        </p>
      </div>
    </aside>
  );
}
