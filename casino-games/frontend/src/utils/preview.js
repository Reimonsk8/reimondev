/**
 * Dev-only design preview.
 *
 * Visiting any page with `?preview=1` fakes a signed-in session so the library,
 * dashboard and game shells can be reviewed without a Cognito login; `?preview=0`
 * clears it. Vite inlines `import.meta.env.DEV` as `false` in production, so none
 * of this reaches the deployed bundle.
 */
const KEY = 'c888_preview';

if (import.meta.env.DEV) {
    const flag = new URLSearchParams(window.location.search).get('preview');
    if (flag === '1') sessionStorage.setItem(KEY, '1');
    else if (flag === '0') sessionStorage.removeItem(KEY);
}

export const PREVIEW = import.meta.env.DEV && sessionStorage.getItem(KEY) === '1';

/**
 * Canned responses for the few endpoints the platform chrome reads, so the
 * preview shows a populated balance and level instead of an empty shell.
 * Anything not listed resolves to `{}`, which every caller already treats as
 * "no data".
 */
export const PREVIEW_DATA = {
    '/wallet/profile': {
        currentBalance: 1250,
        nickname: 'Preview Player',
        email: 'preview@gloom.local',
        totalGames: 42,
        totalWagered: 3200,
        totalWins: 19,
        totalWon: 2750,
        biggestWin: 320,
    },
};
