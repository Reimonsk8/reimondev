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
 * Canned response for the shared player-profile endpoint used by both games.
 * Anything not listed resolves to `{}`, which every caller already treats as
 * "no data".
 */
export const PREVIEW_DATA = {
    '/wallet/profile': {
        nickname: 'Preview Player',
        email: 'preview@gloom.local',
        avatarImage: '',
    },
};
