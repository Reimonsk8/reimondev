import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appBase = '/games';

/*
 * Static guard, before any browser is launched.
 *
 * Sanctified Ground is drawn TWICE — as a faint tint on the cell, and as a glow
 * in the overlay layer above the grid. When the enemy-Cleric bug was reported
 * fixed, the tint had been corrected and the overlay had not, so the red cross
 * the player actually sees was still there. Nothing about that failure is
 * visible to a rendering test; what made it possible was two definitions of
 * `.sos-zone` in one stylesheet, the later silently winning on source order.
 *
 * So assert the shape of the stylesheet itself: exactly one `.sos-zone` rule, no
 * red in it, and no owner-specific variant. Cheap, and it fails on the mistake
 * rather than on the symptom.
 */
const themeCss = readFileSync(resolve(root, 'frontend/src/styles/theme.css'), 'utf8');

const zoneRules = themeCss.match(/^\.sos-zone\s*\{/gm) || [];
if (zoneRules.length !== 1) {
  throw new Error(
    `Expected exactly one ".sos-zone" rule in theme.css, found ${zoneRules.length}. ` +
      'A later duplicate silently overrides the earlier one at equal specificity, ' +
      'which is how the enemy-Cleric red cross came back.',
  );
}

const zoneBody = themeCss.slice(themeCss.indexOf('.sos-zone {'));
if (/244,\s*63,\s*94|220,\s*38,\s*38/.test(zoneBody.slice(0, zoneBody.indexOf('}')))) {
  throw new Error(
    '".sos-zone" is painted red. Sanctified Ground is a blessing and renders the ' +
      'same for both sides; red is the damaging-spell colour.',
  );
}

// Scan EVERY `.sos-zone` body, not just the first. Testing only the first is
// actively misleading: a second red rule appended below it would pass this
// colour check while being the one that actually renders.
for (const [, body] of themeCss.matchAll(/^\.sos-zone[^{]*\{([^}]*)\}/gm)) {
  if (/244,\s*63,\s*94|220,\s*38,\s*38/.test(body)) {
    throw new Error(
      'A ".sos-zone" rule is painted red. Sanctified Ground is a blessing and ' +
        'renders the same for both sides; red is the damaging-spell colour.',
    );
  }
}

if (/\.sos-zone\.is-mine|\.is-holy-enemy\s*\{/.test(themeCss)) {
  throw new Error(
    'Owner-specific zone styling is back (".sos-zone.is-mine" / ".is-holy-enemy"). ' +
      'Zones must render identically whoever cast them.',
  );
}

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
    'Chrome/Chromium not found. Set PUPPETEER_EXECUTABLE_PATH or CHROME_BIN to run the SoS browser smoke test.',
  );
}

const server = await createServer({
  configFile: resolve(root, 'vite.config.js'),
  server: { host: '127.0.0.1', port: 0 },
});

let browser;
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not expose its local port.');

  browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewport({ width: 1365, height: 900 });
  // Wait for the document only; the game starts loading remote media and large
  // assets after this point, so waiting for network idle is unnecessarily slow.
  await page.goto(`http://127.0.0.1:${address.port}${appBase}/__sos-smoke.html`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('.sos-menu-entry');
  // The title composition uses the web font for its heading dimensions. Wait
  // for the font swap before comparing the nav and heading geometry; otherwise
  // CI can measure the fallback font mid-layout and report a false overlap.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });

  /*
   * The title screen is a composition, and a composition has no rules for a
   * rules test to catch. These four are the ones that actually broke while it
   * was being built, and no unit test would have noticed any of them:
   *
   *  - the artwork starting BELOW the top bar instead of edge to edge,
   *  - the mode list drifting to the middle of the screen,
   *  - the wordmark and the first nav row landing on top of each other,
   *  - the class showcase still sitting on the menu instead of in the draft.
   */
  const titleScreen = await page.evaluate(() => {
    const menu = document.querySelector('.sos-menu');
    const nav = document.querySelector('.sos-menu-nav');
    const block = document.querySelector('.sos-title-block');
    const menuBox = menu.getBoundingClientRect();
    const navBox = nav.getBoundingClientRect();
    const blockBox = block.getBoundingClientRect();
    return {
      // Full bleed: no border, no radius, and flush to the top-left corner.
      flush: menuBox.left === 0 && menuBox.top === 0,
      unframed: getComputedStyle(menu).borderTopWidth === '0px'
        && getComputedStyle(menu).borderTopLeftRadius === '0px',
      // Navigation lives on the left third and sits below the wordmark.
      navOnLeft: navBox.left < window.innerWidth / 3,
      // Allow a couple of CSS pixels for fractional font metrics across OSes;
      // the visual contract is that the two blocks do not meaningfully overlap.
      navBelowTitle: navBox.top + 2 >= blockBox.bottom,
      entries: document.querySelectorAll('.sos-menu-entry').length,
      rosterOnMenu: document.querySelectorAll('.sos-menu .sos-roster-item').length,
    };
  });
  if (
    !titleScreen.flush || !titleScreen.unframed || !titleScreen.navOnLeft ||
    !titleScreen.navBelowTitle || titleScreen.entries !== 3 || titleScreen.rosterOnMenu !== 0
  ) {
    throw new Error(`Main menu is not laid out as a title screen: ${JSON.stringify(titleScreen)}`);
  }
  const navLabels = await page.$$eval('.sos-menu-entry-label', (items) =>
    items.map((item) => item.textContent?.trim() ?? ''),
  );
  if (JSON.stringify(navLabels) !== JSON.stringify(['AI', 'Local Duel', 'Online Duel'])) {
    throw new Error(`The title menu should offer AI, Local Duel, and Online Duel: ${JSON.stringify(navLabels)}`);
  }

  /*
   * Touch scrolling inside the full-bleed game root, as a real gesture.
   *
   * The menu now owns a vertical scroller inside the full-bleed game shell. A
   * scripted scroll would miss the exact touch/compositor regression this guards,
   * so the assertion uses `Input.dispatchTouchEvent` against that scroller.
   */
  const cdp = await page.createCDPSession();
  const touch = (type, y) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: 200, y }],
    });
  const viewportHeight = 915;
  await page.setViewport({ width: 412, height: viewportHeight, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
  await page.evaluate(() => {
    // Guarantee room so this asserts "the gesture works", not "it moved 48px".
    const pad = document.createElement('div');
    pad.style.cssText = 'height:900px;flex:0 0 900px;pointer-events:none';
    document.querySelector('.sos-root').appendChild(pad);
  });
  await touch('touchStart', viewportHeight - 140);
  for (let step = 1; step <= 10; step += 1) {
    await touch('touchMove', Math.round(viewportHeight - 140 + ((140 - (viewportHeight - 140)) * step) / 10));
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  await touch('touchEnd', 140);
  await new Promise((resolve) => setTimeout(resolve, 700));
  const touchScroll = await page.evaluate(() => document.querySelector('.sos-root').scrollTop);
  if (touchScroll < 200) {
    throw new Error(
      `A touch swipe did not scroll the page (moved ${touchScroll}px). ` +
        'The Square of Shadows root did not receive the touch gesture.',
    );
  }
  // Back to the desktop viewport for the rest of the journey.
  await page.setViewport({ width: 1365, height: 900 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sos-menu-entry');

  const responsiveMenu = {};
  for (const viewport of [
    { name: 'portrait', width: 390, height: 844 },
    { name: 'landscape', width: 844, height: 390 },
  ]) {
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
    });
    responsiveMenu[viewport.name] = await page.evaluate(() => {
      const rect = (selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box && {
          left: Math.round(box.left),
          right: Math.round(box.right),
          top: Math.round(box.top),
          bottom: Math.round(box.bottom),
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      };
      const menu = rect('.sos-menu');
      const art = rect('.sos-menu-hero-art');
      const title = rect('.sos-title-block');
      const nav = rect('.sos-menu-nav');
      const buttons = Array.from(document.querySelectorAll('.sos-menu-entry'));
      const menuScrollWidth = document.querySelector('.sos-menu')?.scrollWidth ?? 0;
      return {
        viewport: { width: innerWidth, height: innerHeight },
        menu,
        art,
        title,
        nav,
        buttonCount: buttons.length,
        minButtonHeight: buttons.length
          ? Math.min(...buttons.map((button) => button.getBoundingClientRect().height))
          : 0,
        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth
          && menuScrollWidth <= (document.querySelector('.sos-menu')?.clientWidth ?? 0) + 1,
        header: {
          left: rect('.sos-topbar')?.left,
          audioRight: rect('.sos-audio-bar')?.right,
          audioTop: rect('.sos-audio-bar')?.top,
        },
      };
    });
    const layout = responsiveMenu[viewport.name];
    const portraitOrder = viewport.name !== 'portrait'
      || (layout.art.bottom <= layout.title.top + 1 && layout.title.bottom <= layout.nav.top + 1);
    const landscapeColumns = viewport.name !== 'landscape'
      || (layout.art.left >= layout.title.right - 1 && layout.art.left >= layout.nav.right - 1);
    const contained = [layout.art, layout.title, layout.nav].every((box) =>
      box.left >= -1 && box.right <= viewport.width + 1
        && box.top >= -1 && box.bottom <= viewport.height + 1);
    if (!portraitOrder || !landscapeColumns || !contained || !layout.noHorizontalOverflow
      || layout.buttonCount !== 3 || layout.minButtonHeight < 44
      || layout.header.left > 12 || layout.header.audioTop > 12
      || layout.header.audioRight > viewport.width + 1) {
      throw new Error(`Responsive title menu failed in ${viewport.name}: ${JSON.stringify(layout)}`);
    }
  }
  // Continue the existing desktop interaction checks at their original viewport.
  await page.setViewport({ width: 1365, height: 900, deviceScaleFactor: 1 });

  const menuMusic = await page.evaluate(async (assetBase) => {
    const button = document.querySelector('.sos-sound-trigger');
    const audio = new Audio();
    const tracks = await Promise.all([
      `${assetBase}/audio/square-of-shadows/menu-loop.mp3`,
      `${assetBase}/audio/square-of-shadows/battle-loop.mp3`,
    ].map(async (src) => {
      const response = await fetch(src, { method: 'HEAD' });
      return { src, ok: response.ok, type: response.headers.get('content-type') };
    }));
    return {
      soundIconVisible: !!button,
      // There is nowhere to go back TO on the main menu, so the Menu button is
      // not rendered there at all. Showing it would offer a control that can only
      // ever be a no-op.
      rootBackArrowHidden: !document.querySelector('.sos-topbar .sos-back'),
      canPlayMp3: !!audio.canPlayType('audio/mpeg'),
      tracks,
    };
  }, appBase);
  if (!menuMusic.soundIconVisible || !menuMusic.rootBackArrowHidden || !menuMusic.canPlayMp3 || menuMusic.tracks.some((track) => !track.ok)) {
    throw new Error(`Default menu music or compressed tracks unavailable: ${JSON.stringify(menuMusic)}`);
  }
  await page.click('.sos-sound-trigger');
  await page.waitForSelector('.sos-sound-popover');
  const mix = await page.evaluate(() => ({
    sfxOn: document.querySelector('.sos-sound-toggle[aria-label="Mute sound effects"]')?.getAttribute('aria-pressed'),
    musicOn: document.querySelector('.sos-sound-toggle[aria-label="Mute background music"]')?.getAttribute('aria-pressed'),
    sfxVolume: document.querySelector('#sos-sfx-volume')?.value,
    musicVolume: document.querySelector('#sos-music-volume')?.value,
  }));
  if (mix.sfxOn !== 'true' || mix.musicOn !== 'true' || mix.sfxVolume !== '100' || mix.musicVolume !== '40') {
    throw new Error(`Unexpected default sound mix: ${JSON.stringify(mix)}`);
  }
  await page.focus('#sos-sfx-volume');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('#sos-sfx-volume')?.value === '99');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('#sos-sfx-volume')?.value === '100');
  await page.focus('#sos-music-volume');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('#sos-music-volume')?.value === '41');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('#sos-music-volume')?.value === '40');
  await page.click('.sos-sound-toggle[aria-label="Mute background music"]');
  await page.waitForFunction(() => document.querySelector('.sos-sound-toggle[aria-label="Enable background music"]')?.getAttribute('aria-pressed') === 'false');
  await page.click('.sos-sound-toggle[aria-label="Enable background music"]');
  await page.waitForFunction(() => document.querySelector('.sos-sound-toggle[aria-label="Mute background music"]')?.getAttribute('aria-pressed') === 'true');
  await page.click('.sos-sound-toggle[aria-label="Mute sound effects"]');
  await page.waitForFunction(() => document.querySelector('.sos-sound-toggle[aria-label="Enable sound effects"]')?.getAttribute('aria-pressed') === 'false');
  await page.click('.sos-sound-toggle[aria-label="Enable sound effects"]');
  await page.waitForFunction(() => document.querySelector('.sos-sound-toggle[aria-label="Mute sound effects"]')?.getAttribute('aria-pressed') === 'true');
  await page.click('.sos-sound-trigger');

  /*
   * The draft has a back arrow in the top bar, so a second "Leave match" control
   * under the roster is a duplicate: it sat directly below the faction cards,
   * which are the actual decision on that screen, and competed with them.
   */
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('.sos-menu-entry')).find(
      (b) => b.querySelector('.sos-menu-entry-label')?.textContent?.trim() === 'Local Duel',
    )?.click();
  });
  await page.waitForSelector('.sos-faction-carousel');
  const draftClasses = await page.$$eval('.sos-roster-item strong', (items) =>
    items.map((item) => item.textContent?.trim()),
  );
  const expectedDraftClasses = ['Warrior', 'Wizard', 'Cleric', 'Ranger', 'Paladin', 'Bard', 'Warlock', 'Druid', 'Rogue'];
  if (JSON.stringify(draftClasses) !== JSON.stringify(expectedDraftClasses)) {
    throw new Error(`Faction draft should showcase all nine player classes: ${JSON.stringify(draftClasses)}`);
  }
  const leaveButtons = await page.evaluate(
    () => Array.from(document.querySelectorAll('button'))
      .filter((b) => /leave match/i.test(b.textContent || '')).length,
  );
  if (leaveButtons > 0) {
    throw new Error(
      `The draft still has a "Leave match" button (${leaveButtons}); the top-bar back arrow already does this.`,
    );
  }
  if (!(await page.$('.sos-topbar .sos-back'))) {
    throw new Error('The draft has no back arrow to leave by.');
  }

  // Back from a draft returns to the SoS menu, never browser history.
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('.sos-menu-entry')).find(
      (button) => button.querySelector('.sos-menu-entry-label')?.textContent?.trim() === 'Local Duel',
    )?.click();
  });
  await page.waitForSelector('.sos-faction-carousel');
  // The Menu button exists in the draft (there is a match to leave) and must
  // return us to the main menu — never back into browser history.
  await page.click('.sos-topbar .sos-back');
  await page.waitForSelector('.sos-menu-entry');
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (!(await page.$('.sos-menu-entry'))) {
    throw new Error('Back from the faction draft should stop at the Square of Shadows main menu.');
  }

  // Launch an offline hotseat duel and complete both faction picks.
  await page.evaluate(() => {
    const localDuel = Array.from(document.querySelectorAll('.sos-menu-entry')).find(
      (button) => button.querySelector('.sos-menu-entry-label')?.textContent?.trim() === 'Local Duel',
    );
    if (!localDuel) throw new Error('Local Duel mode card is missing.');
    localDuel.click();
  });
  await page.waitForSelector('.sos-faction-carousel');

  /*
   * Game mode is chosen in the faction draft, and the draft does not render the
   * board — so the option has to be picked HERE, before the factions are chosen
   * and the terrain locks. Arena is the default; switch to Adventure so the
   * decoration checks below have something to look at.
   *
   * (That Arena stays bare is asserted in terrainDecor.test.ts —
   * `groundDecorationForCell` returns null for CLASSIC. It cannot be checked in
   * this journey because the board only appears once the mode is locked.)
   *
   * The labels are asserted by name: they are the product decision here, and a
   * silent rename to "Classic arena"/"Random arena" is exactly what this guards.
   */
  const mapChoice = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('.sos-map-mode-btn'));
    const arena = buttons.find((b) => b.querySelector('strong')?.textContent?.trim() === 'Arena');
    const adventure = buttons.find((b) => b.querySelector('strong')?.textContent?.trim() === 'Adventure');
    return {
      ok: !!arena && !!adventure,
      total: buttons.length,
      arenaActive: arena?.getAttribute('aria-pressed') === 'true',
      // There are exactly two modes and both are playable now. A leftover
      // "In development" badge means a finished feature is still being sold as
      // unfinished.
      anyUnfinished: buttons.some((b) => b.querySelector('.sos-mode-upcoming')),
    };
  });
  if (!mapChoice.ok || mapChoice.total !== 2) {
    throw new Error(
      `Expected exactly two game modes (Arena, Adventure), found ${mapChoice.total}: ${JSON.stringify(mapChoice)}`,
    );
  }
  if (!mapChoice.arenaActive) {
    throw new Error('Arena should be the default game mode.');
  }
  if (mapChoice.anyUnfinished) {
    throw new Error('Neither Arena nor Adventure is unfinished any more.');
  }
  await page.evaluate(() => {
    const adventure = Array.from(document.querySelectorAll('.sos-map-mode-btn')).find(
      (b) => b.querySelector('strong')?.textContent?.trim() === 'Adventure',
    );
    adventure?.click();
  });

  const draftOneFaction = async () => {
    await page.waitForSelector('.sos-draft-squad');
    await page.evaluate(() => {
      const heading = document.querySelector('.sos-draft-squad-title')?.textContent?.trim();
      const sprites = document.querySelectorAll('.sos-faction-carousel .sos-faction-portrait i').length;
      if (!heading?.includes('(4/4)') || sprites !== 4) {
        throw new Error(`Expected a randomized four-unit default roster, found ${heading} and ${sprites} sprites.`);
      }
      const confirm = Array.from(document.querySelectorAll('.sos-draft-squad button'))
        .find((button) => button.textContent?.includes('Confirm Squad'));
      confirm?.click();
    });
  };
  await draftOneFaction();
  await page.waitForSelector('.sos-faction-carousel');
  await draftOneFaction();
  await page.waitForSelector('.sos-board-layout', { timeout: 5000 });

  const mobileChronicleDock = {};
  for (const viewport of [
    { name: 'portrait', width: 390, height: 844 },
    { name: 'landscape', width: 844, height: 390 },
  ]) {
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
    });
    mobileChronicleDock[viewport.name] = await page.evaluate(() => {
      const box = (selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect && {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      };
      const chronicle = box('.sos-slot-log');
      const controls = box('.sos-chronicle-controls');
      const brand = box('.sos-chronicle-brand');
      const audio = box('.sos-chronicle-audio');
      const turn = box('.sos-turn-tab');
      const fold = document.querySelector('.sos-rail-fold');
      return {
        viewport: { width: innerWidth, height: innerHeight },
        chronicle,
        controls,
        brand,
        audio,
        turn,
        foldExists: !!fold,
        mobileFooterExists: !!document.querySelector('.sos-mobile-control-bar'),
        controlsInsideChronicle: !!document.querySelector('.sos-slot-log .sos-chronicle-controls'),
        debugPresence: Object.fromEntries(['.sos-root', '.sos-topbar .sos-back', '.sos-board-layout', '.sos-faction-draft', '.sos-rail-right', '.sos-slot-log'].map((selector) => [selector, !!document.querySelector(selector)])),
        text: document.querySelector('.sos-root')?.innerText.slice(0, 280),
        turnCenterError: turn ? Math.abs((turn.left + turn.right) / 2 - innerWidth / 2) : Infinity,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    const layout = mobileChronicleDock[viewport.name];
    if (!layout.chronicle || !layout.controls || !layout.brand || !layout.audio
      || !layout.foldExists || !layout.controlsInsideChronicle || layout.mobileFooterExists
      || layout.controls.bottom > layout.chronicle.bottom + 1
      || layout.controls.bottom < layout.chronicle.bottom - 80
      || layout.turnCenterError > 2 || layout.horizontalOverflow) {
      throw new Error(`Mobile Chronicle controls are not docked inside the panel in ${viewport.name}: ${JSON.stringify(layout)}`);
    }
    await page.click('.sos-rail-fold');
    const folded = await page.evaluate(() => ({
      bodyHidden: getComputedStyle(document.querySelector('.sos-combat-log')).display === 'none',
      controlsVisible: document.querySelector('.sos-chronicle-controls').getBoundingClientRect().height > 0,
    }));
    if (!folded.bodyHidden || !folded.controlsVisible) {
      throw new Error(`Folding the Chronicle hid its persistent controls in ${viewport.name}: ${JSON.stringify(folded)}`);
    }
    await page.click('.sos-rail-fold');
  }
  await page.setViewport({ width: 1365, height: 900, deviceScaleFactor: 1 });

  /*
   * Map size: six square camera windows, inline beside the "Tactical map"
   * title in the left panel head.
   *
   * These helpers are reused for the Arena pass at the end. The view is a
   * local rendering choice, so the DOM cell count/grid tracks are the actual
   * contract — a state test cannot see them.
   */
  const selectMapSize = async (size) => {
    const found = await page.evaluate((wantedSize) => {
      const slider = document.querySelector('.sos-unit-range');
      if (!slider) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(slider, String(wantedSize));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, size);
    if (!found) throw new Error(`Map size ${size}x${size} option is missing.`);
    await page.waitForFunction(
      (expected) => document.querySelectorAll('.sos-cell').length === expected,
      {},
      size * size,
    );
  };

  const readBoardShape = () => page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.sos-cell'));
    const board = document.querySelector('.sos-board');
    const box = board.getBoundingClientRect();
    const cols = getComputedStyle(board).gridTemplateColumns.split(' ').length;
    const rows = getComputedStyle(board).gridTemplateRows.split(/\s+/).length;
    const selected = cells.findIndex((cell) => cell.querySelector('.sos-unit.is-selected'));
    return {
      cells: cells.length,
      cols,
      rows,
      voidCells: document.querySelectorAll('.sos-cell.is-void').length,
      unitCount: document.querySelectorAll('.sos-cell .sos-unit').length,
      selectedRow: selected === -1 ? null : Math.floor(selected / cols),
      selectedCol: selected === -1 ? null : selected % cols,
      width: box.width,
      height: box.height,
      pannable: board.classList.contains('is-pannable'),
      firstLabel: document.querySelector('.sos-cell')?.getAttribute('aria-label') ?? '',
    };
  });

  const assertViewShape = (shape, size, label) => {
    if (shape.cells !== size * size || shape.cols !== size || shape.rows !== size) {
      throw new Error(`${label} should draw a ${size}x${size} window: ${JSON.stringify(shape)}`);
    }
    if (shape.voidCells !== 0) {
      throw new Error(`${label} draws void tiles past the map edge: ${JSON.stringify(shape)}`);
    }
    if (Math.abs(shape.width / shape.height - 1) > 0.02) {
      throw new Error(`${label} is not square: ${JSON.stringify(shape)}`);
    }
    if (shape.unitCount === 0) {
      throw new Error(`${label} opened on an empty view: ${JSON.stringify(shape)}`);
    }
    if (
      shape.selectedRow !== null &&
      (shape.selectedRow < 0 || shape.selectedRow >= shape.rows ||
        shape.selectedCol < 0 || shape.selectedCol >= shape.cols)
    ) {
      throw new Error(`${label} scrolled its selected unit off screen: ${JSON.stringify(shape)}`);
    }
  };

  /*
   * Drag-to-pan. A 5x5 window cannot show a Ranger's whole firing lane, so the
   * board itself has to move without ever revealing void past the floor.
   *
   * `maxX` is the largest legal window origin on that axis (floor width minus
   * the 5-wide window). Pick a direction that can actually move: drag left to
   * push the window right, drag down to push it up, and only fall back to the
   * other direction when both of those are already at their limits.
   */
  const dragCamera = async ({ maxX, expectedCells, label }) => {
    const before = await readBoardShape();
    const dragFrom = await page.evaluate(() => {
      const cell = document.querySelector('.sos-cell:not(.is-wall):not(:disabled)');
      const first = document.querySelector('.sos-cell');
      if (!cell || !first) return null;
      const cellBox = cell.getBoundingClientRect();
      const match = (first.getAttribute('aria-label') ?? '').match(/Tile (\d+),(\d+)/);
      return {
        x: Number(match?.[1]),
        y: Number(match?.[2]),
        startX: cellBox.left + cellBox.width / 2,
        startY: cellBox.top + cellBox.height / 2,
        cellWidth: cellBox.width,
      };
    });
    if (!dragFrom) throw new Error(`${label}: could not find a tile to start the camera drag on.`);
    let dragX = 0;
    let dragY = 0;
    if (dragFrom.x < maxX) dragX = -dragFrom.cellWidth * 2;
    else if (dragFrom.y > 0) dragY = dragFrom.cellWidth * 2;
    else dragX = dragFrom.cellWidth * 2;
    await page.mouse.move(dragFrom.startX, dragFrom.startY);
    await page.mouse.down();
    await page.mouse.move(dragFrom.startX + dragX, dragFrom.startY + dragY, { steps: 8 });
    await page.mouse.up();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const after = await readBoardShape();
    if (after.cells !== expectedCells || after.voidCells !== 0) {
      throw new Error(`${label}: dragging broke the window bounds: ${JSON.stringify(after)}`);
    }
    if (after.firstLabel === before.firstLabel) {
      throw new Error(`${label}: dragging did not pan the camera: ${JSON.stringify({ before: before.firstLabel, after: after.firstLabel })}`);
    }
    // The recentre action must put the window back on the selected unit, not
    // merely clear the drag state while leaving the floor off-centre.
    await page.waitForSelector('.sos-map-size-btn.is-recentre');
    await page.click('.sos-map-size-btn.is-recentre');
    await page.waitForFunction(() => !document.querySelector('.sos-map-size-btn.is-recentre'));
    const recentred = await readBoardShape();
    if (recentred.firstLabel !== before.firstLabel || recentred.voidCells !== 0) {
      throw new Error(`${label}: recentre did not restore the focused window: ${JSON.stringify({ before: before.firstLabel, recentred: recentred.firstLabel, voidCells: recentred.voidCells })}`);
    }
    return after;
  };

  const mapSizeUi = await page.evaluate(() => {
    const control = document.querySelector('.sos-panel-head .sos-map-size');
    const slider = document.querySelector('.sos-unit-range');
    return {
      present: !!control && !!slider,
      min: slider?.min,
      max: slider?.max,
      step: slider?.step,
      value: slider?.value,
      output: document.querySelector('.sos-map-size-readout output')?.textContent?.trim(),
    };
  });
  if (!mapSizeUi.present || mapSizeUi.min !== '3' || mapSizeUi.max !== '11' || mapSizeUi.step !== '1') {
    throw new Error(`Tactical range slider must span 3–11 in single steps: ${JSON.stringify(mapSizeUi)}`);
  }
  if (mapSizeUi.value !== '10' || !mapSizeUi.output.includes('10')) {
    throw new Error(`Tactical range slider must default to 10: ${JSON.stringify(mapSizeUi)}`);
  }

  assertViewShape(await readBoardShape(), 10, 'Adventure default 10x10');

  await selectMapSize(3);
  assertViewShape(await readBoardShape(), 3, 'Adventure 3x3');

  await selectMapSize(5);
  const fiveByFive = await readBoardShape();
  assertViewShape(fiveByFive, 5, 'Adventure 5x5');
  if (!fiveByFive.pannable) throw new Error('A 5x5 window over the 20x20 floor must be pannable.');

  /*
   * Drag-to-pan. A 5x5 window cannot show a Ranger's whole firing lane, so the
   * board itself has to move without ever revealing void past the floor.
   */
  const dragFrom = await page.evaluate(() => {
    const cell = document.querySelector('.sos-cell:not(.is-wall):not(:disabled)');
    const board = document.querySelector('.sos-board');
    const first = document.querySelector('.sos-cell');
    if (!cell || !board || !first) return null;
    const cellBox = cell.getBoundingClientRect();
    const boardBox = board.getBoundingClientRect();
    const match = (first.getAttribute('aria-label') ?? '').match(/Tile (\d+),(\d+)/);
    return {
      x: Number(match?.[1]),
      y: Number(match?.[2]),
      startX: cellBox.left + cellBox.width / 2,
      startY: cellBox.top + cellBox.height / 2,
      cellWidth: cellBox.width,
      boardWidth: boardBox.width,
    };
  });
  if (!dragFrom) throw new Error('Could not find a tile to start the camera drag on.');
  let dragX = 0;
  let dragY = 0;
  if (dragFrom.x < 15) dragX = -dragFrom.cellWidth * 2;
  else if (dragFrom.y > 0) dragY = dragFrom.cellWidth * 2;
  else dragX = dragFrom.cellWidth * 2;
  await page.mouse.move(dragFrom.startX, dragFrom.startY);
  await page.mouse.down();
  await page.mouse.move(dragFrom.startX + dragX, dragFrom.startY + dragY, { steps: 8 });
  await page.mouse.up();
  await new Promise((resolve) => setTimeout(resolve, 120));
  const afterDrag = await readBoardShape();
  if (afterDrag.cells !== 25 || afterDrag.voidCells !== 0) {
    throw new Error(`Dragging a 5x5 camera broke the window bounds: ${JSON.stringify(afterDrag)}`);
  }
  if (afterDrag.firstLabel === fiveByFive.firstLabel) {
    throw new Error(`Dragging did not pan the camera: ${JSON.stringify({ before: fiveByFive.firstLabel, after: afterDrag.firstLabel })}`);
  }

  for (const size of [7, 10, 9]) {
    await selectMapSize(size);
    assertViewShape(await readBoardShape(), size, `Adventure ${size}x${size}`);
  }

  /*
   * The camera window. Adventure is a 20x20 floor drawn through the selected
   * window, so the DOM holds 81 cells once 9x9 is selected whatever the real
   * board is — that mismatch is the whole point of the feature and it is
   * invisible to a rules test, so assert the rendered shape directly.
   */
  const camera = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.sos-cell'));
    const board = document.querySelector('.sos-board');
    const colCount = getComputedStyle(board).gridTemplateColumns.split(' ').length;
    const selected = cells.findIndex((c) => c.querySelector('.sos-unit.is-selected'));
    return {
      cells: cells.length,
      cols: colCount,
      // The camera is clamped to the floor, so space past the map edge must be
      // impossible even when the focused hero stands in a corner.
      voidCells: document.querySelectorAll('.sos-cell.is-void').length,
      selectedRow: selected === -1 ? null : Math.floor(selected / colCount),
      selectedCol: selected === -1 ? null : selected % colCount,
    };
  });
  if (camera.cells !== 81 || camera.cols !== 9) {
    throw new Error(`Adventure should draw a 9x9 camera window over its 20x20 floor: ${JSON.stringify(camera)}`);
  }
  /*
   * Camera is clamped to the floor; no void tiles past the map.
   */
  if (camera.voidCells !== 0) {
    throw new Error(
      `The clamped camera must never draw void tiles past the map edge: ${JSON.stringify(camera)}`,
    );
  }
  if (camera.selectedRow === null) {
    throw new Error(`No unit is selected at the start of an adventure turn: ${JSON.stringify(camera)}`);
  }
  for (const [axis, value] of [['row', camera.selectedRow], ['col', camera.selectedCol]]) {
    if (value < 0 || value > 8) {
      throw new Error(
        `The selected hero is off the drawn ${camera.cols}-wide view at ${axis} ${value}: ${JSON.stringify(camera)}`,
      );
    }
  }

  /*
   * Free-camera minimap.
   *
   * Deselecting must swap the Selected Unit box for a live canvas overview and
   * leave the camera exactly where it was. Clicking the overview and clicking a
   * board tile must both centre the main camera; the minimap red outline is the
   * visible proof that the two stay in sync. None of this is a rules change, so
   * it has to be asserted in the browser rather than in the engine suite.
   */
  const freeNavBefore = await page.evaluate(() => {
    const label = document.querySelector('.sos-cell')?.getAttribute('aria-label') ?? '';
    const match = label.match(/Tile (\d+),(\d+)/);
    return {
      present: !!document.querySelector('.sos-free-nav-btn'),
      active: document.querySelector('.sos-free-nav-btn')?.getAttribute('aria-pressed') === 'true',
      minimap: !!document.querySelector('.sos-minimap'),
      selectedPanel: !!document.querySelector('.sos-selected'),
      selectedUnits: document.querySelectorAll('.sos-unit.is-selected').length,
      title: document.querySelector('.sos-slot-unit .sos-panel-title')?.textContent?.trim() ?? '',
      origin: match ? { x: Number(match[1]), y: Number(match[2]) } : null,
    };
  });
  if (!freeNavBefore.present) throw new Error('The Free Nav control is missing from Squad Shortcuts.');
  if (freeNavBefore.active || freeNavBefore.minimap) {
    throw new Error(`Free Nav should be inactive while a unit is selected: ${JSON.stringify(freeNavBefore)}`);
  }

  await page.click('.sos-free-nav-btn');
  await page.waitForSelector('.sos-minimap');
  await page.waitForFunction(
    () => document.querySelector('.sos-free-nav-btn')?.getAttribute('aria-pressed') === 'true',
  );

  const freeNav = await page.evaluate(() => {
    const map = document.querySelector('.sos-minimap-map');
    const canvas = document.querySelector('.sos-minimap-canvas');
    const viewport = document.querySelector('.sos-minimap-viewport');
    const board = document.querySelector('.sos-board');
    const mapBox = map?.getBoundingClientRect();
    const viewportBox = viewport?.getBoundingClientRect();
    const viewportStyle = viewport ? getComputedStyle(viewport) : null;
    const label = document.querySelector('.sos-cell')?.getAttribute('aria-label') ?? '';
    const match = label.match(/Tile (\d+),(\d+)/);
    return {
      title: document.querySelector('.sos-slot-unit .sos-panel-title')?.textContent?.trim() ?? '',
      origin: match ? { x: Number(match[1]), y: Number(match[2]) } : null,
      minimap: !!map,
      selectedPanel: !!document.querySelector('.sos-selected'),
      selectedUnits: document.querySelectorAll('.sos-unit.is-selected').length,
      freeNavActive: document.querySelector('.sos-free-nav-btn')?.getAttribute('aria-pressed') === 'true',
      mapRole: map?.getAttribute('role') ?? '',
      mapLabel: map?.getAttribute('aria-label') ?? '',
      mapWidth: mapBox?.width ?? 0,
      mapHeight: mapBox?.height ?? 0,
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      viewportWidth: viewportBox?.width ?? 0,
      viewportHeight: viewportBox?.height ?? 0,
      viewportLeft: viewportBox?.left ?? 0,
      viewportTop: viewportBox?.top ?? 0,
      mapLeft: mapBox?.left ?? 0,
      mapTop: mapBox?.top ?? 0,
      viewportBorderWidth: viewportStyle?.borderTopWidth ?? '',
      viewportBorderStyle: viewportStyle?.borderTopStyle ?? '',
      viewportBorderColor: viewportStyle?.borderTopColor ?? '',
      boardCells: document.querySelectorAll('.sos-cell').length,
      boardFreeNav: board?.classList.contains('is-free-nav') ?? false,
      voidCells: document.querySelectorAll('.sos-cell.is-void').length,
    };
  });
  if (
    !freeNav.minimap || freeNav.selectedPanel || freeNav.selectedUnits !== 0 ||
    !freeNav.freeNavActive || freeNav.title !== 'Tactical map'
  ) {
    throw new Error(`Free Nav did not swap the left panel for the minimap: ${JSON.stringify(freeNav)}`);
  }
  if (
    !freeNavBefore.origin || !freeNav.origin ||
    freeNavBefore.origin.x !== freeNav.origin.x ||
    freeNavBefore.origin.y !== freeNav.origin.y
  ) {
    throw new Error(
      `Free Nav should preserve the camera window when it deselects: ${JSON.stringify({ before: freeNavBefore.origin, after: freeNav.origin })}`,
    );
  }
  if (process.env.SOS_SMOKE_FREE_NAV_SCREENSHOT) {
    await page.screenshot({ path: process.env.SOS_SMOKE_FREE_NAV_SCREENSHOT });
  }
  if (freeNav.boardCells !== 81 || freeNav.voidCells !== 0 || !freeNav.boardFreeNav) {
    throw new Error(`Free Nav changed the camera window or filled it with void tiles: ${JSON.stringify(freeNav)}`);
  }
  if (
    freeNav.mapWidth < 80 || freeNav.mapHeight < 80 ||
    Math.abs(freeNav.mapWidth - freeNav.mapHeight) > 2 ||
    freeNav.canvasWidth <= 0 || freeNav.canvasHeight <= 0
  ) {
    throw new Error(`The minimap did not render a square 20x20 floor: ${JSON.stringify(freeNav)}`);
  }
  if (
    freeNav.viewportWidth <= 0 || freeNav.viewportHeight <= 0 ||
    freeNav.viewportWidth > freeNav.mapWidth + 1 ||
    freeNav.viewportHeight > freeNav.mapHeight + 1 ||
    freeNav.viewportLeft < freeNav.mapLeft - 1 ||
    freeNav.viewportTop < freeNav.mapTop - 1 ||
    freeNav.viewportBorderWidth !== '2px' ||
    freeNav.viewportBorderStyle !== 'solid' ||
    !/255,\s*77,\s*77/.test(freeNav.viewportBorderColor)
  ) {
    throw new Error(`The minimap camera outline is missing or outside its preview: ${JSON.stringify(freeNav)}`);
  }

  const readBoardOrigin = () => page.evaluate(() => {
    const label = document.querySelector('.sos-cell')?.getAttribute('aria-label') ?? '';
    const match = label.match(/Tile (\d+),(\d+)/);
    return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
  });
  const readMinimapBox = () => page.$eval('.sos-minimap-map', (element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width, height: box.height };
  });
  const readViewportPercent = () => page.evaluate(() => {
    const style = document.querySelector('.sos-minimap-viewport')?.style;
    return {
      left: parseFloat(style?.left ?? 'NaN'),
      top: parseFloat(style?.top ?? 'NaN'),
      width: parseFloat(style?.width ?? 'NaN'),
      height: parseFloat(style?.height ?? 'NaN'),
    };
  });
  const waitForOrigin = (origin) => page.waitForFunction(
    (expected) => {
      const label = document.querySelector('.sos-cell')?.getAttribute('aria-label') ?? '';
      return label.startsWith(`Tile ${expected.x},${expected.y}`);
    },
    {},
    origin,
  );

  /*
   * Minimap click. Pick the far side of the floor from the current window so
   * the camera is guaranteed to move, then assert both the board origin and the
   * red outline (9/20 of the map, at the new origin).
   */
  const beforeMinimapClick = await readBoardOrigin();
  if (!beforeMinimapClick) throw new Error('Could not read the camera origin before the minimap click.');
  const minimapBox = await readMinimapBox();
  const targetTile = {
    x: beforeMinimapClick.x < 6 ? 16 : 4,
    y: beforeMinimapClick.y < 6 ? 16 : 4,
  };
  const expectedClickOrigin = {
    x: Math.max(0, Math.min(targetTile.x - 4, 11)),
    y: Math.max(0, Math.min(targetTile.y - 4, 11)),
  };
  await page.mouse.click(
    minimapBox.left + minimapBox.width * ((targetTile.x + 0.5) / 20),
    minimapBox.top + minimapBox.height * ((targetTile.y + 0.5) / 20),
  );
  await waitForOrigin(expectedClickOrigin);
  await new Promise((resolve) => setTimeout(resolve, 140));
  const clickedViewport = await readViewportPercent();
  if (
    Math.abs(clickedViewport.left - (expectedClickOrigin.x / 20) * 100) > 0.05 ||
    Math.abs(clickedViewport.top - (expectedClickOrigin.y / 20) * 100) > 0.05 ||
    Math.abs(clickedViewport.width - 45) > 0.05 ||
    Math.abs(clickedViewport.height - 45) > 0.05
  ) {
    throw new Error(
      `Minimap click did not move the camera outline with the board: ${JSON.stringify({ expectedClickOrigin, clickedViewport })}`,
    );
  }
  const afterMinimapClick = await readBoardOrigin();
  if (!afterMinimapClick || afterMinimapClick.x !== expectedClickOrigin.x || afterMinimapClick.y !== expectedClickOrigin.y) {
    throw new Error(`Minimap click did not centre the board: ${JSON.stringify({ expectedClickOrigin, afterMinimapClick })}`);
  }

  /*
   * Minimap drag. Start in the middle and sweep to the far side; the last
   * pointer position is the camera target, so the final origin must be the
   * clamped centre of that tile, not the starting one.
   */
  const beforeMinimapDrag = await readBoardOrigin();
  if (!beforeMinimapDrag) throw new Error('Could not read the camera origin before the minimap drag.');
  const dragTile = {
    x: beforeMinimapDrag.x < 6 ? 16 : 4,
    y: beforeMinimapDrag.y < 6 ? 16 : 4,
  };
  const expectedDragOrigin = {
    x: Math.max(0, Math.min(dragTile.x - 4, 11)),
    y: Math.max(0, Math.min(dragTile.y - 4, 11)),
  };
  await page.mouse.move(
    minimapBox.left + minimapBox.width / 2,
    minimapBox.top + minimapBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    minimapBox.left + minimapBox.width * ((dragTile.x + 0.5) / 20),
    minimapBox.top + minimapBox.height * ((dragTile.y + 0.5) / 20),
    { steps: 8 },
  );
  await page.mouse.up();
  await waitForOrigin(expectedDragOrigin);
  await new Promise((resolve) => setTimeout(resolve, 140));
  const draggedViewport = await readViewportPercent();
  if (
    Math.abs(draggedViewport.left - (expectedDragOrigin.x / 20) * 100) > 0.05 ||
    Math.abs(draggedViewport.top - (expectedDragOrigin.y / 20) * 100) > 0.05
  ) {
    throw new Error(
      `Minimap drag did not move the camera outline with the board: ${JSON.stringify({ expectedDragOrigin, draggedViewport })}`,
    );
  }

  /*
   * Main-board click while no unit is selected. Find a visible tile whose
   * centred window differs from the current one, click it, and let the eased
   * tile-step tween finish. It must move the camera without selecting a unit or
   * closing the minimap.
   */
  const boardClickTarget = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.sos-cell:not(.is-void)'));
    const first = cells[0];
    const firstMatch = (first?.getAttribute('aria-label') ?? '').match(/Tile (\d+),(\d+)/);
    if (!firstMatch) return null;
    const origin = { x: Number(firstMatch[1]), y: Number(firstMatch[2]) };
    const candidates = cells
      .map((cell) => {
        const match = (cell.getAttribute('aria-label') ?? '').match(/Tile (\d+),(\d+)/);
        if (!match) return null;
        const x = Number(match[1]);
        const y = Number(match[2]);
        const expected = {
          x: Math.max(0, Math.min(x - 4, 11)),
          y: Math.max(0, Math.min(y - 4, 11)),
        };
        if (expected.x === origin.x && expected.y === origin.y) return null;
        const box = cell.getBoundingClientRect();
        return {
          startX: box.left + box.width / 2,
          startY: box.top + box.height / 2,
          expected,
          distance: Math.abs(expected.x - origin.x) + Math.abs(expected.y - origin.y),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.distance - a.distance);
    return candidates[0] ?? null;
  });
  if (!boardClickTarget) throw new Error('Could not find a board tile that moves the free camera.');
  await page.mouse.click(boardClickTarget.startX, boardClickTarget.startY);
  await waitForOrigin(boardClickTarget.expected);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const afterBoardClick = await page.evaluate(() => ({
    selectedUnits: document.querySelectorAll('.sos-unit.is-selected').length,
    minimap: !!document.querySelector('.sos-minimap'),
    freeNavActive: document.querySelector('.sos-free-nav-btn')?.getAttribute('aria-pressed') === 'true',
    viewport: (() => {
      const style = document.querySelector('.sos-minimap-viewport')?.style;
      return { left: parseFloat(style?.left ?? 'NaN'), top: parseFloat(style?.top ?? 'NaN') };
    })(),
  }));
  if (
    afterBoardClick.selectedUnits !== 0 || !afterBoardClick.minimap ||
    !afterBoardClick.freeNavActive ||
    Math.abs(afterBoardClick.viewport.left - (boardClickTarget.expected.x / 20) * 100) > 0.05 ||
    Math.abs(afterBoardClick.viewport.top - (boardClickTarget.expected.y / 20) * 100) > 0.05
  ) {
    throw new Error(
      `A free-camera board click should pan, not select or close the minimap: ${JSON.stringify({ boardClickTarget, afterBoardClick })}`,
    );
  }

  /*
   * Adventure's two Altars of Shadows.
   *
   * They stand at seeded positions, so the camera cannot be trusted to contain
   * one — let alone both. Free Nav is the only state that draws the whole 20x20
   * minimap, so the sweep lives here: select the 10x10 window, click the four
   * quadrant centres of the minimap (two 10-wide stops per axis cover the floor
   * exactly) and collect every monument tile that appears.
   *
   * Both altars share one soul count but must NOT share a sprite; that is the
   * half of this feature only the renderer can get wrong.
   */
  await selectMapSize(10);
  assertViewShape(await readBoardShape(), 10, 'Adventure 10x10 altar sweep window');
  const adventureAltars = new Map();
  for (const target of [{ x: 2, y: 2 }, { x: 17, y: 2 }, { x: 2, y: 17 }, { x: 17, y: 17 }]) {
    const box = await page.$eval('.sos-minimap-map', (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    await page.mouse.click(
      box.left + box.width * ((target.x + 0.5) / 20),
      box.top + box.height * ((target.y + 0.5) / 20),
    );
    const expectedOrigin = {
      x: Math.max(0, Math.min(target.x - 5, 10)),
      y: Math.max(0, Math.min(target.y - 5, 10)),
    };
    await waitForOrigin(expectedOrigin);
    const seen = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.sos-cell.is-altar')).map((cell) => ({
        label: cell.getAttribute('aria-label') ?? '',
        plinth: cell.classList.contains('is-altar-plinth'),
        quadrants: cell.querySelectorAll('.sos-altar-quad').length,
        sprite: cell.querySelector('.sos-altar-quad')?.style.backgroundImage ?? '',
      })),
    );
    for (const tile of seen) adventureAltars.set(tile.label, tile);
  }
  await selectMapSize(9);
  const adventureAltarTiles = [...adventureAltars.values()];
  const adventureSprites = new Set(adventureAltarTiles.map((tile) => tile.sprite));
  if (adventureAltarTiles.length !== 8) {
    throw new Error(
      `Adventure must hold two 2x2 altars (8 tiles), found ${adventureAltarTiles.length}: ${JSON.stringify([...adventureAltars.keys()])}`,
    );
  }
  if (adventureAltarTiles.filter((tile) => tile.plinth).length !== 4) {
    throw new Error('Each Adventure altar must draw its bottom row as floor.');
  }
  if (adventureAltarTiles.some((tile) => tile.quadrants !== 1)) {
    throw new Error('An altar tile must paint exactly one quadrant of its monument.');
  }
  if (adventureSprites.size !== 2) {
    throw new Error(`Adventure's two altars must use different monuments, got ${adventureSprites.size}.`);
  }
  if (![...adventureSprites].every((sprite) => /sos-altar-monuments\/altar-\d\d\.png/.test(sprite))) {
    throw new Error(`Adventure altars must draw the monument set, got ${JSON.stringify([...adventureSprites])}`);
  }

  // Restore the normal selected-unit panel for the remainder of the journey.
  await page.click('.sos-squad-btn:not(:disabled)');
  await page.waitForSelector('.sos-selected');
  await page.waitForFunction(() => !document.querySelector('.sos-minimap'));
  const reselected = await page.evaluate(() => ({
    title: document.querySelector('.sos-slot-unit .sos-panel-title')?.textContent?.trim() ?? '',
    selectedUnits: document.querySelectorAll('.sos-unit.is-selected').length,
    minimap: !!document.querySelector('.sos-minimap'),
  }));
  if (
    reselected.title !== 'Selected unit' || reselected.selectedUnits !== 1 || reselected.minimap
  ) {
    throw new Error(`Selecting a squad member did not restore the unit panel: ${JSON.stringify(reselected)}`);
  }

  const decor = await page.evaluate(async (assetBase) => {
    // Decoration dresses WALLS only. Asserting "some cell is decorated" would
    // pass just as happily if it were the floor, which is the mistake this
    // replaced — so the split is counted explicitly in both directions.
    // `is-wall` is the marker to test against, NOT the terrain sheet: wall
    // tiles come from the same Wang atlas as the floor, so a backgroundImage
    // sniff cannot tell the two apart.
    const cells = Array.from(document.querySelectorAll('.sos-cell'));
    const decorated = cells.filter((cell) =>
      getComputedStyle(cell).backgroundImage.includes('sos-ground-decor'),
    );
    const decoratedFloors = decorated.filter((cell) => !cell.classList.contains('is-wall')).length;
    const decoratedWalls = decorated.length - decoratedFloors;
    const image = new Image();
    image.src = `${assetBase}/sprites/sos-ground-decor/sprite-sheet-alpha.png`;
    await image.decode();
    return { decoratedCells: decorated.length, decoratedFloors, decoratedWalls, width: image.naturalWidth };
  }, appBase);
  if (decor.width !== 320) {
    throw new Error(`Ground decoration sheet did not load: ${JSON.stringify(decor)}`);
  }
  if (decor.decoratedFloors > 0) {
    throw new Error(
      `Decoration must not sit on walkable floor: ${decor.decoratedFloors} floor tiles are dressed. ${JSON.stringify(decor)}`,
    );
  }
  /*
   * Only the floor assertion is required here.
   *
   * Decoration dresses WALLS, and the adventure camera opens on a squad in a
   * corner, so how many dressed walls happen to be on screen is a property of the
   * seed, not of the feature. Requiring one made this check fail on maps that are
   * perfectly correct. "Decoration reaches walls at all" is asserted where it is
   * deterministic instead, in `terrainDecor.test.ts`.
   */

  /*
   * Decoration frames must be selected from the sheet correctly.
   *
   * The `--decor-scale` sizing is GONE (it broke the sheet on screen), so the
   * frame offset is the plain i/(count-1) of a `count`-tile-wide sheet again.
   * What is worth keeping is the part that is actually a bug class rather than a
   * constant: a frame whose offset points outside its own cell, or a layer that
   * is not exactly `count` cells wide, slides the decal sideways or crops it.
   * That reads as "the decoration disappeared", which is why it got through.
   *
   * So assert the two relationships that hold for any frame index, rather than
   * pinning one magic scale number.
   */
  const decorGeometry = await page.evaluate(() => {
    const decorated = Array.from(document.querySelectorAll('.sos-cell')).filter((cell) =>
      getComputedStyle(cell).backgroundImage.includes('sos-ground-decor'),
    );
    if (!decorated.length) return null;
    /*
     * The decoration is the FIFTH comma-separated background layer (index 4).
     *
     * It used to be the fourth, and it moved again when the floor-wear layer
     * was inserted at index 1. The altar has to sit above the decal — an altar
     * is a standing monument and rubble is a smear on the stone, so the ruin
     * detail reads as ground the altar has been set into — and below the tint
     * wash, which means it cannot go last without disappearing behind the
     * terrain sheet. So the decal layer is index 4 and this index has to move
     * with it.
     *
     * `art.test.ts` and `terrainDecor.test.ts` assert the frame maths, but
     * nothing else asserts WHICH layer this is: read the wrong index and you get
     * a gradient's `auto` size and a NaN ratio, which is why the numbers below
     * would fail loudly rather than silently pass.
     */
    const style = getComputedStyle(decorated[0]);
    const size = style.backgroundSize.split(',')[4]?.trim().split(/\s+/) ?? [];
    const position = style.backgroundPosition.split(',')[4]?.trim() ?? '';
    return {
      count: Number(style.getPropertyValue('--decoration-count')),
      index: Number(style.getPropertyValue('--decoration-index')),
      // Fractions of a tile, so viewport size and the board transform cancel out.
      widthRatio: parseFloat(size[0] ?? 'NaN') / 100,
      heightRatio: parseFloat(size[1] ?? 'NaN') / 100,
      positionRatio: parseFloat(position) / 100,
    };
  });
  if (!decorGeometry) {
    /*
     * Nothing dressed happens to be inside this seed's opening window.
     *
     * Decoration is per-cell and seeded, and the camera opens on a corner, so "is
     * a dressed wall on screen right now" is a property of the seed rather than of
     * the feature. Treating it as a failure is exactly what left this check red.
     * The frame maths itself is asserted deterministically in `terrainDecor.test.ts`
     * and `art.test.ts`, so skipping here costs no coverage — it only stops a
     * correct map being called broken.
     */
    console.log('  (no dressed wall in the opening window; skipping decor geometry)');
  } else {
    const dg = decorGeometry;
    // The layer must be exactly `count` tiles wide and one tile tall.
    if (Math.abs(dg.widthRatio - dg.count) > 0.001 || Math.abs(dg.heightRatio - 1) > 0.001) {
      throw new Error(
        `Decoration layer is ${dg.widthRatio}x${dg.heightRatio} of a tile, expected ${dg.count}x1: ${JSON.stringify(dg)}`,
      );
    }
    // Offset must equal i/(count-1), and the resolved frame must sit inside the tile.
    const expected = dg.index / (dg.count - 1);
    if (!Number.isFinite(expected) || Math.abs(dg.positionRatio - expected) > 0.001) {
      throw new Error(
        `Decoration offset ${dg.positionRatio} does not match i/(count-1) = ${expected}: ${JSON.stringify(dg)}`,
      );
    }
    if (dg.index < 0 || dg.index >= dg.count) {
      throw new Error(`Decoration index ${dg.index} is outside the sheet: ${JSON.stringify(dg)}`);
    }
  }

  /*
   * Adventure floor, wall contact and grid geometry.
   *
   * These are visual-correctness assertions that a rules test cannot see:
   *  - the floor must no longer be one repeated value (tones/wear vary);
   *  - a floor tile beside stone must carry the contact shadow class;
   *  - every drawn row must fit inside the board, and the board inside the
   *    frame's padding, so the last row is never clipped;
   *  - the unit box must be the tile box, because the walk keyframe translates
   *    by 100% and expects one tile of travel.
   */
  const floorAndFrame = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('.sos-cell:not(.is-void)'));
    const floors = all.filter((cell) => !cell.classList.contains('is-wall'));
    const board = document.querySelector('.sos-board');
    const frame = document.querySelector('.sos-board-frame');
    const boardBox = board.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    const boxes = all.map((cell) => cell.getBoundingClientRect());
    const selectedUnit = document.querySelector('.sos-cell .sos-unit.is-selected');
    const unitCell = selectedUnit?.closest('.sos-cell');
    const unitBox = selectedUnit?.getBoundingClientRect();
    const unitCellBox = unitCell?.getBoundingClientRect();
    return {
      board: {
        bottom: boardBox.bottom,
        right: boardBox.right,
        width: boardBox.width,
        height: boardBox.height,
        rows: getComputedStyle(board).gridTemplateRows.split(/\s+/).length,
      },
      frame: {
        bottom: frameBox.bottom,
        right: frameBox.right,
      },
      tiles: {
        bottom: Math.max(...boxes.map((box) => box.bottom)),
        right: Math.max(...boxes.map((box) => box.right)),
      },
      floorCount: floors.length,
      tones: [...new Set(floors.map((cell) => cell.dataset.floorTone))],
      wears: [...new Set(floors.map((cell) => getComputedStyle(cell).getPropertyValue('--floor-wear').trim()))],
      contact: floors.filter((cell) => /is-floor-wall-(up|right|down|left)/.test(cell.className)).length,
      unit: selectedUnit && unitBox && unitCellBox
        ? {
            width: unitBox.width,
            height: unitBox.height,
            cellWidth: unitCellBox.width,
            cellHeight: unitCellBox.height,
            centreDx: (unitBox.left + unitBox.width / 2) - (unitCellBox.left + unitCellBox.width / 2),
            centreDy: (unitBox.top + unitBox.height / 2) - (unitCellBox.top + unitCellBox.height / 2),
          }
        : null,
    };
  });
  if (floorAndFrame.tiles.bottom > floorAndFrame.board.bottom + 0.5) {
    throw new Error(
      `The last tile row overflows the board (clipped bottom): ${JSON.stringify(floorAndFrame)}`,
    );
  }
  if (floorAndFrame.board.bottom > floorAndFrame.frame.bottom + 0.5) {
    throw new Error(
      `The board overflows the stage frame: ${JSON.stringify(floorAndFrame)}`,
    );
  }
  if (floorAndFrame.tiles.right > floorAndFrame.board.right + 0.5) {
    throw new Error(
      `The last tile column overflows the board: ${JSON.stringify(floorAndFrame)}`,
    );
  }
  if (floorAndFrame.board.rows !== 9) {
    throw new Error(`Adventure should have nine explicit row tracks: ${JSON.stringify(floorAndFrame)}`);
  }
  if (Math.abs(floorAndFrame.board.width / floorAndFrame.board.height - 1) > 0.02) {
    throw new Error(
      `The 9x9 Adventure board is not square; its 12x10 defaults are overriding the camera: ${JSON.stringify(floorAndFrame.board)}`,
    );
  }
  if (floorAndFrame.tones.length < 2) {
    throw new Error(
      `The floor is still a single repeated tone (${JSON.stringify(floorAndFrame.tones)}): ${JSON.stringify(floorAndFrame)}`,
    );
  }
  if (floorAndFrame.wears.filter((value) => value && value !== 'none').length < 2) {
    throw new Error(
      `The floor has no crack/stain variation: ${JSON.stringify(floorAndFrame.wears)}`,
    );
  }
  if (floorAndFrame.contact === 0) {
    throw new Error(
      'No floor tile beside a wall carries its contact shadow class: ' + JSON.stringify(floorAndFrame),
    );
  }
  if (!floorAndFrame.unit) {
    throw new Error('No selected unit to check sprite/grid alignment against.');
  }
  if (
    Math.abs(floorAndFrame.unit.width - floorAndFrame.unit.cellWidth) > 3 ||
    Math.abs(floorAndFrame.unit.height - floorAndFrame.unit.cellHeight) > 3
  ) {
    throw new Error(
      `The unit box no longer fills its tile, so 100%-based walk travel is wrong: ${JSON.stringify(floorAndFrame.unit)}`,
    );
  }
  if (Math.abs(floorAndFrame.unit.centreDx) > 1 || Math.abs(floorAndFrame.unit.centreDy) > 1) {
    throw new Error(
      `The unit box is not centred on its tile: ${JSON.stringify(floorAndFrame.unit)}`,
    );
  }

  /*
   * The same bottom-edge contract on a shorter laptop viewport. The board is
   * height-bound at 1280x720, which is exactly where an aspect-ratio mistake
   * pushes the last row under the frame. Restore the smoke viewport afterwards
   * so the screenshot and later interactions stay comparable.
   */
  await page.setViewport({ width: 1280, height: 720 });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const compact = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.sos-cell:not(.is-void)'));
    const board = document.querySelector('.sos-board');
    const frame = document.querySelector('.sos-board-frame');
    const boardBox = board.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    const boxes = cells.map((cell) => cell.getBoundingClientRect());
    return {
      board: { width: boardBox.width, height: boardBox.height },
      tilesBottom: Math.max(...boxes.map((box) => box.bottom)),
      tilesRight: Math.max(...boxes.map((box) => box.right)),
      boardBottom: boardBox.bottom,
      boardRight: boardBox.right,
      frameBottom: frameBox.bottom,
    };
  });
  if (
    compact.tilesBottom > compact.boardBottom + 0.5 ||
    compact.boardBottom > compact.frameBottom + 0.5 ||
    compact.tilesRight > compact.boardRight + 0.5 ||
    Math.abs(compact.board.width / compact.board.height - 1) > 0.02
  ) {
    throw new Error(`Adventure clips at 1280x720: ${JSON.stringify(compact)}`);
  }
  await page.setViewport({ width: 1365, height: 900 });
  await new Promise((resolve) => setTimeout(resolve, 250));

  const pixelArt = await page.evaluate(async (assetBase) => {
    const paths = [
      `${assetBase}/sprites/sos-pixellab/icon-heal/sprite-sheet-alpha.png`,
      `${assetBase}/sprites/sos-pixellab/icon-guard/sprite-sheet-alpha.png`,
      `${assetBase}/sprites/sos-pixellab/effects/sanctified-ground/animation.preview.gif`,
      `${assetBase}/sprites/sos-pixellab/effects/shield-slam/animation.preview.gif`,
    ];
    return Promise.all(paths.map(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return { src, width: image.naturalWidth, height: image.naturalHeight };
    }));
  }, appBase);
  if (pixelArt.some((asset) => !asset.width || !asset.height)) {
    throw new Error(`PixelLab art failed to load: ${JSON.stringify(pixelArt)}`);
  }

  // Walls must be visually distinguishable from open ground.
  //
  // Every wall is drawn from the same fully-raised Wang tile, so the sprite
  // alone cannot separate wall from floor — the cue is painted in CSS. That is
  // easy to break silently (a `box-shadow: none`, a cascade change in theme.css),
  // and a wall that looks like floor is a correctness bug: players route through
  // tiles the engine refuses. So assert the computed style actually differs,
  // rather than trusting the class name is present.
  const wallReadability = await page.evaluate(() => {
    const read = (cell) => {
      const style = getComputedStyle(cell);
      return {
        tint: style.getPropertyValue('--tint').trim(),
        shadow: style.boxShadow,
        borderTop: style.borderTopWidth,
        borderTopColor: style.borderTopColor,
        cursor: style.cursor,
      };
    };
    const walls = Array.from(document.querySelectorAll('.sos-cell.is-wall'));
    const floors = Array.from(document.querySelectorAll('.sos-cell:not(.is-wall)'));
    return {
      wallCount: walls.length,
      // Some cell must carry an exposed-edge rim, else the mass has no outline.
      rimmed: walls.filter((cell) => Number.parseFloat(getComputedStyle(cell).borderTopWidth) >= 2).length,
      wall: walls.length ? read(walls[0]) : null,
      floor: floors.length ? read(floors[0]) : null,
    };
  });
  if (wallReadability.wallCount === 0) {
    throw new Error(`No walls rendered, so wall readability is untested: ${JSON.stringify(wallReadability)}`);
  }
  if (
    wallReadability.wall.tint === wallReadability.floor.tint ||
    wallReadability.wall.shadow === wallReadability.floor.shadow
  ) {
    throw new Error(`Walls render identically to floor: ${JSON.stringify(wallReadability)}`);
  }
  if (wallReadability.rimmed === 0) {
    throw new Error(`No wall carries an exposed-edge rim: ${JSON.stringify(wallReadability)}`);
  }
  if (!wallReadability.wall.cursor.includes('not-allowed')) {
    throw new Error(`Wall cursor does not read as blocked: ${JSON.stringify(wallReadability)}`);
  }
  const turnLabel = await page.$eval('.sos-turn-banner', (element) => element.textContent ?? '');

  /*
   * Mobile header: the turn banner and the clock share ONE row. They used to
   * stack, which spent a whole extra row of a fixed-height match screen on two
   * small readouts — invisible to any state test, so it is measured here.
   */
  // Width-only resize: `isMobile` would re-emulate the device and reload the
  // page, and the media query this guards is width-based anyway.
  await page.setViewport({ width: 412, height: 900 });
  const mobileStatus = await page.evaluate(() => {
    const banner = document.querySelector('.sos-turn-banner');
    const timer = document.querySelector('.sos-timer');
    if (!banner || !timer) return null;
    const b = banner.getBoundingClientRect();
    const t = timer.getBoundingClientRect();
    return { sameRow: Math.abs(b.top - t.top) < 12, sideBySide: t.left >= b.right - 1 };
  });
  await page.setViewport({ width: 1365, height: 900 });
  if (!mobileStatus) {
    const debug = await page.evaluate(() => ({
      statusRow: document.querySelector('.sos-topbar-status')?.outerHTML.slice(0, 600) ?? null,
      timers: document.querySelectorAll('.sos-timer').length,
      banners: document.querySelectorAll('.sos-turn-banner').length,
    }));
    throw new Error(`The turn banner and the clock are missing from a live match: ${JSON.stringify(debug)}`);
  }
  if (!mobileStatus.sameRow || !mobileStatus.sideBySide) {
    throw new Error(`On a phone the turn banner and the clock must share one row: ${JSON.stringify(mobileStatus)}`);
  }
  const activeTeamClass = turnLabel.includes('Smoke test') ? 'is-ally' : 'is-enemy';

  // The four-unit squad is randomized. Select one of the active player's units
  // and verify that its class-specific action art and controls are available.
  const firstActiveUnit = await page.$(`.sos-cell:has(.sos-unit.${activeTeamClass})`);
  if (!firstActiveUnit) {
    const labels = await page.$$eval('.sos-cell', (cells) =>
      cells.map((cell) => cell.getAttribute('aria-label')).filter(Boolean),
    );
    const details = await page.evaluate(() => ({
      text: document.body.innerText,
      factionButtons: Array.from(document.querySelectorAll('.sos-faction-card')).map((b) => ({ text: b.innerText, disabled: b.disabled })),
      units: document.querySelectorAll('.sos-cell .sos-unit').length,
    }));
    throw new Error(`The active player's unit is missing from the board: ${labels.join(' | ')}; ${JSON.stringify(details)}`);
  }
  /*
   * A unit that can still act is pre-selected when the turn hands over, so the
   * board is never blank at the start of your move. Clicking an ALREADY-selected
   * unit toggles the selection off, so only click when nothing is selected yet.
   */
  const alreadySelected = await firstActiveUnit.$('.sos-unit.is-selected');
  if (!alreadySelected) {
    await firstActiveUnit.click();
  }
  await page.waitForSelector('.sos-selected-head strong');
  /*
   * Turn order is a choice now. Move and the class actions must BOTH be offered
   * before anything is spent, so the player can act first and walk after — or
   * move first and act after.
   */
  const turnOptions = await page.evaluate(() => {
    const move = document.querySelector('.sos-skill[data-action="move"]');
    const attack = document.querySelector('.sos-skill[data-action="ATTACK"]');
    return {
      moveEnabled: !!move && !move.disabled,
      attackEnabled: !!attack && !attack.disabled,
    };
  });
  if (!turnOptions.moveEnabled || !turnOptions.attackEnabled) {
    throw new Error(
      `Move and attack must both be available at turn start: ${JSON.stringify(turnOptions)}`,
    );
  }
  await page.waitForFunction(() => {
    const icon = document.querySelector('.sos-skill[data-action="ATTACK"] .sos-skill-icon');
    const image = icon?.querySelector('img.sos-pixel-icon');
    // Some classes have custom pixel art; other classes intentionally use the
    // built-in SVG fallback. Accept either fully loaded representation.
    return !!icon?.querySelector('svg') || (image?.complete && image.naturalWidth > 0);
  }, { timeout: 8000 }).catch(async () => {
    const details = await page.evaluate(() => {
      const icon = document.querySelector('.sos-skill[data-action="ATTACK"] .sos-skill-icon');
      const image = icon?.querySelector('img');
      return {
        unit: document.querySelector('.sos-selected-head strong')?.textContent?.trim() ?? '',
        iconHtml: icon?.innerHTML ?? '',
        src: image?.src ?? '',
        complete: image?.complete ?? false,
        naturalWidth: image?.naturalWidth ?? 0,
        hasSvgFallback: !!icon?.querySelector('svg'),
      };
    });
    throw new Error(`The selected unit's attack icon or fallback did not render: ${JSON.stringify(details)}`);
  });

  /*
   * The board paints exactly one action's range. At turn start Move owns the
   * focus, so movement tiles are painted and the attack area is not: the
   * enemy target rims are the only action cue. Choosing Attack hands the board
   * to the action: movement disappears, attack range appears, and hovering a
   * range tile previews the damage hit zone.
   */
  const startLayers = await page.evaluate(() => ({
    move: document.querySelectorAll('.sos-cell[data-move]').length,
    attack: document.querySelectorAll('.sos-cell[data-range="attack"]').length,
  }));
  if (startLayers.move === 0 || startLayers.attack !== 0) {
    throw new Error(`Turn start must paint movement only: ${JSON.stringify(startLayers)}`);
  }
  await page.click('.sos-skill[data-action="ATTACK"]');
  await page.waitForFunction(
    () => document.querySelectorAll('.sos-cell[data-move]').length === 0
      && document.querySelectorAll('.sos-cell[data-range="attack"]').length > 0,
  );
  const attackTile = await page.$('.sos-cell[data-range="attack"]:not(.is-wall)');
  if (!attackTile) throw new Error('The selected attack range rendered no non-wall tile.');
  await attackTile.hover();
  await page.waitForFunction(
    () => document.querySelectorAll('.sos-cell[data-impact="damage"]').length > 0,
  );
  if (process.env.SOS_SMOKE_SCREENSHOT) {
    await page.screenshot({ path: process.env.SOS_SMOKE_SCREENSHOT });
  }
  await page.click('.sos-skill[data-action="move"]');
  await page.waitForFunction(
    () => document.querySelectorAll('.sos-cell[data-move]').length > 0,
  );

  // One actual legal move proves the board target + selected-unit controls work.
  const moveTarget = await page.$('.sos-cell[data-move]');
  if (!moveTarget) throw new Error('No legal movement target was rendered.');
  await moveTarget.click();
  await page.waitForFunction(
    () => document.querySelector('.sos-selected .sos-stat-muted')?.textContent?.includes('Moved'),
  );

  // Status is engraved text, not a system emoji badge.
  const movedPill = await page.evaluate(
    () => document.querySelector('.sos-status-pill')?.textContent?.trim() ?? '',
  );
  if (movedPill !== 'Moved') {
    throw new Error(`The moved status must be a plain text pill, got: ${JSON.stringify(movedPill)}`);
  }

  // Leave a non-default window selected so the next match can prove the choice
  // is local UI state and survives a return to the menu.
  await selectMapSize(10);

  /*
   * Arena half of the map-size contract.
   *
   * Adventure has a 20x20 floor, so a 5x5 window is obviously a crop. Arena is
   * only 12x10, which is the case where a 10x10 request must be capped to the
   * map height and where a 5x5 window still has to pan across seven columns.
   * Start a fresh Local Duel without touching the default Arena mode.
   */
  await page.click('.sos-slot-log .sos-back');
  await page.waitForSelector('.sos-menu-entry');
  await page.evaluate(() => {
    const localDuel = Array.from(document.querySelectorAll('.sos-menu-entry')).find(
      (button) => button.querySelector('.sos-menu-entry-label')?.textContent?.trim() === 'Local Duel',
    );
    if (!localDuel) throw new Error('Local Duel mode card is missing on the second pass.');
    localDuel.click();
  });
  await page.waitForSelector('.sos-faction-carousel');
  const arenaMode = await page.evaluate(
    () => document.querySelector('.sos-map-mode-btn.is-active strong')?.textContent?.trim() ?? '',
  );
  if (arenaMode !== 'Arena') {
    throw new Error(`The second pass must start on Arena, found ${JSON.stringify(arenaMode)}.`);
  }
  await draftOneFaction();
  await page.waitForSelector('.sos-faction-carousel');
  await draftOneFaction();
  await page.waitForSelector('.sos-board-layout', { timeout: 5000 });

  /*
   * The Arena's Altar of Shadows.
   *
   * It is the central ruin block dressed with one sprite split across its four
   * cells — four quadrants, four distinct background positions. At zero souls it
   * must be dim: the lit state is what tells a player the altar has something to
   * spend, so an altar that glows for free is a broken promise.
   */
  const altar = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.sos-cell.is-altar'));
    const quads = cells.map((cell) => cell.querySelector('.sos-altar-quad'));
    const styles = quads.filter(Boolean).map((quad) => getComputedStyle(quad));
    return {
      cells: cells.length,
      quads: styles.length,
      lit: document.querySelectorAll('.sos-cell.is-altar-lit').length,
      sprite: styles[0]?.backgroundImage ?? '',
      positions: new Set(styles.map((style) => style.backgroundPosition)).size,
      /*
       * The monument is one object: no per-tile rim, no border, and no gutter
       * between its four cells. Split across four bordered cells it read as
       * four statues, which is the bug this asserts against.
       */
      wallChrome: cells.filter((cell) => cell.classList.contains('is-wall')).length,
      borders: cells.map((cell) => getComputedStyle(cell).borderTopWidth),
      plinths: cells.filter((cell) => cell.classList.contains('is-altar-plinth')).length,
      // Reading order, so the first two are the top row of the block.
      boxes: cells
        .map((cell) => {
          const box = cell.getBoundingClientRect();
          return {
            // Dungeon atlas: 0/1 are the floor frames, 2+ are WALL_<mask>.
            frame: Number(cell.style.getPropertyValue('--tile-index')),
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
          };
        })
        .sort((a, b) => a.top - b.top || a.left - b.left),
    };
  });
  if (altar.cells !== 4) {
    throw new Error(`The Arena altar must span four tiles, found ${altar.cells}.`);
  }
  if (altar.quads !== 4) {
    throw new Error('Every altar tile must paint its quadrant of the monument.');
  }
  if (altar.positions !== 4) {
    throw new Error('The altar sprite must be split into four distinct quadrants.');
  }
  if (altar.lit !== 0) {
    throw new Error('An altar holding no souls must render dim, not lit.');
  }
  if (!/sos-altar-monuments\/altar-\d\d\.png/.test(altar.sprite)) {
    throw new Error(`The altar must draw a monument sprite, got ${JSON.stringify(altar.sprite)}`);
  }
  if (altar.wallChrome !== 0) {
    throw new Error('Altar tiles must not take the per-tile wall chrome (rim, stone film, gutter border).');
  }
  if (altar.borders.some((width) => width !== '0px')) {
    throw new Error(`Altar tiles must draw no cell border, got ${JSON.stringify(altar.borders)}.`);
  }
  if (altar.plinths !== 2) {
    throw new Error(`The altar's bottom row must draw floor, found ${altar.plinths} plinth tiles.`);
  }
  const topRow = altar.boxes.slice(0, 2);
  const bottomRow = altar.boxes.slice(2);
  if (!topRow.every((box) => box.frame >= 2)) {
    throw new Error(`The altar's top row must draw the stone face, got frames ${JSON.stringify(topRow.map((b) => b.frame))}.`);
  }
  if (!bottomRow.every((box) => box.frame <= 1)) {
    throw new Error(`The altar's bottom row must draw floor, got frames ${JSON.stringify(bottomRow.map((b) => b.frame))}.`);
  }
  const seamX = Math.abs(topRow[0].left + topRow[0].width - topRow[1].left);
  const seamY = Math.abs(topRow[0].top + topRow[0].height - bottomRow[0].top);
  if (seamX > 1 || seamY > 1) {
    throw new Error(
      `The altar's quadrants must meet without a gutter, got seams ${seamX.toFixed(2)}px / ${seamY.toFixed(2)}px.`,
    );
  }
  if (process.env.SOS_SMOKE_ALTAR_SCREENSHOT) {
    await page.screenshot({ path: process.env.SOS_SMOKE_ALTAR_SCREENSHOT });
  }

  // 10x10 was selected at the end of the Adventure run, so the new match must
  // open at 10x10 rather than falling back to 9x9 mid-session.
  assertViewShape(await readBoardShape(), 10, 'Arena persisted 10x10');

  await selectMapSize(5);
  const arenaFive = await readBoardShape();
  assertViewShape(arenaFive, 5, 'Arena 5x5');
  if (!arenaFive.pannable) throw new Error('A 5x5 window over the 12x10 Arena must be pannable.');
  await dragCamera({ maxX: 7, expectedCells: 25, label: 'Arena 5x5' });

  await selectMapSize(10);
  assertViewShape(await readBoardShape(), 10, 'Arena 10x10');

  if (pageErrors.length > 0) throw new Error(`Browser errors: ${pageErrors.join('; ')}`);
  console.log('Square of Shadows browser smoke passed: title-screen layout and three game modes, touch scrolling, menu music/mute, wall readability, terrain decor, faction draft, class attack icon, action-range layers, hit-zone preview, legal move, 3/5/7/9/10/11 camera windows and two seeded altars in Adventure, live minimap free-nav (click/drag/board pan), and persisted 10x10 plus bounded 5x5 drag-pan in Arena.');
} finally {
  if (browser) await browser.close();
  await server.close();
}
