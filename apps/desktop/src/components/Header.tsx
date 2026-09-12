import { Search, X } from 'lucide-react';
import type { RefObject } from 'react';
import type { ConnectionState } from '../../../../packages/contracts/src/index.ts';
import { CONNECTION } from './labels.ts';

interface Props {
  title: string;
  search: string;
  onSearch(value: string): void;
  inputRef: RefObject<HTMLInputElement | null>;
  stationLabel: string;
  connection: ConnectionState;
}

export function Header({ title, search, onSearch, inputRef, stationLabel, connection }: Props) {
  const status = CONNECTION[connection];
  return (
    <header className="header">
      <h1>{title}</h1>
      <div className="search" role="search">
        <Search aria-hidden="true" />
        <input ref={inputRef} type="search" placeholder="Search your games…" aria-label="Search games" value={search}
          spellCheck={false} autoComplete="off" onChange={event => onSearch(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape') onSearch(''); }} />
        {search && (
          <button className="search-clear" aria-label="Clear search" onClick={() => { onSearch(''); inputRef.current?.focus(); }}>
            <X aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="station-pill" title={status.text} aria-label={`Station ${stationLabel}. ${status.text}`}>
        <span className={`dot ${status.tone}`} />{stationLabel}
      </div>
    </header>
  );
}
