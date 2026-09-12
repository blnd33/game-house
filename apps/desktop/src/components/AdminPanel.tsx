import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AdminApi, AdminGame, AdminResult, AdminSteamApp, NewGame } from '../station/admin.ts';

type Tab = 'games' | 'add' | 'password';

const STATUS_TEXT: Readonly<Record<AdminGame['status'], string>> = {
  ready: 'Ready', disabled: 'Hidden', not_installed: 'Not installed', invalid: 'Needs attention',
};

const gameIdFrom = (title: string) =>
  title.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

/** Staff-only screen for this PC's game list. It cannot touch sessions, prices or anything that runs a command. */
export function AdminPanel({ admin, stationLabel, sessionActive, onClose }: {
  admin: AdminApi;
  stationLabel: string;
  /** A customer session started: the panel closes itself. */
  sessionActive: boolean;
  onClose(): void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordSet, setPasswordSet] = useState(true);
  const [games, setGames] = useState<readonly AdminGame[]>([]);
  const [tab, setTab] = useState<Tab>('games');
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void admin.status().then(status => setPasswordSet(status.password_set)); }, [admin]);
  useEffect(() => { if (sessionActive && token) { void admin.lock(token); onClose(); } }, [sessionActive, token, admin, onClose]);

  const apply = useCallback((result: AdminResult) => {
    if (result.ok) {
      setGames(result.games);
      setError(null);
      setProblems([]);
      return true;
    }
    setError(result.message);
    setProblems(result.problems ?? []);
    if (result.message.includes('locked')) setToken(null);
    return false;
  }, []);

  const run = useCallback(async (action: (current: string) => Promise<AdminResult>) => {
    if (!token) return false;
    setBusy(true);
    try { return apply(await action(token)); } finally { setBusy(false); }
  }, [token, apply]);

  async function unlock() {
    setBusy(true);
    try {
      const result = await admin.unlock(password);
      setPassword('');
      if (!result.ok) { setError(result.message); return; }
      setToken(result.token);
      setError(null);
      apply(await admin.games(result.token));
    } finally { setBusy(false); }
  }

  async function lock() {
    if (token) await admin.lock(token);
    setToken(null);
    setGames([]);
    onClose();
  }

  if (!token) {
    return (
      <Frame stationLabel={stationLabel} onClose={onClose}>
        <div className="admin-unlock">
          <Lock aria-hidden="true" />
          <h3>Staff only</h3>
          {passwordSet ? (
            <>
              <p>Enter the staff password to change this PC&rsquo;s games.</p>
              <form onSubmit={event => { event.preventDefault(); void unlock(); }}>
                <input type="password" aria-label="Staff password" autoFocus value={password} disabled={busy}
                  onChange={event => setPassword(event.target.value)} placeholder="Staff password" />
                <button className="btn-primary" type="submit" disabled={busy || password.length === 0}>Unlock</button>
              </form>
            </>
          ) : (
            <p>No staff password is set on this PC. An administrator sets one with:<br />
              <code>GamingHouse.Agent.exe admin set-password</code></p>
          )}
          {error && <p className="admin-error" role="alert">{error}</p>}
        </div>
      </Frame>
    );
  }

  return (
    <Frame stationLabel={stationLabel} onClose={onClose} onLock={() => void lock()}>
      <div className="admin-tabs" role="tablist">
        {(['games', 'add', 'password'] as const).map(name => (
          <button key={name} role="tab" aria-selected={tab === name} className="chip" onClick={() => { setTab(name); setError(null); }}>
            {name === 'games' ? `Games (${games.length})` : name === 'add' ? 'Add a game' : 'Staff password'}
          </button>
        ))}
      </div>
      {error && (
        <div className="admin-error" role="alert">
          {error}
          {problems.length > 1 && <ul>{problems.slice(1).map(problem => <li key={problem}>{problem}</li>)}</ul>}
        </div>
      )}
      {tab === 'games' && <GameList admin={admin} games={games} busy={busy} run={run} />}
      {tab === 'add' && <AddGame admin={admin} token={token} busy={busy} categories={[...new Set(games.map(g => g.category))]}
        run={run} onAdded={() => setTab('games')} />}
      {tab === 'password' && <ChangePassword admin={admin} token={token} onChanged={() => { setToken(null); setGames([]); }} />}
    </Frame>
  );
}

function Frame({ stationLabel, onClose, onLock, children }: {
  stationLabel: string; onClose(): void; onLock?(): void; children: React.ReactNode;
}) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Admin panel"
      onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
      <div className="dialog admin">
        <header className="admin-head">
          <div>
            <div className="eyebrow warn">Staff only</div>
            <h2>Admin · {stationLabel}</h2>
          </div>
          <div className="admin-head-actions">
            {onLock && <button className="btn-secondary" onClick={onLock}>Lock panel</button>}
            <button className="dev-close" aria-label="Close admin panel" onClick={onClose}><X aria-hidden="true" /></button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

function GameList({ admin, games, busy, run }: {
  admin: AdminApi;
  games: readonly AdminGame[];
  busy: boolean;
  run(action: (token: string) => Promise<AdminResult>): Promise<boolean>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const move = (index: number, by: number) => {
    const order = games.map(game => game.game_id);
    const target = index + by;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    void run(token => admin.reorder(token, order));
  };
  return (
    <ul className="admin-list">
      {games.length === 0 && <li className="admin-empty">No games on this PC yet. Use “Add a game”.</li>}
      {games.map((game, index) => (
        <li key={game.game_id} className={`admin-row${game.enabled ? '' : ' hidden-game'}`}>
          <div className="admin-order">
            <button aria-label={`Move ${game.title} up`} disabled={busy || index === 0}
              onClick={() => move(index, -1)}><ChevronUp aria-hidden="true" /></button>
            <button aria-label={`Move ${game.title} down`} disabled={busy || index === games.length - 1}
              onClick={() => move(index, 1)}><ChevronDown aria-hidden="true" /></button>
          </div>
          <div className="admin-game">
            <div className="admin-title">{game.title}</div>
            <div className="admin-meta">
              <span className={`status ${game.status}`}>{STATUS_TEXT[game.status]}</span> · {game.category} · {game.launch_type === 'steam' ? 'Steam' : 'Program'}
              {game.controller && ' · Controller'}{game.multiplayer && ' · Multiplayer'}
            </div>
            {[...game.problems, ...game.missing].map(note => <div key={note} className="admin-note">{note}</div>)}
            {editing === game.game_id && <EditGame admin={admin} game={game} busy={busy} run={run} onDone={() => setEditing(null)} />}
          </div>
          <div className="admin-actions">
            <button aria-label={`Edit ${game.title}`} onClick={() => setEditing(editing === game.game_id ? null : game.game_id)}>
              <Pencil aria-hidden="true" />
            </button>
            <button aria-label={`${game.enabled ? 'Hide' : 'Show'} ${game.title}`} disabled={busy}
              onClick={() => void run(token => admin.update(token, game.game_id, { enabled: !game.enabled }))}>
              {game.enabled ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
            </button>
            <button aria-label={`Remove ${game.title}`} disabled={busy} className="danger"
              onClick={() => void run(token => admin.remove(token, game.game_id))}>
              <Trash2 aria-hidden="true" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EditGame({ admin, game, busy, run, onDone }: {
  admin: AdminApi; game: AdminGame; busy: boolean;
  run(action: (token: string) => Promise<AdminResult>): Promise<boolean>;
  onDone(): void;
}) {
  const [title, setTitle] = useState(game.title);
  const [category, setCategory] = useState(game.category);
  const [controller, setController] = useState(game.controller);
  const [multiplayer, setMultiplayer] = useState(game.multiplayer);
  return (
    <form className="admin-edit" onSubmit={async event => {
      event.preventDefault();
      if (await run(token => admin.update(token, game.game_id, { title, category, controller, multiplayer }))) onDone();
    }}>
      <label>Name<input value={title} aria-label={`Name of ${game.title}`} onChange={event => setTitle(event.target.value)} /></label>
      <label>Category<input value={category} aria-label={`Category of ${game.title}`} onChange={event => setCategory(event.target.value)} /></label>
      <label className="admin-check"><input type="checkbox" checked={controller} onChange={event => setController(event.target.checked)} />Controller</label>
      <label className="admin-check"><input type="checkbox" checked={multiplayer} onChange={event => setMultiplayer(event.target.checked)} />Multiplayer</label>
      <div className="admin-edit-actions">
        <button className="btn-primary" type="submit" disabled={busy}>Save</button>
        <button className="btn-secondary" type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function AddGame({ admin, token, busy, categories, run, onAdded }: {
  admin: AdminApi; token: string; busy: boolean; categories: readonly string[];
  run(action: (token: string) => Promise<AdminResult>): Promise<boolean>;
  onAdded(): void;
}) {
  const [kind, setKind] = useState<'steam' | 'executable'>('steam');
  const [apps, setApps] = useState<readonly AdminSteamApp[] | null>(null);
  const [steamRoot, setSteamRoot] = useState<string | null>(null);
  const [draft, setDraft] = useState<NewGame>({
    kind: 'steam', game_id: '', title: '', category: categories[0] ?? 'Action', executable_names: [],
    controller: false, multiplayer: false, timeout_seconds: 120,
  });
  const [processName, setProcessName] = useState('');

  useEffect(() => {
    if (kind !== 'steam' || apps !== null) return;
    void admin.steam(token).then(result => { setApps(result.apps); setSteamRoot(result.steam_root); });
  }, [kind, apps, admin, token]);

  const set = (patch: Partial<NewGame>) => setDraft(current => ({ ...current, ...patch }));

  async function submit() {
    const names = processName.split(',').map(name => name.trim()).filter(Boolean);
    const game: NewGame = { ...draft, kind, executable_names: names, game_id: draft.game_id || gameIdFrom(draft.title) };
    if (await run(token2 => admin.add(token2, game))) onAdded();
  }

  return (
    <div className="admin-add">
      <div className="admin-tabs">
        <button className="chip" aria-pressed={kind === 'steam'} onClick={() => setKind('steam')}>From Steam</button>
        <button className="chip" aria-pressed={kind === 'executable'} onClick={() => setKind('executable')}>Program file</button>
      </div>

      {kind === 'steam' && (
        <div className="admin-steam">
          {apps === null && <p>Looking for installed Steam games…</p>}
          {apps !== null && apps.length === 0 && <p>No installed Steam games found{steamRoot ? '' : ' (Steam is not installed on this PC)'}.</p>}
          {apps?.map(app => (
            <button key={app.app_id} className="admin-steam-app" onClick={() => {
              set({ app_id: app.app_id, title: app.name, game_id: gameIdFrom(app.name) });
              setProcessName(app.candidate_executables[0]?.split('\\').pop() ?? '');
            }}>
              <strong>{app.name}</strong>
              <span>AppID {app.app_id}{app.update_required ? ' · update required' : ''}</span>
            </button>
          ))}
        </div>
      )}

      {kind === 'executable' && (
        <button className="btn-secondary" onClick={async () => {
          const path = await admin.pickGameFile();
          if (!path) return;
          const file = path.split('\\').pop() ?? '';
          set({ executable_path: path, title: draft.title || file.replace(/\.exe$/i, ''), game_id: draft.game_id || gameIdFrom(file.replace(/\.exe$/i, '')) });
          setProcessName(file);
        }}>Choose the game program…</button>
      )}
      {draft.executable_path && <p className="admin-path">{draft.executable_path}</p>}

      <form className="admin-edit" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label>Name<input aria-label="Game name" value={draft.title} onChange={event => set({ title: event.target.value })} /></label>
        <label>Category
          <input aria-label="Game category" list="admin-categories" value={draft.category} onChange={event => set({ category: event.target.value })} />
          <datalist id="admin-categories">{categories.map(category => <option key={category} value={category} />)}</datalist>
        </label>
        <label>Process file
          <input aria-label="Game process file" value={processName} placeholder="Game.exe" onChange={event => setProcessName(event.target.value)} />
        </label>
        <label className="admin-check"><input type="checkbox" checked={draft.controller} onChange={event => set({ controller: event.target.checked })} />Controller</label>
        <label className="admin-check"><input type="checkbox" checked={draft.multiplayer} onChange={event => set({ multiplayer: event.target.checked })} />Multiplayer</label>
        <div className="admin-edit-actions">
          <button className="btn-primary" type="submit" disabled={busy || !draft.title || !processName || (kind === 'steam' ? !draft.app_id : !draft.executable_path)}>
            <Plus aria-hidden="true" />Add game
          </button>
        </div>
      </form>
      <p className="admin-note">The game must already be installed on this PC, and its folder must not be changeable by customers.</p>
    </div>
  );
}

function ChangePassword({ admin, token, onChanged }: { admin: AdminApi; token: string; onChanged(): void }) {
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form className="admin-edit" onSubmit={async event => {
      event.preventDefault();
      if (next !== repeat) { setMessage('The passwords do not match.'); return; }
      const result = await admin.setPassword(token, next);
      if (!result.ok) { setMessage(result.message ?? 'The password was not changed.'); return; }
      setMessage(null);
      onChanged();
    }}>
      <label>New staff password<input type="password" aria-label="New staff password" value={next} onChange={event => setNext(event.target.value)} /></label>
      <label>Repeat password<input type="password" aria-label="Repeat staff password" value={repeat} onChange={event => setRepeat(event.target.value)} /></label>
      {message && <p className="admin-error" role="alert">{message}</p>}
      <div className="admin-edit-actions">
        <button className="btn-primary" type="submit" disabled={next.length < 6}>Change password</button>
      </div>
      <p className="admin-note">Everyone using the panel is signed out after the password changes.</p>
    </form>
  );
}
