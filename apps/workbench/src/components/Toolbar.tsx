import type { RefObject } from "react";
import { IconImport, IconPanel, IconSearch } from "./Icons";

interface ToolbarProps {
  title: string;
  total: number;
  search: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onSearch: (value: string) => void;
  onImport: () => void;
  importing: boolean;
  detailOpen: boolean;
  onToggleDetail: () => void;
  disabled: boolean;
}

export function Toolbar({
  title,
  total,
  search,
  searchRef,
  onSearch,
  onImport,
  importing,
  detailOpen,
  onToggleDetail,
  disabled,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar-location">
        <span className="toolbar-title">{title}</span>
        <span className="toolbar-total">{total} 项</span>
      </div>

      <div className="search">
        <IconSearch className="search-icon" />
        <input
          ref={searchRef}
          value={search}
          placeholder="搜索文件名、标签、路径"
          spellCheck={false}
          onChange={(event) => onSearch(event.target.value)}
        />
        {search && (
          <button type="button" className="search-clear" onClick={() => onSearch("")} aria-label="清除搜索">
            ×
          </button>
        )}
        <kbd>Ctrl F</kbd>
      </div>

      <div className="toolbar-actions">
        <button type="button" className="btn btn-primary" onClick={onImport} disabled={disabled || importing}>
          <IconImport />
          {importing ? "正在导入…" : "导入资料"}
        </button>
        <button
          type="button"
          className={`icon-btn${detailOpen ? " is-on" : ""}`}
          onClick={onToggleDetail}
          title={detailOpen ? "收起详情栏" : "展开详情栏"}
          aria-label="切换详情栏"
        >
          <IconPanel />
        </button>
      </div>
    </header>
  );
}
