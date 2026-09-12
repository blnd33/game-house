// Drives the real Electron renderer through the Phase 2 player states using the
// development sample station. Proves UI behavior only: no game launches, no
// backend exists, and no Windows restriction is applied.
import type { BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';

interface Check { name: string; passed: boolean; detail?: string }

// Page-side helpers that find controls by accessible name, as a player would.
const HELPERS = String.raw`(() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const shown = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  // textContent, not innerText: accessible names ignore CSS text-transform.
  const nameOf = el => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
  const find = name => [...document.querySelectorAll('button')].filter(shown)
    .find(b => nameOf(b) === name || b.querySelector('span')?.textContent === name);
  window.__gh = {
    sleep,
    text: () => document.body.innerText.toLowerCase(),
    button: name => { const b = find(name); return b ? { disabled: b.disabled, pressed: b.getAttribute('aria-pressed') } : null; },
    click: name => {
      const b = find(name);
      if (!b) throw new Error('No button named ' + name);
      if (b.disabled) throw new Error('Button is disabled: ' + name);
      b.click();
    },
    titles: () => [...document.querySelectorAll('ul[aria-label="Games"] > li')].map(li => li.getAttribute('aria-label')),
    region: label => (document.querySelector('[aria-label="' + label + '"]')?.innerText ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
    heading: () => document.querySelector('.header h1')?.textContent ?? '',
    choose: (labelText, value) => {
      const select = [...document.querySelectorAll('label')].find(l => l.textContent.includes(labelText))?.querySelector('select');
      if (!select) throw new Error('No select labeled ' + labelText);
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
    tick: labelText => [...document.querySelectorAll('label')].find(l => l.textContent.includes(labelText))?.querySelector('input')?.click(),
    times: () => (window.__gh.region('Your session').match(/\d{2}:\d{2}:\d{2}/g) ?? [])
      .map(t => t.split(':').reduce((sum, part) => sum * 60 + Number(part), 0)),
    waitFor: async (predicate, what, timeout = 10000) => {
      const end = performance.now() + timeout;
      let last;
      while (performance.now() < end) {
        try { const value = predicate(); if (value) return value; } catch (error) { last = error; }
        await sleep(50);
      }
      throw new Error('Timed out waiting for ' + what + (last ? ' (' + last.message + ')' : ''));
    },
  };
})()`;

export async function runUiTest(window: BrowserWindow, artifacts: URL): Promise<boolean> {
  const wc = window.webContents;
  const checks: Check[] = [];
  const shots = new URL('ui/', artifacts);
  await mkdir(shots, { recursive: true });

  const js = <T = unknown>(code: string): Promise<T> => wc.executeJavaScript(`(async () => { const gh = window.__gh; ${code} })()`);
  const shot = async (name: string) => {
    await js(`await Promise.race([new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))), gh.sleep(400)]); await gh.sleep(150)`);
    await writeFile(new URL(`${name}.png`, shots), (await wc.capturePage()).toPNG());
  };
  const expect = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const check = async (name: string, body: () => Promise<string | void>) => {
    try {
      const detail = await body();
      checks.push(detail ? { name, passed: true, detail } : { name, passed: true });
    } catch (error) {
      checks.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
    }
  };
  const ready = async () => {
    await wc.executeJavaScript(HELPERS);
    await js(`await gh.waitFor(() => gh.text().includes('connected to padel house'), 'sample connection')`);
  };
  const viewport = async (width: number, height: number) => {
    window.setContentSize(width, height);
    await new Promise(resolve => setTimeout(resolve, 250));
    let [w, h] = await wc.executeJavaScript('[innerWidth, innerHeight]') as [number, number];
    if (w !== width || h !== height) {
      wc.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height }, viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: 1, viewSize: { width, height }, scale: 1 });
      await new Promise(resolve => setTimeout(resolve, 250));
      [w, h] = await wc.executeJavaScript('[innerWidth, innerHeight]') as [number, number];
    }
    return `${w}x${h}`;
  };
  const dev = async (code: string) => {
    await js(`if (!gh.button('Close development controls')) {
      gh.click('Simulated');
      await gh.waitFor(() => gh.button('Close development controls'), 'development panel');
    }
    ${code}`);
  };

  const size = await viewport(1920, 1080);
  await js('localStorage.clear()');
  await ready();

  await check('renderer is sandboxed, context-isolated and cannot reach Node', async () => {
    const r = await js<{ node: boolean; info: Record<string, unknown>; title: string }>(
      `return { node: typeof require !== 'undefined' || typeof process !== 'undefined', info: await window.gamingHouse.hostInfo(), title: document.title }`);
    expect(!r.node, 'renderer can reach Node');
    expect(r.info.sandboxed === true && r.info.contextIsolated === true, `bridge reports ${JSON.stringify(r.info)}`);
    expect(r.info.nativeLaunchAvailable === false, 'bridge claims native launch');
    expect(r.title === 'Gaming House', `title ${r.title}`);
  });

  await check('logo renders and simulated behavior is labeled', async () => {
    const r = await js<{ logo: boolean; text: string }>(`await Promise.all([...document.images].map(i => i.decode().catch(() => null)));
      return { logo: [...document.images].some(i => i.alt === 'Gaming House' && i.naturalWidth > 0), text: gh.text() }`);
    expect(r.logo, 'logo image did not load');
    for (const label of ['sample catalog', '(simulated)', 'no real launch, billing or lock', 'placeholder art']) {
      expect(r.text.includes(label), `missing "${label}"`);
    }
  });

  await check('waiting: browsing allowed, Play locked until the cashier authorizes', async () => {
    const r = await js<{ session: string; hero: string; play: { disabled: boolean } | null; count: number }>(
      `return { session: gh.region('Your session'), hero: gh.region('Featured game'), play: gh.button('Play Rocket League'), count: gh.titles().length }`);
    expect(r.session.includes('no session') && r.session.includes('ask the cashier'), `session card: ${r.session}`);
    expect(r.hero.includes('waiting for cashier'), `hero: ${r.hero}`);
    expect(r.play?.disabled === true, 'card Play is enabled while waiting');
    expect(r.count === 12, `expected 12 sample games, saw ${r.count}`);
  });
  await shot('01-waiting');

  await check('search filters by title and initials, with an empty state', async () => {
    const search = async (text: string) => {
      await js(`const input = document.querySelector('input[type=search]'); input.focus(); input.select();`);
      await wc.insertText(text);
      await js('await gh.sleep(80)');
      return js<string[]>('return gh.titles()');
    };
    const rocket = await search('rocket');
    expect(JSON.stringify(rocket) === '["Rocket League"]', `rocket → ${JSON.stringify(rocket)}`);
    const gta = await search('gta');
    expect(JSON.stringify(gta) === '["Grand Theft Auto V"]', `gta → ${JSON.stringify(gta)}`);
    await search('zzzz');
    await js(`await gh.waitFor(() => gh.text().includes('no games match'), 'empty search state')`);
    await shot('02-search-empty');
    await js(`gh.click('Clear search'); await gh.sleep(50)`);
    expect(await js<number>('return gh.titles().length') === 12, 'clearing search did not restore the library');
  });

  await check('keyboard: "/" focuses search and Escape clears it', async () => {
    await js(`document.activeElement?.blur()`);
    wc.sendInputEvent({ type: 'keyDown', keyCode: '/' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: '/' });
    const focused = await js<string | null>(`await gh.sleep(100); return document.activeElement?.getAttribute('aria-label') ?? null`);
    expect(focused === 'Search games', `focus went to ${focused}`);
    await wc.insertText('dota');
    await js('await gh.sleep(50)');
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    const count = await js<number>('await gh.sleep(100); return gh.titles().length');
    expect(count === 12, `Escape left ${count} games`);
  });

  await check('favorites: add, persist across a restart, and remove', async () => {
    await js(`gh.click('Add Tekken 8 to favorites'); await gh.sleep(50)`);
    const loaded = new Promise<void>(resolve => wc.once('did-finish-load', () => resolve()));
    wc.reload();
    await loaded;
    await ready();
    await js(`gh.click('Favorites'); await gh.sleep(50)`);
    const titles = await js<string[]>('return gh.titles()');
    expect(JSON.stringify(titles) === '["Tekken 8"]', `favorites after reload: ${JSON.stringify(titles)}`);
    expect(await js<string>('return gh.heading()') === 'Favorites', 'header did not change to Favorites');
    await js(`gh.click('Remove Tekken 8 from favorites'); await gh.waitFor(() => gh.text().includes('no favorites yet'), 'empty favorites')`);
    await js(`gh.click('Library'); await gh.sleep(50)`);
  });

  await check('categories and filter chips narrow the library', async () => {
    await js(`gh.click('Racing'); await gh.sleep(50)`);
    const racing = await js<string[]>('return gh.titles()');
    expect(JSON.stringify(racing) === '["Forza Horizon 5","F1 25"]', `racing → ${JSON.stringify(racing)}`);
    expect(await js<string>('return gh.heading()') === 'Racing games', 'header did not name the category');
    await js(`gh.click('All games'); gh.click('Controller'); await gh.sleep(50)`);
    const r = await js<{ count: number; all: boolean }>(`const items = [...document.querySelectorAll('ul[aria-label="Games"] > li')];
      return { count: items.length, all: items.every(li => li.querySelector('[aria-label="Controller supported"]')) }`);
    expect(r.count > 0 && r.count < 12 && r.all, `controller filter: ${JSON.stringify(r)}`);
    await js(`gh.click('All'); await gh.sleep(50)`);
  });

  await check('cashier authorization enables Play', async () => {
    await dev(`gh.choose('Grace for the next session', '5'); gh.click('Authorize customer');
      await gh.waitFor(() => gh.region('Your session').includes('ready'), 'ready state');
      gh.click('Close development controls');`);
    const play = await js<{ disabled: boolean } | null>(`return gh.button('Play Rocket League')`);
    expect(play?.disabled === false, 'Play is still disabled after authorization');
  });
  await shot('03-authorized');

  await check('Play: launching, then backend grace countdown, then confirmed billing', async () => {
    await js(`gh.click('Play Rocket League');
      await gh.waitFor(() => document.querySelector('[role=dialog]')?.innerText.toLowerCase().includes('rocket league'), 'launch dialog')`);
    await shot('04-launching');
    await js(`await gh.waitFor(() => gh.region('Your session').includes('grace period ends') && !document.querySelector('[role=dialog]'),
      'grace countdown with the game running', 8000)`);
    const grace = await js<string>(`return gh.region('Your session')`);
    expect(grace.includes('not started') && grace.includes('station time'), `grace card: ${grace}`);
    await shot('05-grace');
    await js(`await gh.waitFor(() => gh.region('Your session').includes('confirmed by padel house'), 'active billing', 10000); await gh.sleep(2300)`);
    const [billable = -1, station = -1] = await js<number[]>('return gh.times()');
    expect(billable >= 1, `billable ${billable}`);
    expect(station > billable, `station time ${station} should exceed billable ${billable} (grace)`);
    expect((await js<string>(`return gh.region('Featured game')`)).includes('now playing'), 'hero does not show now playing');
    return `billable ${billable}s, station ${station}s`;
  });
  await shot('06-active');

  await check('switching and closing games keep the same paid session', async () => {
    const [before = 0] = await js<number[]>('return gh.times()');
    await js(`gh.click('Play F1 25'); await gh.waitFor(() => gh.region('F1 25').includes('playing'), 'F1 25 running', 6000)`);
    await dev(`gh.click('Close running game'); gh.click('Close development controls'); await gh.sleep(1200)`);
    const session = await js<string>(`return gh.region('Your session')`);
    const [after = 0] = await js<number[]>('return gh.times()');
    expect(session.includes('active') && session.includes('confirmed by padel house'), `session: ${session}`);
    expect(after > before, `billable went from ${before} to ${after}`);
    expect(!(await js<string>(`return gh.region('F1 25')`)).includes('playing'), 'closed game still marked playing');
  });

  await check('disconnected: honest banner, Play paused, session not ended', async () => {
    await dev(`gh.click('Disconnected'); gh.click('Close development controls');
      await gh.waitFor(() => gh.text().includes('connection to padel house lost'), 'offline banner')`);
    const r = await js<{ session: string; play: { disabled: boolean } | null }>(`return { session: gh.region('Your session'), play: gh.button('Play Tekken 8') }`);
    expect(r.session.includes('active') && r.session.includes('last confirmed'), `session: ${r.session}`);
    expect(r.play?.disabled === true, 'Play still enabled while offline');
    await shot('07-disconnected');
    await dev(`gh.click('Connected'); gh.click('Close development controls');
      await gh.waitFor(() => !gh.text().includes('connection to padel house lost'), 'reconnect')`);
  });

  await check('launch failure: clear reason, session untouched', async () => {
    await dev(`gh.choose('Next launch', 'login_required'); gh.click('Close development controls')`);
    await js(`gh.click('Play Tekken 8'); await gh.waitFor(() => document.querySelector('[role=alert]')?.innerText.toLowerCase().includes('sign-in'), 'failure banner', 6000)`);
    const r = await js<{ alert: string; session: string }>(`return { alert: document.querySelector('[role=alert]').innerText.toLowerCase(), session: gh.region('Your session') }`);
    expect(r.alert.includes('tekken 8'), `alert: ${r.alert}`);
    expect(r.session.includes('active'), `session changed: ${r.session}`);
    await shot('08-launch-failed');
    await js(`gh.click('Dismiss message'); await gh.sleep(50)`);
    await dev(`gh.choose('Next launch', 'succeeds'); gh.click('Close development controls')`);
  });

  await check('request help does not stop time', async () => {
    const [before = 0] = await js<number[]>('return gh.times()');
    await js(`gh.click('Request help'); await gh.waitFor(() => gh.region('Your session').includes('staff notified'), 'help sent'); await gh.sleep(1100)`);
    const [after = 0] = await js<number[]>('return gh.times()');
    expect(after > before, `billable stopped at ${before}`);
  });

  await check('backend-supplied charge is shown exactly as sent', async () => {
    await dev(`gh.tick('fictional charge'); gh.click('Close development controls');
      await gh.waitFor(() => gh.region('Your session').includes('estimated charge'), 'estimate')`);
    expect((await js<string>(`return gh.region('Your session')`)).includes('1,000 iqd'), 'amount text changed');
  });

  await check('cashier end: session ended screen, verified lock, frozen totals', async () => {
    await dev(`gh.click('End session'); gh.click('Close development controls');
      await gh.waitFor(() => gh.text().includes('session ended'), 'ended screen');
      await gh.waitFor(() => gh.text().includes('pc-01 is locked'), 'lock verified', 5000)`);
    const read = () => js<string>(`return document.querySelector('[role=alertdialog]').innerText.replace(/\\s+/g, ' ')`);
    const first = await read();
    await js('await gh.sleep(1500)');
    const second = await read();
    expect(first === second, `totals moved: ${first} → ${second}`);
    expect(/charge\s*1,000 IQD/i.test(first), `final charge missing: ${first}`);
    expect(await js<boolean>(`return document.querySelector('.app').inert === true`), 'library still interactive behind the ended screen');
  });
  await shot('09-ended-locked');

  await check('next customer requires a fresh cashier authorization', async () => {
    await dev(`gh.click('Authorize customer'); gh.click('Close development controls');
      await gh.waitFor(() => !gh.text().includes('session ended') && gh.region('Your session').includes('ready'), 'fresh authorization')`);
    expect(!(await js<string>(`return gh.region('Your session')`)).includes('billable'), 'previous timers carried over');
  });

  for (const [width, height] of [[1280, 720], [1024, 640]] as const) {
    await check(`layout fits ${width}×${height} without horizontal scrolling`, async () => {
      const actual = await viewport(width, height);
      const r = await js<{ overflow: boolean; sessionVisible: boolean; searchVisible: boolean; footerOneLine: boolean }>(`await gh.sleep(150);
        const inView = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight; };
        const footer = document.querySelector('footer');
        return { overflow: document.documentElement.scrollWidth > innerWidth,
          sessionVisible: inView(document.querySelector('[aria-label="Your session"]')),
          searchVisible: inView(document.querySelector('input[type=search]')),
          footerOneLine: [...footer.children].every(c => c.getBoundingClientRect().height <= 24) }`);
      expect(!r.overflow && r.sessionVisible && r.searchVisible && r.footerOneLine, `${actual}: ${JSON.stringify(r)}`);
      await shot(`10-${width}x${height}`);
      return actual;
    });
  }

  const passed = checks.every(c => c.passed);
  const report = { passed, viewport: size, environment: 'Electron renderer + development sample station', checks };
  await writeFile(new URL('ui-test.json', artifacts), JSON.stringify(report, null, 2));
  for (const c of checks) console.log(`${c.passed ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  console.log(passed ? `UI test passed (${checks.length} checks)` : 'UI test FAILED');
  return passed;
}
