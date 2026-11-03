import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { verifyOutcome, verifyProof } from '../utils/provablyFair';

export default function FairnessPanel({ fairness, lastProof }: { fairness?: any; lastProof?: any }) {
  const [status, setStatus] = useState('');
  const verify = async () => setStatus(await verifyProof(lastProof) && verifyOutcome(lastProof.game, lastProof.result, lastProof) ? 'Verified locally' : 'Invalid proof');

  return (
    <section className="glass-card fairness-card">
      <div className="card-header"><div><p className="eyebrow">Provably fair</p><h3>Fairness proof</h3></div><ShieldCheck aria-hidden="true" /></div>
      <p>Server commits seed hash before bet. Completed round reveals seed so browser can independently recalculate every draw.</p>
      <dl>
        <div><dt>Current commitment</dt><dd>{fairness?.serverSeedHash || 'Loading...'}</dd></div>
        <div><dt>Next nonce</dt><dd>{fairness?.nonce ?? '-'}</dd></div>
        <div><dt>Algorithm</dt><dd>{fairness?.algorithm || 'hmac-sha256-v1'}</dd></div>
      </dl>
      {lastProof ? <>
        <p>Last round: <strong>{lastProof.game}</strong> / {lastProof.result}</p>
        <button type="button" className="secondary-button" onClick={verify}>Verify last round locally</button>
        <span role="status" className={status === 'Invalid proof' ? 'text-negative' : 'text-positive'}>{status}</span>
      </> : <small>Play supported game to generate first proof.</small>}
    </section>
  );
}
