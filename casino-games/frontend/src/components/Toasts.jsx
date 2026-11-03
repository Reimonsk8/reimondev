import { useEffect, useState } from 'react';
import { subscribeToasts, dismissToast } from '../utils/toast';
import { CheckCircle, XCircle, PartyPopper, MessageCircle } from 'lucide-react';

export default function Toasts() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', top: '16px', right: '16px', zIndex: 2000,
      display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: 'min(360px, calc(100vw - 32px))',
    }}>
      {toasts.map((t) => (
        <div key={t.id} onClick={() => dismissToast(t.id)} role="status" style={{
          display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
          padding: '12px 14px', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,.4)',
          background: 'rgba(13, 18, 34, 0.95)', border: '1px solid rgba(255,255,255,0.12)',
          borderLeft: `4px solid ${
            t.type === 'success' ? '#34d399' : t.type === 'error' ? '#f87171' : t.type === 'win' ? '#fbbf24' : '#38bdf8'
          }`,
          color: '#e2e8f0', fontSize: '13px', fontWeight: '600',
          animation: 'slideInRight 0.25s ease-out',
        }}>
          <span style={{ fontSize: '18px' }}>
            {t.type === 'success' ? <CheckCircle size={18} color="#34d399" /> : t.type === 'error' ? <XCircle size={18} color="#f87171" /> : t.type === 'win' ? <PartyPopper size={18} color="#fbbf24" /> : <MessageCircle size={18} color="#38bdf8" />}
          </span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}