const fs = require('fs');
const path = require('path');

/*
 * Ground-truth check that JSX comments are stripped, not rendered.
 *
 * A bare `/* ... *\/` in JSX CHILDREN position is JSX TEXT and renders on screen;
 * `{/* ... *\/}` is a real comment and never reaches the bundle. Reading the
 * source cannot tell these apart reliably (most bare comments in this repo sit
 * above top-level declarations, where they are perfectly valid), so the check
 * belongs here: build the bundle and look for the comment text in it.
 */
const dir = path.join(__dirname, 'dist', 'assets');
const bundles = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
const probes = [
  'Map choice, shown alongside the faction draft',
  'only comment form',
  'Blast preview, ability-aware',
  'abilityAffectedTiles already clips the cross',
];

const report = {};
for (const needle of probes) {
  const hits = bundles.filter((f) =>
    fs.readFileSync(path.join(dir, f), 'utf8').includes(needle),
  );
  report[needle] = hits.length === 0 ? 'STRIPPED (never renders)' : `PRESENT in ${hits.join(', ')}`;
}
fs.writeFileSync(path.join(__dirname, 'jsx-check.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));