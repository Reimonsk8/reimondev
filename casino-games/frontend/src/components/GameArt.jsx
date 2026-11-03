const slotNames = {
  '💎': 'diamond', '🍀': 'clover', '🍒': 'cherry', '🍋': 'lemon',
  '🍊': 'orange', '🍇': 'grapes', '🍉': 'watermelon', '⭐': 'star',
};

export function SlotSymbol({ symbol, compact = false }) {
  const name = slotNames[symbol] || 'star';
  return <span className={`slot-symbol slot-${name} ${compact ? 'is-compact' : ''}`} role="img" aria-label={name}><i /><i /><i /></span>;
}

const pipMap = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

export function DieSprite({ value }) {
  return <span className="die-sprite" role="img" aria-label={`Die showing ${value}`}>{Array.from({ length: 9 }, (_, index) => <i key={index} className={pipMap[value]?.includes(index) ? 'is-on' : ''} />)}</span>;
}

export function CabinetSprite({ type }) {
  const common = { viewBox: '0 0 120 86', className: `cabinet-sprite sprite-${type}`, 'aria-hidden': true };
  if (type === 'slots') return <svg {...common}><rect x="15" y="16" width="90" height="54" rx="9"/><rect x="23" y="24" width="22" height="34" rx="4"/><rect x="49" y="24" width="22" height="34" rx="4"/><rect x="75" y="24" width="22" height="34" rx="4"/><path d="M30 41h8M56 41h8M82 41h8M34 37v8M60 37v8M86 37v8"/><path d="M105 29h8v25h-8M113 27v-8"/><circle cx="113" cy="15" r="5"/></svg>;
  if (type === 'blackjack') return <svg {...common}><rect x="27" y="14" width="43" height="59" rx="6" transform="rotate(-11 27 14)"/><rect x="54" y="12" width="43" height="59" rx="6" transform="rotate(10 54 12)"/><path d="M40 33l6-9 6 9-6 9zM74 29c8-10 18 4 0 15-18-11-8-25 0-15z"/><circle cx="31" cy="68" r="11"/><circle cx="48" cy="71" r="11"/><path d="M24 68h14M41 71h14"/></svg>;
  if (type === 'roulette') return <svg {...common}><circle cx="59" cy="43" r="34"/><circle cx="59" cy="43" r="22"/><circle cx="59" cy="43" r="7"/><path d="M59 9v68M25 43h68M35 19l48 48M83 19L35 67"/><circle cx="85" cy="23" r="5"/></svg>;
  if (type === 'dice') return <svg {...common}><rect x="20" y="18" width="46" height="46" rx="9" transform="rotate(-8 20 18)"/><rect x="58" y="23" width="42" height="42" rx="8" transform="rotate(9 58 23)"/><circle cx="35" cy="32" r="3"/><circle cx="51" cy="50" r="3"/><circle cx="77" cy="36" r="3"/><circle cx="88" cy="52" r="3"/><circle cx="75" cy="53" r="3"/></svg>;
  if (type === 'coin') return <svg {...common}><ellipse cx="52" cy="43" rx="29" ry="34"/><ellipse cx="57" cy="43" rx="23" ry="28"/><path d="M59 25v36M68 31H49c-9 0-9 12 0 12h12c9 0 9 12 0 12H45"/><path d="M85 22c13 9 16 24 8 37"/></svg>;
  if (type === 'wheel') return <svg {...common}><circle cx="59" cy="45" r="31"/><circle cx="59" cy="45" r="8"/><path d="M59 14v62M28 45h62M37 23l44 44M81 23L37 67"/><path d="M52 8h14l-7 12z"/><circle cx="59" cy="45" r="26" strokeDasharray="2 8"/></svg>;
  if (type === 'cards') return <svg {...common}><rect x="19" y="19" width="46" height="57" rx="7" transform="rotate(-9 19 19)"/><rect x="59" y="13" width="43" height="58" rx="7" transform="rotate(10 59 13)"/><path d="M37 35c8-10 17 4 0 14-17-10-8-24 0-14zM76 29l7-10 7 10-7 11z"/><path d="M52 63l18-37"/></svg>;
  if (type === 'breaker') return <svg {...common}><path d="M18 18h24v13H18zM48 18h24v13H48zM78 18h24v13H78zM27 36h24v13H27zM57 36h24v13H57z"/><circle cx="70" cy="61" r="6"/><path d="M25 72h70M75 57l17-14"/></svg>;
  if (type === 'hyperlane') return <svg {...common}><path d="M23 78L49 9M97 78L71 9M41 78h38"/><path d="M60 22l16 31-16 20-16-20z"/><path d="M48 49l-10 9 13 2M72 49l10 9-13 2"/><path d="M54 71l-4 12M66 71l4 12"/></svg>;
  return <svg {...common}><rect x="23" y="10" width="74" height="66" rx="10"/>{Array.from({ length: 16 }, (_, index) => <circle key={index} cx={36 + (index % 4) * 16} cy={22 + Math.floor(index / 4) * 14} r={index === 10 ? 6 : 3} className={index === 10 ? 'sprite-hot' : ''}/>)}<circle cx="68" cy="50" r="14" strokeDasharray="3 5"/></svg>;
}
