import { Clock, Heart, LayoutGrid, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LibraryView } from '../station/library.ts';
import { categoryIcon } from './labels.ts';

const NAV: readonly [LibraryView, string, LucideIcon][] = [
  ['library', 'Library', LayoutGrid], ['favorites', 'Favorites', Heart], ['recent', 'Recently played', Clock],
];

interface Props {
  view: LibraryView;
  category: string | null;
  categories: readonly string[];
  favoriteCount: number;
  onView(view: LibraryView): void;
  onCategory(category: string | null): void;
  /** Opens the staff-only panel; omitted when no agent is reachable. */
  onAdmin?: (() => void) | undefined;
  children: ReactNode;
}

export function Sidebar({ view, category, categories, favoriteCount, onView, onCategory, onAdmin, children }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand"><img src="./brand/gaming-house-logo.png" alt="Gaming House" draggable={false} /></div>
      <nav className="sidebar-scroll" aria-label="Library">
        <div className="nav">
          {NAV.map(([id, label, Icon]) => (
            <button key={id} className="nav-item" aria-current={view === id ? 'page' : undefined} onClick={() => onView(id)}>
              <Icon aria-hidden="true" /><span>{label}</span>
              {id === 'favorites' && favoriteCount > 0 && <span className="nav-count">{favoriteCount}</span>}
            </button>
          ))}
        </div>
        <div className="nav-label" id="categories-label">Categories</div>
        <div className="nav" role="group" aria-labelledby="categories-label">
          <button className="nav-item cat" aria-pressed={view === 'library' && category === null} onClick={() => onCategory(null)}>
            <LayoutGrid aria-hidden="true" /><span>All games</span>
          </button>
          {categories.map(name => {
            const Icon = categoryIcon(name);
            return (
              <button key={name} className="nav-item cat" aria-pressed={view === 'library' && category === name} onClick={() => onCategory(name)}>
                <Icon aria-hidden="true" /><span>{name}</span>
              </button>
            );
          })}
        </div>
      </nav>
      {children}
      {onAdmin && <button className="admin-entry" onClick={onAdmin}>Admin</button>}
    </aside>
  );
}
