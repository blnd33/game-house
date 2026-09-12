import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banner } from './components/Banner.tsx';
import { EndedScreen } from './components/EndedScreen.tsx';
import { FeaturedGame } from './components/FeaturedGame.tsx';
import { GameGrid } from './components/GameGrid.tsx';
import { Header } from './components/Header.tsx';
import { LaunchOverlay } from './components/LaunchOverlay.tsx';
import { SessionCard } from './components/SessionCard.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import type { ConnectedStation } from './station/connect.ts';
import { deriveDisplay, isLive } from './station/display.ts';
import { useCatalog, useNow, useStation } from './station/hooks.ts';
import { categoriesOf, visibleGames, type LibraryFilter, type LibraryView } from './station/library.ts';
import { browserStorage, loadFavorites, loadRecent, saveFavorites, saveRecent, toggled, withPlayed } from './station/preferences.ts';

const storage = browserStorage();
const FILTERS: readonly [LibraryFilter, string][] = [['all', 'All'], ['multiplayer', 'Multiplayer'], ['controller', 'Controller']];
const SECTION_TITLE: Readonly<Record<LibraryView, string>> = { library: 'Installed games', favorites: 'Favorite games', recent: 'Played on this PC' };

export function App({ station }: { station: ConnectedStation }) {
  const { client, dev, host } = station;
  const sample = dev !== null;
  const { state, stamps } = useStation(client);
  const games = useCatalog(client);
  const now = useNow(isLive(state));
  const display = state ? deriveDisplay(state, stamps, now) : null;

  const [view, setView] = useState<LibraryView>('library');
  const [category, setCategory] = useState<string | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState(() => loadFavorites(storage));
  const [recent, setRecent] = useState(() => loadRecent(storage));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [launchHidden, setLaunchHidden] = useState(false);
  const [dismissedFailure, setDismissedFailure] = useState<string | null>(null);
  const [playError, setPlayError] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => saveFavorites(storage, favorites), [favorites]);
  useEffect(() => saveRecent(storage, recent), [recent]);
  const runningKey = state?.running_game_ids.join('|') ?? '';
  useEffect(() => {
    if (runningKey) setRecent(prev => runningKey.split('|').reduce((list, id) => withPlayed(list, id), prev));
  }, [runningKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
      if ((event.key === '/' && !typing) || (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'f')) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (sample && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setDevOpen(open => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sample]);

  const play = useCallback((gameId: string) => {
    setSelectedId(gameId);
    setLaunchHidden(false);
    setDismissedFailure(null);
    setPlayError(false);
    client.play(gameId).catch(() => setPlayError(true));
  }, [client]);
  const toggleFavorite = useCallback((gameId: string) => setFavorites(prev => toggled(prev, gameId)), []);
  const chooseView = useCallback((next: LibraryView) => { setView(next); setCategory(null); }, []);
  const chooseCategory = useCallback((next: string | null) => { setView('library'); setCategory(next); }, []);

  const categories = useMemo(() => categoriesOf(games ?? []), [games]);
  const list = useMemo(() => visibleGames(games ?? [], { view, category, filter, search, favorites, recent }),
    [games, view, category, filter, search, favorites, recent]);
  const byId = useMemo(() => new Map((games ?? []).map(game => [game.game_id, game])), [games]);

  if (!state || !display) return <div className="boot" aria-busy="true" />;

  const running = state.running_game_ids;
  const launch = state.launch;
  const startingId = launch.phase === 'requesting' || launch.phase === 'starting' ? launch.game_id : null;
  const pick = (...ids: (string | null | undefined)[]) => {
    for (const id of ids) { const game = id ? byId.get(id) : undefined; if (game) return game; }
    return null;
  };
  const featured = pick(selectedId, running[0], recent[0], list[0]?.game_id, games?.[0]?.game_id);
  const failureKey = launch.phase === 'failed' ? `${launch.game_id}|${launch.reason}` : null;
  const failure = launch.phase === 'failed' && failureKey !== dismissedFailure
    ? { title: byId.get(launch.game_id)?.title ?? 'The game', reason: launch.reason, billingNotStarted: display.billable.kind === 'not_started' }
    : null;
  const launchGame = startingId && !launchHidden ? byId.get(startingId) ?? null : null;
  const ended = display.phase === 'ended';
  const title = view === 'favorites' ? 'Favorites' : view === 'recent' ? 'Recently played' : category ? `${category} games` : 'Game library';
  const empty = search.trim() ? <><strong>No games match “{search.trim()}”</strong>Try a different name.</>
    : view === 'favorites' ? <><strong>No favorites yet</strong>Tap the heart on a game to keep it here.</>
      : view === 'recent' ? <><strong>Nothing played yet</strong>Games started on this PC will show up here.</>
        : <><strong>No games here</strong>Try another category or filter.</>;

  return (
    <>
      <div className="app" inert={ended || launchGame !== null}>
        <Sidebar view={view} category={category} categories={categories} favoriteCount={favorites.size}
          onView={chooseView} onCategory={chooseCategory}>
          <SessionCard display={display} help={state.help} sample={sample} onRequestHelp={() => { void client.requestHelp(); }} />
        </Sidebar>
        <main className="main">
          <Header title={title} search={search} onSearch={setSearch} inputRef={searchRef}
            stationLabel={state.station_label} connection={state.connection} />
          <Banner connection={state.connection} hasSession={display.session !== null}
            unconfigured={state.snapshot === null && state.source === 'native'} failure={failure} playError={playError}
            onDismiss={() => { setDismissedFailure(failureKey); setPlayError(false); }} />
          <div className="scroll">
            {featured && (
              <FeaturedGame game={featured} display={display} running={running.includes(featured.game_id)}
                starting={featured.game_id === startingId} favorite={favorites.has(featured.game_id)}
                onPlay={play} onToggleFavorite={toggleFavorite} />
            )}
            <div className="section-head">
              <h2>{SECTION_TITLE[view]}</h2>
              <span className="count">{list.length} {list.length === 1 ? 'game' : 'games'}</span>
              {sample && <span className="sample-tag" title="Illustrative titles, not verified installs">Sample catalog</span>}
              <div className="chips" role="group" aria-label="Filter games">
                {FILTERS.map(([id, label]) => (
                  <button key={id} className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
                ))}
              </div>
            </div>
            {games === null ? <div className="empty" role="status">Loading games…</div> : (
              <GameGrid games={list} selectedId={featured?.game_id ?? null} favorites={favorites} runningIds={running}
                startingId={startingId} canPlay={display.canPlay} playHint={display.playHint} empty={empty}
                onSelect={setSelectedId} onPlay={play} onToggleFavorite={toggleFavorite} />
            )}
          </div>
        </main>
        <StatusBar connection={state.connection} host={host} sample={sample} developmentBackend={state.backend_mode === 'development'}
          unconfigured={state.snapshot === null && state.source === 'native'} />
      </div>
      {launchGame && startingId && (launch.phase === 'requesting' || launch.phase === 'starting') && (
        <LaunchOverlay game={launchGame} phase={launch.phase} sample={sample} onHide={() => setLaunchHidden(true)} />
      )}
      {ended && <EndedScreen display={display} stationLabel={state.station_label} sample={sample} />}
      {dev && <dev.Toggle open={devOpen} onToggle={() => setDevOpen(open => !open)} />}
      {dev && devOpen && <dev.Panel controls={dev.controls} state={state} nativeLaunch={station.launchMode === 'native'} onClose={() => setDevOpen(false)} />}
    </>
  );
}
