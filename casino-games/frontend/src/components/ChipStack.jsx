// Chip-stack physics: the stack height tracks the balance, so it visibly
// accumulates on wins and depletes on losses. Pure CSS transitions on the
// chip bottom offsets animate the stacking.
export default function ChipStack({ balance = 0 }) {
  const chips = Math.max(0, Math.min(10, Math.floor(Math.log10(Math.max(balance, 1)) * 3.5)));
  return (
    <span className="chip-stack" title="Chips" aria-hidden="true">
      {Array.from({ length: chips }).map((_, i) => (
        <span key={i} className={`chip-stack-chip chip-${i % 3}`} style={{ '--i': i }} />
      ))}
    </span>
  );
}
