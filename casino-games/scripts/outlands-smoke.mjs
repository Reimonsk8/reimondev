import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = process.env.OUTLANDS_SMOKE_SHOTS
  || join(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'Temp', 'outlands-smoke');
mkdirSync(shotDir, { recursive: true });

const browserPath = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_BIN,
  process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((candidate) => candidate && existsSync(candidate));

if (!browserPath) {
  throw new Error(
    'Chrome/Chromium not found. Set PUPPETEER_EXECUTABLE_PATH or CHROME_BIN to run the Outlands smoke test.',
  );
}

const fakePayload = Buffer.from(JSON.stringify({
  sub: 'outlands-smoke-user',
  name: 'Smoke Operative',
  email: 'smoke@outlands.test',
})).toString('base64');
const fakeToken = `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.${fakePayload}.smoke`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Content-Type': 'application/json',
};

async function checkPhoneMenus(page, prefix) {
  const menus = [
    { selector: 'button[aria-label^="Grid pack"]', name: 'pack' },
    { selector: 'button[aria-label^="Character"]', name: 'skills' },
    { selector: 'button[aria-label^="Outpost"]', name: 'outpost' },
    { selector: 'button[aria-label^="Sector map"]', name: 'map' },
  ];
  const result = {};
  for (const menu of menus) {
    await page.click(menu.selector);
    await page.waitForSelector('.outlands-drawer', { timeout: 3000 });
    result[menu.name] = await page.evaluate((selector, menuName) => {
      const drawer = document.querySelector('.outlands-drawer');
      const body = drawer?.querySelector('.outlands-drawer-body');
      const active = document.querySelector(selector);
      return {
        active: active?.getAttribute('aria-pressed') === 'true',
        width: Math.round(drawer?.getBoundingClientRect().width ?? 0),
        height: Math.round(drawer?.getBoundingClientRect().height ?? 0),
        bodyWidth: Math.round(body?.clientWidth ?? 0),
        bodyScrollWidth: Math.round(body?.scrollWidth ?? 0),
        smallItemListVisible: menuName === 'pack'
          ? getComputedStyle(document.querySelector('.outlands-mobile-inventory-list')).display !== 'none'
          : undefined,
        marketplaceSearchVisible: menuName === 'outpost'
          ? Boolean(document.querySelector('[aria-label="Search marketplace items"]'))
          : undefined,
      };
    }, menu.selector, menu.name);
    if (menu.name === 'pack') {
      const reviewSale = await page.$('.outlands-mobile-inventory-list button[aria-label^="Review sale for"]');
      if (reviewSale) {
        await reviewSale.click();
        await page.waitForSelector('[role="alertdialog"]', { timeout: 3000 });
        result[menu.name].sellConfirmation = await page.$eval('[role="alertdialog"] h2', (node) => node.textContent?.trim());
        await page.click('.outlands-sell-confirm button:not(.outlands-btn-primary)');
        await page.waitForSelector('[role="alertdialog"]', { hidden: true });
      }
    }
    // Close this top-level menu before selecting another.
    await page.click(menu.selector);
  }
  await page.click('button[aria-label^="Grid pack"]');
  await page.$$eval('.outlands-drawer-tabs button', (buttons) => {
    buttons.find((button) => button.textContent?.includes('Controls'))?.click();
  });
  result.controls = await page.evaluate(() => {
    const drawer = document.querySelector('.outlands-drawer');
    const activeTab = drawer?.querySelector('.outlands-drawer-tabs button[aria-pressed="true"]');
    const body = drawer?.querySelector('.outlands-drawer-body');
    return {
      active: activeTab?.textContent?.includes('Controls') ?? false,
      width: Math.round(drawer?.getBoundingClientRect().width ?? 0),
      bodyWidth: Math.round(body?.clientWidth ?? 0),
      bodyScrollWidth: Math.round(body?.scrollWidth ?? 0),
    };
  });
  await page.$eval('.outlands-drawer-close', (button) => button.click());
  await page.waitForFunction(() => !document.querySelector('.outlands-drawer'), { timeout: 3000 });
  return { viewport: prefix, ...result };
}

const walletProfile = {
  currentBalance: 1000,
  nickname: 'Smoke Operative',
  avatarImage: null,
  email: 'smoke@outlands.test',
  totalGames: 0,
  totalWagered: 0,
  totalWins: 0,
  totalWon: 0,
  biggestWin: 0,
};

const server = await createServer({
  configFile: resolve(root, 'vite.config.js'),
  server: { host: '127.0.0.1', port: 0 },
});

let browser;
const results = { shots: {}, checks: {}, consoleErrors: [] };
let oauthTokenRequests = 0;

try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not expose a port.');
  const base = `http://127.0.0.1:${address.port}`;

  browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => results.consoleErrors.push(error.message));

  await page.evaluateOnNewDocument((token) => {
    window.__outlandsAudioContexts = 0;
    window.__outlandsAudioOscillators = 0;
    const NativeAudioContext = window.AudioContext;
    if (NativeAudioContext) {
      window.AudioContext = new Proxy(NativeAudioContext, {
        construct(target, args) {
          window.__outlandsAudioContexts += 1;
          const context = Reflect.construct(target, args);
          const createOscillator = context.createOscillator.bind(context);
          context.createOscillator = () => {
            window.__outlandsAudioOscillators += 1;
            return createOscillator();
          };
          return context;
        },
      });
    }
    if (!localStorage.getItem('c888_id_token')) {
      localStorage.setItem('c888_id_token', token);
      localStorage.setItem('c888_access_token', token);
      localStorage.setItem('c888_refresh_token', token);
      localStorage.setItem('c888_user_id', 'outlands-smoke-user');
      localStorage.setItem('c888_outlands_stash', '420');
    }
  }, fakeToken);

  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    if (url === 'https://casino888.auth.us-east-2.amazoncognito.com/oauth2/token') {
      oauthTokenRequests += 1;
      void request.respond({
        status: 200,
        headers: corsHeaders,
        body: JSON.stringify({ id_token: fakeToken, access_token: 'smoke-access', refresh_token: 'smoke-refresh' }),
      });
      return;
    }
    if (!url.includes('execute-api.us-east-2.amazonaws.com')) {
      void request.continue();
      return;
    }
    if (request.method() === 'OPTIONS') {
      void request.respond({ status: 204, headers: corsHeaders, body: '' });
      return;
    }
    const body = url.includes('/wallet/profile')
      ? JSON.stringify(walletProfile)
      : url.includes('/wallet/bet')
        ? JSON.stringify({ serverSeedHash: 'smoke', clientSeed: 'smoke', nonce: 0 })
        : '{}';
    void request.respond({ status: 200, headers: corsHeaders, body });
  });

  await page.goto(`${base}/outlands`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.outlands-briefing', { timeout: 15000 });
  results.shots.briefing = join(shotDir, 'outlands-briefing.png');
  await page.screenshot({ path: results.shots.briefing });

  results.checks.title = await page.$eval('.outlands-briefing h1', (node) => node.textContent?.trim());
  results.checks.stashBefore = await page.$eval('.outlands-briefing-stats', (node) => node.textContent || '');

  await page.click('.outlands-deploy');
  await page.waitForSelector('.outlands-hud', { timeout: 8000 });
  await page.waitForFunction(() => Boolean(window.__outlands?.server?.state), { timeout: 8000 });
  await page.waitForFunction(() => window.__outlandsAudioContexts > 0, { timeout: 3000 });
  results.checks.audio = await page.evaluate(() => ({
    contextsCreated: window.__outlandsAudioContexts,
    oscillatorsAtStart: window.__outlandsAudioOscillators,
    toggleLabel: document.querySelector('[aria-label="Mute audio"]')?.getAttribute('aria-label') ?? null,
  }));
  await page.click('[aria-label="Mute audio"]');
  results.checks.audio.mutedLabel = await page.$eval('[aria-label="Unmute audio"]', (button) => button.getAttribute('aria-label'));
  results.checks.audio.mutedStored = await page.evaluate(() => localStorage.getItem('c888_outlands_muted'));
  await page.click('[aria-label="Unmute audio"]');
  results.checks.audio.unmutedStored = await page.evaluate(() => localStorage.getItem('c888_outlands_muted'));

  results.checks.canvas = await page.$eval('.outlands-stage canvas', (canvas) => ({
    width: canvas.width,
    height: canvas.height,
    cssWidth: canvas.clientWidth,
    cssHeight: canvas.clientHeight,
  }));

  // Walk out of the S-Zone without heading toward Sector 09's safe outpost.
  // D is right-screen, the (+x,-y) diagonal in world space.
  // The sanctuary is a 12-unit Chebyshev square, so the walk has to clear
  // (21,21) ± 12 on both axes before zombies are allowed to engage.
  await page.keyboard.down('d');
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 6200));
  await page.keyboard.up('d');

  await page.waitForFunction(
    () => window.__outlands.server.state.zombies.length > 0
      || window.__outlands.server.state.player.threatTier > 0,
    { timeout: 12000 },
  );
  // Give the spawner a moment to produce a body after the tier flips.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 3600));

  results.checks.state = await page.evaluate(() => {
    const state = window.__outlands.server.state;
    return {
      phase: state.phase,
      tier: state.player.threatTier,
      inSafeZone: state.player.inSafeZone,
      x: Number(state.player.x.toFixed(2)),
      y: Number(state.player.y.toFixed(2)),
      zombies: state.zombies.length,
      health: state.player.health,
      ammo: state.player.weapons.rifle.ammo,
      threatLabel: document.querySelector('.outlands-threat strong')?.textContent,
    };
  });

  // Advance a separate deterministic run for 80 simulated seconds. This catches
  // runaway entity/chunk growth and pathological frame-step work without making
  // the rest of the interactive smoke journey depend on a random death.
  results.checks.performanceSoak = await page.evaluate(() => {
    const server = window.__outlands.server;
    const originalState = server.state;
    const soakState = structuredClone(originalState);
    server.state = soakState;
    soakState.phase = 'playing';
    soakState.player.alive = true;
    soakState.player.health = soakState.player.maxHealth;
    soakState.player.inSafeZone = false;
    soakState.player.threatTier = Math.max(2, soakState.player.threatTier);
    const input = {
      move: { x: 0, y: 0 },
      aim: { x: 1, y: 0 },
      firing: false,
      reload: false,
      sprint: false,
    };
    const started = performance.now();
    let maxZombies = 0;
    let activeChunks = 0;
    for (let step = 0; step < 2400; step += 1) {
      soakState.player.alive = true;
      soakState.player.health = soakState.player.maxHealth;
      soakState.phase = 'playing';
      server.step(1 / 30, input);
      server.drainEvents();
      maxZombies = Math.max(maxZombies, server.state.zombies.length);
      activeChunks = Object.keys(server.state.map.activeChunks ?? {}).length;
      if (!Number.isFinite(server.state.player.x) || !Number.isFinite(server.state.player.y)) {
        break;
      }
    }
    const result = {
      simulatedSeconds: Number((server.state.time - originalState.time).toFixed(1)),
      elapsedMs: Math.round(performance.now() - started),
      ticks: server.state.tick - originalState.tick,
      maxZombies,
      activeChunks,
      finitePlayerPosition: Number.isFinite(server.state.player.x) && Number.isFinite(server.state.player.y),
      zombieCap: server.state.zombies.length <= 42,
    };
    server.state = originalState;
    return result;
  });

  // Aim right of the player, fire, and switch weapons through the HUD.
  await page.mouse.move(980, 450);
  await page.mouse.down();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 900));
  await page.mouse.up();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 180));

  results.checks.afterFire = await page.evaluate(() => {
    const state = window.__outlands.server.state;
    return {
      rifleAmmo: state.player.weapons.rifle.ammo,
      kills: state.player.kills,
      zombies: state.zombies.length,
      carried: state.player.carriedScrap,
      audioOscillators: window.__outlandsAudioOscillators,
    };
  });

  // Key 3 is the second loadout slot (shotgun); key 2 is the primary rifle.
  await page.keyboard.press('3');
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 220));
  results.checks.weaponSwitch = await page.$eval(
    '.outlands-weapon-switch .outlands-hotbar-slot.is-active',
    (node) => node.getAttribute('title'),
  );
  await page.keyboard.press('2');

  // Hotbar is melee + the two loadout firearms, and the Grid Pack can re-slot a weapon.
  results.checks.loadoutSlots = await page.$$eval('.outlands-weapon-switch button', (nodes) => nodes.length);
  await page.keyboard.press('i');
  await page.waitForSelector('.outlands-loadout-row', { timeout: 4000 });
  await page.$$eval('.outlands-loadout-row', (rows) => {
    const pistol = rows.find((row) => row.textContent?.includes('Python'));
    const buttons = pistol?.querySelectorAll('.outlands-loadout-actions button') ?? [];
    buttons[1]?.click();
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  results.checks.loadoutAssign = await page.evaluate(
    () => window.__outlands.server.state.player.loadout[1],
  );
  await page.keyboard.press('i');

  const buildingEntry = await page.evaluate(() => {
    const server = window.__outlands.server;
    const state = server.state;
    const door = state.map.doors?.[0];
    if (!door) return { ok: false, reason: 'No exterior entrance generated' };
    const input = {
      move: { x: 0, y: 0 },
      aim: { x: 1, y: 0 },
      firing: false,
      reload: false,
      sprint: false,
      interact: false,
    };
    state.player.x = door.x;
    state.player.y = door.y;
    server.step(0.05, { ...input, interact: true });
    const startedOpening = door.state === 'opening' && !state.activeInterior;
    for (let frame = 0; frame < 4; frame += 1) server.step(0.1, input);
    const opened = door.state === 'open';
    server.step(0.05, { ...input, interact: true });
    const entered = Boolean(state.activeInterior);
    const building = state.activeInterior;
    if (building) building.containers = [];
    return {
      startedOpening,
      opened,
      entered,
      interiorId: building?.id ?? null,
    };
  });
  results.checks.buildingFlow = { ...buildingEntry };
  results.shots.interior = join(shotDir, 'outlands-interior-lighting.png');
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  await page.screenshot({ path: results.shots.interior });
  const buildingExit = await page.evaluate(() => {
    const server = window.__outlands.server;
    const state = server.state;
    const interior = state.activeInterior;
    const door = state.map.doors?.find(({ id }) => id === interior?.doorId);
    if (!interior || !door) return { exited: false };
    state.player.x = interior.exitDoor.x;
    state.player.y = interior.exitDoor.y;
    state.player.interactionCooldown = 0;
    server.step(0.05, {
      move: { x: 0, y: 0 },
      aim: { x: 1, y: 0 },
      firing: false,
      reload: false,
      sprint: false,
      interact: true,
    });
    return {
      exited: !state.activeInterior,
      outsidePosition: { x: state.player.x, y: state.player.y },
      exteriorDoorState: door.state,
    };
  });
  Object.assign(results.checks.buildingFlow, buildingExit);
  results.checks.buildingFlow.ok = buildingEntry.startedOpening
    && buildingEntry.opened && buildingEntry.entered && buildingExit.exited;

  results.checks.promptLayout = await page.evaluate(() => {
    const root = document.querySelector('.outlands-root');
    if (!root) return null;
    const dock = document.createElement('div');
    dock.className = 'outlands-feedback-dock';
    const prompt = document.createElement('div');
    prompt.className = 'outlands-container-prompt';
    const icon = document.createElement('span');
    icon.className = 'outlands-prompt-icon';
    const copy = document.createElement('div');
    copy.className = 'outlands-prompt-copy';
    const title = document.createElement('strong');
    title.className = 'outlands-prompt-title';
    title.textContent = 'Abandoned Sedan Trunk';
    const progress = document.createElement('span');
    progress.className = 'outlands-prompt-progress';
    progress.textContent = 'Hold E · Scavenge 50%';
    const button = document.createElement('button');
    button.className = 'outlands-prompt-action';
    button.textContent = '[ Hold E ]';
    copy.append(title, progress);
    prompt.append(icon, copy, button);
    dock.append(prompt);
    root.append(dock);
    const rect = prompt.getBoundingClientRect();
    const style = getComputedStyle(prompt);
    const titleStyle = getComputedStyle(title);
    const buttonRect = button.getBoundingClientRect();
    const result = {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      bottomGap: Math.round(root.getBoundingClientRect().bottom - rect.bottom),
      background: style.backgroundColor,
      nowrapTitle: titleStyle.whiteSpace === 'nowrap',
      truncatedTitle: titleStyle.textOverflow === 'ellipsis',
      buttonHeight: Math.round(buttonRect.height),
    };
    dock.remove();
    return result;
  });

  results.shots.gameplay = join(shotDir, 'outlands-gameplay.png');
  await page.screenshot({ path: results.shots.gameplay });

  // Exercise the death/redeploy UI transition. Combat death is covered by the
  // deterministic engine unit suite; this hook avoids depending on AI timing.
  await page.evaluate(() => window.__outlands.forceDeath());
  await page.waitForSelector('.outlands-modal-dead', { timeout: 5000 });
  results.checks.deathOverlay = await page.$eval('.outlands-death h2', (node) => node.textContent?.trim());
  await page.click('.outlands-death .outlands-deploy');
  await page.waitForFunction(() => window.__outlands.server.state.phase === 'playing');
  results.checks.redeployStash = await page.evaluate(() => window.__outlands.server.state.player.stash);

  // The catalog card is how most players will discover the game.
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-game="outlands"]', { timeout: 10000 });
  results.checks.catalog = await page.$eval('[data-game="outlands"]', (node) => ({
    title: node.querySelector('h3')?.textContent,
    badge: node.querySelector('.lib-card-badge')?.textContent,
    href: node.getAttribute('href'),
  }));
  results.shots.catalog = join(shotDir, 'outlands-catalog.png');
  await page.screenshot({ path: results.shots.catalog });

  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1, hasTouch: true });
  await page.goto(`${base}/outlands`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.outlands-briefing', { timeout: 10000 });
  results.checks.mobileBriefing = await page.evaluate(() => {
    const shell = document.querySelector('.outlands-root')?.getBoundingClientRect();
    const root = document.querySelector('.outlands-root');
    const briefing = document.querySelector('.outlands-briefing');
    const safezoneGrid = briefing?.querySelector('.outlands-safezone-grid');
    const deployButtons = Array.from(briefing?.querySelectorAll('.outlands-safezone-card .outlands-deploy') ?? []);
    return {
      width: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      deployHeight: document.querySelector('.outlands-deploy')?.getBoundingClientRect().height ?? 0,
      logicalHeight: root?.clientHeight ?? 0,
      menuHeight: briefing?.clientHeight ?? 0,
      menuScrollHeight: briefing?.scrollHeight ?? 0,
      menuOverflowY: briefing ? getComputedStyle(briefing).overflowY : '',
      safezoneColumns: safezoneGrid ? getComputedStyle(safezoneGrid).gridTemplateColumns.split(' ').length : 0,
      safezoneOptionCount: deployButtons.length,
      safezoneMinButtonHeight: deployButtons.length
        ? Math.min(...deployButtons.map((button) => button.offsetHeight))
        : 0,
      rotated: getComputedStyle(document.querySelector('.outlands-root')).transform !== 'none',
      shellWidth: Math.round(shell?.width ?? 0),
      shellHeight: Math.round(shell?.height ?? 0),
      shellLeft: Math.round(shell?.left ?? 0),
      shellTop: Math.round(shell?.top ?? 0),
      shellCssWidth: getComputedStyle(document.querySelector('.outlands-root')).width,
      shellCssHeight: getComputedStyle(document.querySelector('.outlands-root')).height,
      shellTransform: getComputedStyle(document.querySelector('.outlands-root')).transform,
    };
  });
  results.shots.mobileBriefing = join(shotDir, 'outlands-mobile-briefing.png');
  await page.screenshot({ path: results.shots.mobileBriefing });

  // Cover compact, standard, and large iPhone CSS viewports. The game shell is
  // rotated in portrait, so its physical bounding box must still fit exactly.
  results.checks.iphoneViewportMatrix = [];
  for (const viewport of [
    { width: 320, height: 568, name: 'compact' },
    { width: 375, height: 667, name: 'standard' },
    { width: 390, height: 844, name: 'notched' },
    { width: 430, height: 932, name: 'large' },
  ]) {
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      hasTouch: true,
    });
    results.checks.iphoneViewportMatrix.push(await page.evaluate((name) => {
      const root = document.querySelector('.outlands-root');
      const rect = root.getBoundingClientRect();
      const briefing = document.querySelector('.outlands-briefing');
      const deployButtons = Array.from(briefing?.querySelectorAll('.outlands-deploy') ?? []);
      return {
        name,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        shellWidth: Math.round(rect.width),
        shellHeight: Math.round(rect.height),
        contained: rect.left >= -1 && rect.top >= -1
          && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        briefingScrolls: briefing ? briefing.scrollHeight <= briefing.clientHeight
          || getComputedStyle(briefing).overflowY === 'auto' : false,
        smallestDeployTarget: deployButtons.length
          ? Math.min(...deployButtons.map((button) => button.getBoundingClientRect().height))
          : 0,
      };
    }, viewport.name));
  }
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 1, hasTouch: true });
  await page.$eval('.outlands-briefing .outlands-deploy', (button) => button.click());
  await page.waitForSelector('.outlands-hud', { timeout: 8000 });
  results.checks.mobileToast = await page.evaluate(() => {
    const toast = document.querySelector('.outlands-banner');
    const dock = toast?.closest('.outlands-feedback-dock');
    return {
      text: toast?.textContent?.trim() ?? '',
      bottomOffset: dock ? Number.parseFloat(getComputedStyle(dock).bottom) : -1,
      animationDuration: toast ? getComputedStyle(toast).animationDuration : '',
    };
  });
  results.checks.directionalSprites = await page.evaluate(() => {
    const { server, renderer } = window.__outlands;
    const player = server.state.player;
    const previousAngle = player.angle;
    const frames = [];
    for (let direction = 0; direction < 8; direction += 1) {
      player.angle = direction * Math.PI / 4;
      renderer.render(server.state, 1 / 60);
      const sprite = renderer.getSpriteDebug();
      frames.push({ direction, octant: sprite?.octant, row: sprite?.row, frame: sprite?.frame });
    }
    player.angle = previousAngle;
    return frames;
  });
  results.checks.mobileHud = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    switchHeight: document.querySelector('.outlands-weapon-switch button')?.getBoundingClientRect().height ?? 0,
  }));
  results.checks.mobileHeader = await page.evaluate(() => {
    const header = document.querySelector('.outlands-topbar');
    const stats = header?.querySelector('.outlands-header-stats');
    const actions = document.querySelector('.outlands-top-actions');
    const actionButtons = Array.from(actions?.querySelectorAll('button') ?? []);
    const groupCenter = stats && actions
      ? (stats.offsetLeft + actions.offsetLeft + actions.offsetWidth) / 2
      : 0;
    return {
      headerHeight: header ? Number.parseFloat(getComputedStyle(header).height) : 0,
      display: header ? getComputedStyle(header).display : '',
      direction: header ? getComputedStyle(header).flexDirection : '',
      wrap: header ? getComputedStyle(header).flexWrap : '',
      actionsWrap: actions ? getComputedStyle(actions).flexWrap : '',
      buttonsOnOneLine: actionButtons.every((button) => button.offsetTop === (actionButtons[0]?.offsetTop ?? button.offsetTop)),
      mapButtonLabel: actions?.querySelector('.outlands-nav-btn')?.getAttribute('aria-label') ?? '',
      hasLibrary: Boolean(header?.textContent?.includes('Library')),
      hasZoneName: Boolean(header?.querySelector('.outlands-zone-pill, .outlands-zone-sub')),
      statCount: header?.querySelectorAll('.outlands-header-stat').length ?? 0,
      groupCenterError: header ? Math.abs(groupCenter - header.clientWidth / 2) : Infinity,
      minActionHeight: actionButtons.length
        ? Math.min(...actionButtons.map((button) => button.getBoundingClientRect().height))
        : 0,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  results.checks.mobileMenus = await checkPhoneMenus(page, 'portrait phone');
  results.checks.mobileCamera = await page.evaluate(() => {
    const { server, renderer } = window.__outlands;
    const p = server.state.player;
    const root = renderer.worldRoot;
    const screen = renderer.app.renderer.screen;
    const zoom = root.scale.x;
    const playerAnchor = {
      x: root.position.x + (p.x - p.y) * 32 * zoom,
      y: root.position.y + (p.x + p.y) * 16 * zoom,
    };
    const body = renderer.playerPaperdoll.baseBodySprite.getBounds();
    return {
      viewport: { width: screen.width, height: screen.height },
      expected: { x: screen.width / 2, y: screen.height / 2 },
      playerAnchor,
      characterCenter: { x: body.x + body.width / 2, y: body.y + body.height / 2 },
    };
  });
  results.shots.mobile = join(shotDir, 'outlands-mobile.png');
  await page.screenshot({ path: results.shots.mobile });

  // The portrait rotation must not leak past the route: leaving /outlands used
  // to keep the whole casino rotated until a reload.
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-game="outlands"]', { timeout: 10000 });
  results.checks.rotationLeak = await page.evaluate(() => ({
    bodyTransform: getComputedStyle(document.body).transform,
    documentWidth: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));

  // Landscape on a phone height is the layout the forced rotation targets.
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto(`${base}/outlands`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.outlands-briefing', { timeout: 10000 });
  await page.$eval('.outlands-briefing .outlands-deploy', (button) => button.click());
  await page.waitForSelector('.outlands-hud', { timeout: 8000 });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 400));
  results.checks.landscape = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const shell = rect('.outlands-root');
    const topbar = rect('.outlands-topbar');
    const bottombar = rect('.outlands-bottombar');
    const deploy = rect('.outlands-deploy');
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      bodyTransform: getComputedStyle(document.body).transform,
      shell: shell ? { width: Math.round(shell.width), height: Math.round(shell.height) } : null,
      topbarTop: topbar ? Math.round(topbar.top) : -1,
      topbarBottom: topbar ? Math.round(topbar.bottom) : -1,
      bottombarTop: bottombar ? Math.round(bottombar.top) : -1,
      bottombarBottom: bottombar ? Math.round(bottombar.bottom) : -1,
      deployHeight: deploy ? Math.round(deploy.height) : 0,
      canvasHeight: Math.round(document.querySelector('.outlands-stage canvas')?.getBoundingClientRect().height ?? 0),
    };
  });
  results.checks.landscapeHeader = await page.evaluate(() => {
    const header = document.querySelector('.outlands-topbar');
    const stats = header?.querySelector('.outlands-header-stats');
    const actions = document.querySelector('.outlands-top-actions');
    const buttons = Array.from(actions?.querySelectorAll('button') ?? []);
    const groupCenter = stats && actions
      ? (stats.offsetLeft + actions.offsetLeft + actions.offsetWidth) / 2
      : 0;
    return {
      headerHeight: header ? Number.parseFloat(getComputedStyle(header).height) : 0,
      display: header ? getComputedStyle(header).display : '',
      direction: header ? getComputedStyle(header).flexDirection : '',
      wrap: header ? getComputedStyle(header).flexWrap : '',
      actionsWrap: actions ? getComputedStyle(actions).flexWrap : '',
      buttonsOnOneLine: buttons.every((button) => button.offsetTop === (buttons[0]?.offsetTop ?? button.offsetTop)),
      mapButtonLabel: actions?.querySelector('.outlands-nav-btn')?.getAttribute('aria-label') ?? '',
      hasLibrary: Boolean(header?.textContent?.includes('Library')),
      hasZoneName: Boolean(header?.querySelector('.outlands-zone-pill, .outlands-zone-sub')),
      statCount: header?.querySelectorAll('.outlands-header-stat').length ?? 0,
      groupCenterError: header ? Math.abs(groupCenter - header.clientWidth / 2) : Infinity,
      minActionHeight: buttons.length
        ? Math.min(...buttons.map((button) => button.offsetHeight))
        : 0,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  results.checks.landscapeMenus = await checkPhoneMenus(page, 'landscape phone');
  results.shots.landscape = join(shotDir, 'outlands-landscape.png');

  // Touch twin-stick: the stick must clear the HUD hotbar and actually walk the survivor.
  results.checks.touchStick = await page.evaluate(() => {
    const stick = document.querySelector('.outlands-touch-stick');
    const bar = document.querySelector('.outlands-weapons-card');
    if (!stick || !bar) return null;
    const s = stick.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    const touchButtons = Array.from(document.querySelectorAll('.outlands-touch-action'))
      .map((button) => button.getBoundingClientRect());
    return {
      size: Math.round(s.width),
      actions: document.querySelectorAll('.outlands-touch-action').length,
      hotbarWidth: Math.round(b.width),
      hotbarHeight: Math.round(b.height),
      overlapsBar: s.right > b.left && s.left < b.right && s.bottom > b.top && s.top < b.bottom,
      hotbarOverlapsTouchActions: touchButtons.some((button) =>
        b.right > button.left && b.left < button.right && b.bottom > button.top && b.top < button.bottom),
      hotbarDockedBottomRight: window.innerHeight - b.bottom < 20
        && window.innerWidth - b.right >= 44 && window.innerWidth - b.right < 80,
      center: { x: Math.round(s.left + s.width / 2), y: Math.round(s.top + s.height / 2) },
      start: (() => {
        const p = window.__outlands.server.state.player;
        return { x: p.x, y: p.y };
      })(),
      touchActionOpacity: Number.parseFloat(getComputedStyle(document.querySelector('.outlands-touch-action')).opacity),
      touchActionSize: Math.round(document.querySelector('.outlands-touch-action').getBoundingClientRect().width),
    };
  });
  if (results.checks.touchStick) {
    const { x, y } = results.checks.touchStick.center;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 46, { steps: 4 });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 900));
    await page.mouse.up();
    results.checks.touchStick.moved = await page.evaluate(
      (start) => {
        const p = window.__outlands.server.state.player;
        return Number(Math.hypot(p.x - start.x, p.y - start.y).toFixed(2));
      },
      results.checks.touchStick.start,
    );
  }
  // The camera must centre the survivor in the band the HUD bars leave free.
  results.checks.camera = await page.evaluate(() => {
    const { server, renderer } = window.__outlands;
    const p = server.state.player;
    const root = renderer.worldRoot;
    const zoom = root.scale.x;
    const screenSize = renderer.app.renderer.screen;
    const body = renderer.playerPaperdoll.baseBodySprite.getBounds();
    const screen = {
      x: root.position.x + (p.x - p.y) * 32 * zoom,
      y: root.position.y + (p.x + p.y) * 16 * zoom,
    };
    return {
      zoom: Number(zoom.toFixed(2)),
      screen: { x: Math.round(screen.x), y: Math.round(screen.y) },
      characterCenter: {
        x: Math.round(body.x + body.width / 2),
        y: Math.round(body.y + body.height / 2),
      },
      expected: {
        x: Math.round(screenSize.width / 2),
        y: Math.round(screenSize.height / 2),
      },
      viewport: { width: screenSize.width, height: screenSize.height },
    };
  });
  await page.screenshot({ path: results.shots.landscape });

  // Simulate the Hosted UI return and Cognito token exchange. React StrictMode
  // double-runs effects in dev; the single-use authorization code must only be
  // exchanged once, then the remembered path and tokens must survive reload.
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluate(() => sessionStorage.setItem('c888_redirect', '/outlands'));
  await page.goto(`${base}/oauth2/callback?code=smoke-authorization-code`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.location.pathname === '/outlands', { timeout: 8000 });
  await page.waitForSelector('.outlands-briefing', { timeout: 8000 });
  results.checks.oauth = await page.evaluate(() => ({
    path: window.location.pathname,
    idTokenStored: localStorage.getItem('c888_id_token')?.startsWith('eyJhbGciOiJub25l') ?? false,
    accessToken: localStorage.getItem('c888_access_token'),
    refreshToken: localStorage.getItem('c888_refresh_token'),
    redirectCleared: sessionStorage.getItem('c888_redirect') === null,
  }));
  results.checks.oauth.tokenRequests = oauthTokenRequests;

  const failures = [];
  if (results.checks.title !== 'Outlands') failures.push('Briefing title missing.');
  if (!results.checks.canvas || results.checks.canvas.width < 100) failures.push('Pixi canvas did not size.');
  if (!results.checks.state || results.checks.state.tier < 1) failures.push('Player stayed inside the S-Zone.');
  if (!results.checks.state || results.checks.state.inSafeZone) failures.push('S-Zone flag did not update.');
  if (!results.checks.buildingFlow?.ok) failures.push('Building entrance, interior transition, or exit flow failed.');
  if (!results.checks.state || results.checks.state.zombies < 1) failures.push('No zombie spawned outside.');
  const expectedDirectionalRows = [1, 2, 3, 4, 5, 6, 7, 0];
  if (!results.checks.directionalSprites
    || results.checks.directionalSprites.length !== 8
    || results.checks.directionalSprites.some((frame, index) =>
      frame.octant !== index || frame.row !== expectedDirectionalRows[index]
        || frame.frame?.width !== 64 || frame.frame?.height !== 64)) {
    failures.push('Player directional animation frames do not map cleanly across all eight directions.');
  }
  if (!results.checks.afterFire || results.checks.afterFire.rifleAmmo >= 30) failures.push('Firing did not spend rifle ammo.');
  if ((results.checks.afterFire?.audioOscillators ?? 0) <= (results.checks.audio?.oscillatorsAtStart ?? -1)) {
    failures.push('Firing did not create a WebAudio sound source.');
  }
  if (!results.checks.weaponSwitch?.includes('Breacher 12g')) failures.push('Weapon switch did not reach the shotgun.');
  if (results.checks.loadoutSlots !== 3) failures.push('Hotbar is not melee + 2 loadout slots.');
  if (results.checks.loadoutAssign !== 'pistol') failures.push('Assigning a weapon to a loadout slot failed.');
  if (!results.checks.promptLayout || results.checks.promptLayout.height > 48
    || results.checks.promptLayout.width > 450 || results.checks.promptLayout.bottomGap < 50
    || !results.checks.promptLayout.nowrapTitle || !results.checks.promptLayout.truncatedTitle
    || results.checks.promptLayout.buttonHeight < 44) {
    failures.push('Interaction prompt is not a slim, bottom-docked horizontal strip.');
  }
  if (results.checks.audio?.contextsCreated < 1) failures.push('Audio context was not created on gameplay deploy.');
  if (results.checks.audio?.mutedStored !== '1') failures.push('Audio mute control did not persist mute state.');
  if (results.checks.audio?.unmutedStored !== '0') failures.push('Audio unmute control did not persist enabled state.');
  for (const key of ['mobileMenus', 'landscapeMenus']) {
    const menus = results.checks[key];
    for (const name of ['pack', 'skills', 'outpost', 'map', 'controls']) {
      const menu = menus?.[name];
      if (!menu?.active) failures.push(`${key}: ${name} menu did not activate.`);
      if ((menu?.bodyScrollWidth ?? 0) > (menu?.bodyWidth ?? 0) + 2) failures.push(`${key}: ${name} menu overflows horizontally.`);
    }
    if (!menus?.pack?.smallItemListVisible) failures.push(`${key}: compact inventory list is hidden.`);
    if (!menus?.pack?.sellConfirmation?.startsWith('Sell ')) failures.push(`${key}: inventory sale confirmation did not open.`);
    if (!menus?.outpost?.marketplaceSearchVisible) failures.push(`${key}: marketplace search is missing.`);
  }
  if (results.checks.deathOverlay !== 'Run terminated') failures.push('Death overlay did not appear.');
  if (results.checks.redeployStash !== 420) failures.push('Redeploy did not preserve the banked stash.');
  if (results.checks.catalog?.title !== 'Outlands') failures.push('Catalog card missing or mislabelled.');
  if (results.checks.catalog?.href !== '/outlands') failures.push('Catalog card points at the wrong route.');
  if (results.checks.mobileBriefing?.documentWidth > results.checks.mobileBriefing?.width) failures.push('Mobile briefing causes horizontal overflow.');
  if (results.checks.mobileHud?.documentWidth > results.checks.mobileHud?.width) failures.push('Mobile HUD causes horizontal overflow.');
  for (const viewport of results.checks.iphoneViewportMatrix ?? []) {
    if (!viewport.contained || viewport.horizontalOverflow || !viewport.briefingScrolls
      || viewport.smallestDeployTarget < 44) {
      failures.push(`iPhone ${viewport.name} viewport clips, overflows, or has inaccessible deploy controls.`);
    }
  }
  if (results.checks.mobileBriefing?.deployHeight < 44) failures.push('Mobile deploy target is smaller than 44px.');
  if (!results.checks.mobileBriefing?.rotated
    || results.checks.mobileBriefing.menuHeight > results.checks.mobileBriefing.logicalHeight
    || results.checks.mobileBriefing.menuOverflowY !== 'auto'
    || results.checks.mobileBriefing.safezoneColumns !== 2
    || results.checks.mobileBriefing.safezoneOptionCount !== 4
    || results.checks.mobileBriefing.safezoneMinButtonHeight < 44) {
    failures.push('Phone welcome menu does not fit, scroll cleanly, and expose all safe-zone choices.');
  }
  if (results.checks.performanceSoak?.ticks !== 2400
    || results.checks.performanceSoak.simulatedSeconds < 79
    || results.checks.performanceSoak.elapsedMs > 15000
    || !results.checks.performanceSoak.finitePlayerPosition
    || !results.checks.performanceSoak.zombieCap
    || results.checks.performanceSoak.activeChunks > 49) {
    failures.push('Outlands performance soak stalled or exceeded bounded world/entity limits.');
  }
  if (results.checks.mobileHud?.switchHeight < 44) failures.push('Mobile weapon target is smaller than 44px.');
  for (const mode of ['mobileHeader', 'landscapeHeader']) {
    const header = results.checks[mode];
    if (header?.display !== 'flex' || header?.direction !== 'row' || header?.wrap !== 'nowrap'
      || header?.actionsWrap !== 'nowrap' || !header?.buttonsOnOneLine || header?.headerHeight > 52) {
      failures.push(`${mode} is not a single compact header row.`);
    }
    if (header?.documentWidth > header?.viewportWidth) failures.push(`${mode} causes horizontal overflow.`);
    if (!header?.mapButtonLabel?.includes('Sector map')) failures.push(`${mode} is missing the accessible map control.`);
    if (header?.hasLibrary || header?.hasZoneName || header?.statCount !== 4) {
      failures.push(`${mode} contains removed header content or is missing compact stats.`);
    }
    if (header?.groupCenterError > 4 || header?.minActionHeight < 40) {
      failures.push(`${mode} topbar group is not centered or its touch controls are too small.`);
    }
  }
  if (!results.checks.mobileToast?.text.startsWith('Deployed to ')) failures.push('Mobile deployment toast missing.');
  if (!results.checks.mobileToast || results.checks.mobileToast.bottomOffset < 40
    || results.checks.mobileToast.bottomOffset > 130 || results.checks.mobileToast.animationDuration !== '3s') {
    failures.push('Mobile deployment toast is not placed and timed as a bottom toast.');
  }
  await page.waitForFunction(() => !document.querySelector('.outlands-banner'), { timeout: 3800 });
  for (const mode of ['mobileCamera', 'camera']) {
    const camera = results.checks[mode];
    const anchor = camera?.playerAnchor ?? camera?.screen;
    if (!anchor || Math.abs(anchor.x - camera.expected.x) > 2
      || Math.abs(anchor.y - camera.expected.y) > 2) {
      failures.push(`${mode} does not center the player's world position.`);
    }
    if (!camera || Math.abs(camera.characterCenter.x - camera.expected.x) > 42
      || Math.abs(camera.characterCenter.y - camera.expected.y) > 42) {
      failures.push(`${mode} does not keep the player character centered in view.`);
    }
  }
  if (results.checks.mobileBriefing?.rotated !== true) failures.push('Portrait phone did not force the landscape shell.');
  if (Math.abs((results.checks.mobileBriefing?.shellWidth ?? 0) - 375) > 8
    || Math.abs((results.checks.mobileBriefing?.shellHeight ?? 0) - 812) > 8
    || Math.abs(results.checks.mobileBriefing?.shellLeft ?? 99) > 8
    || Math.abs(results.checks.mobileBriefing?.shellTop ?? 99) > 8) {
    failures.push('Rotated shell does not fill the portrait viewport.');
  }
  if (results.checks.rotationLeak?.bodyTransform !== 'none') failures.push('Landscape rotation leaks onto other routes.');
  if (results.checks.rotationLeak?.documentWidth > results.checks.rotationLeak?.width) failures.push('Lobby overflows after leaving Outlands.');
  if (results.checks.landscape?.documentWidth > results.checks.landscape?.width) failures.push('Landscape HUD causes horizontal overflow.');
  if (results.checks.landscape?.topbarTop < 0) failures.push('Landscape top bar is off-screen.');
  if (results.checks.landscape?.bottombarBottom > results.checks.landscape?.height) failures.push('Landscape bottom bar is off-screen.');
  if (results.checks.camera?.zoom > 0.9) failures.push('Phone viewport did not receive the wider tactical zoom-out.');
  if (Math.abs((results.checks.camera?.screen?.x ?? 0) - (results.checks.camera?.expected?.x ?? 0)) > 8
    || Math.abs((results.checks.camera?.screen?.y ?? 0) - (results.checks.camera?.expected?.y ?? 0)) > 8) {
    failures.push('Camera does not centre the survivor between the HUD bars.');
  }
  if (!results.checks.touchStick) failures.push('Touch stick missing on a touch viewport.');
  if ((results.checks.touchStick?.size ?? 0) < 84) failures.push('Touch joystick is too small for comfortable phone use.');
  if ((results.checks.touchStick?.center.x ?? 0) < 50
    || (results.checks.touchStick?.center.y ?? 0) > (results.checks.landscape?.height ?? 0) - 50) {
    failures.push('Touch joystick is too close to the screen corner.');
  }
  if (results.checks.touchStick?.actions !== 2) failures.push('Touch action buttons (reload/bandage) missing.');
  if (results.checks.touchStick?.overlapsBar) failures.push('Touch stick overlaps the HUD hotbar.');
  if (results.checks.touchStick?.hotbarOverlapsTouchActions) failures.push('HUD hotbar overlaps touch action buttons.');
  if (!results.checks.touchStick?.hotbarDockedBottomRight) failures.push('HUD hotbar is not docked at the bottom-right beside touch actions.');
  if (results.checks.touchStick?.hotbarHeight > 48) failures.push('HUD hotbar exceeds the 48px compact height target.');
  if ((results.checks.touchStick?.moved ?? 0) < 0.5) failures.push('Touch stick did not walk the survivor.');
  if ((results.checks.touchStick?.touchActionOpacity ?? 0) < 0.4) failures.push('Touch action controls are too faint to see on a phone.');
  if ((results.checks.touchStick?.touchActionSize ?? 0) < 44) failures.push('Phone touch action target is smaller than 44px.');
  if (results.checks.landscape?.deployHeight > 0 && results.checks.landscape?.deployHeight < 44) failures.push('Landscape deploy target is smaller than 44px.');
  if (results.checks.oauth?.path !== '/outlands') failures.push('OAuth callback did not restore the remembered route.');
  if (!results.checks.oauth?.idTokenStored || results.checks.oauth?.accessToken !== 'smoke-access'
    || results.checks.oauth?.refreshToken !== 'smoke-refresh' || !results.checks.oauth?.redirectCleared) {
    failures.push('OAuth callback did not persist the returned tokens and clear its redirect state.');
  }
  if (results.checks.oauth?.tokenRequests !== 1) failures.push('OAuth callback exchanged the authorization code more than once.');
  if (results.consoleErrors.length > 0) failures.push(`Page errors: ${results.consoleErrors.join(' | ')}`);

  results.ok = failures.length === 0;
  results.failures = failures;
  console.log(JSON.stringify(results, null, 2));
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
