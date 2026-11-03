import { useState } from 'react';
import Modal from './Modal';
import MyStatsCard from './MyStatsCard';
import { Trash2, Gift, Trophy } from 'lucide-react';

export function SettingsModal({ isOpen, onClose, sound, setSound, user, avatarImage, onDeleteAccount }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const nickname = user?.nickname || user?.email?.split('@')[0] || 'Player';
  const picture = avatarImage || user?.picture || '';

  const handleDelete = async () => {
    setDeleteError('');
    setDeleting(true);
    try {
      await onDeleteAccount();
      // onDeleteAccount handles cleanup + redirect on success
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete account. Please try again.');
      setDeleting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', minWidth: '300px' }}>
        {/* Profile info panel */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '14px', padding: '14px',
          background: 'rgba(255,255,255,0.04)', borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          {picture ? (
            <img src={picture} alt="" style={{
              width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover',
              border: '2px solid rgba(251, 191, 36, .5)',
            }} />
          ) : (
            <div style={{
              width: '48px', height: '48px', borderRadius: '50%', background: '#4a90e2',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: '900', fontSize: '20px', border: '2px solid rgba(251, 191, 36, .5)',
            }}>
              {(nickname || '?').charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: 'block', fontSize: '15px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {nickname}
            </strong>
            <p style={{ margin: '2px 0 0', color: '#94a3b8', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email || 'No email'}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>Sound Effects</strong>
            <p style={{ margin: '2px 0 0', color: '#94a3b8', fontSize: '12px' }}>Casino ambience and game sounds</p>
          </div>
          <button
            onClick={() => setSound({ enabled: !sound.enabled })}
            style={{
              width: '46px', height: '26px', borderRadius: '13px', border: 'none', cursor: 'pointer',
              background: sound.enabled ? '#10b981' : '#334155', position: 'relative', transition: 'background .2s',
            }}
          >
            <span style={{
              position: 'absolute', top: '3px', left: sound.enabled ? '23px' : '3px', width: '20px', height: '20px',
              borderRadius: '50%', background: '#fff', transition: 'left .2s',
            }} />
          </button>
        </div>
        {sound.enabled && (
          <div>
            <strong>Volume</strong>
            <input
              type="range" min="0" max="1" step="0.05"
              value={sound.volume}
              onChange={(e) => setSound({ volume: parseFloat(e.target.value) })}
              style={{ width: '100%', accentColor: '#10b981' }}
            />
          </div>
        )}

        {/* Delete account */}
        <div style={{
          padding: '14px', borderRadius: '12px',
          background: 'rgba(239, 68, 68, 0.07)', border: '1px solid rgba(239, 68, 68, 0.25)',
        }}>
          {confirmingDelete ? (
            <>
              <strong style={{ color: '#f87171', fontSize: '14px' }}>Delete your account?</strong>
              <p style={{ margin: '4px 0 12px', color: '#94a3b8', fontSize: '12px' }}>
                This permanently removes your profile, balance and history. This cannot be undone.
              </p>
              {deleteError && <p style={{ margin: '0 0 10px', color: '#f87171', fontSize: '12px' }}>{deleteError}</p>}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="primary-button"
                  disabled={deleting}
                  onClick={handleDelete}
                  style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)', padding: '8px 14px', fontSize: '13px' }}
                >
                  {deleting ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button
                  className="secondary-button"
                  disabled={deleting}
                  onClick={() => { setConfirmingDelete(false); setDeleteError(''); }}
                  style={{ padding: '8px 14px', fontSize: '13px' }}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <button
              className="ghost-button-small"
              onClick={() => setConfirmingDelete(true)}
              style={{ color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.4)' }}
            >
              <Trash2 size={14} /> Delete Account
            </button>
          )}
        </div>

        <p style={{ margin: 0, color: '#64748b', fontSize: '12px' }}>
          Play money demo only — no real funds involved. Game outcomes are simulated.
        </p>
      </div>
    </Modal>
  );
}

export function DailyBonusModal({ isOpen, onClose, dailyClaimed, dailyAmount, claimDaily }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Daily Bonus">
      <div style={{ textAlign: 'center', minWidth: '300px', padding: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Gift size={44} color="#fbbf24" /></div>
        <h3 style={{ margin: '8px 0 4px' }}>Claim your daily reward</h3>
        <p style={{ margin: '0 0 16px', color: '#94a3b8', fontSize: '13px' }}>
          Come back every day for free play money.
        </p>
        <div style={{ fontSize: '30px', fontWeight: '900', color: '#fbbf24', marginBottom: '16px' }}>
          +${dailyAmount}
        </div>
        {dailyClaimed ? (
          <div style={{ color: '#34d399', fontWeight: '700' }}>
            Claimed today — see you tomorrow!
          </div>
        ) : (
          <button className="primary-button" onClick={claimDaily} style={{ width: '100%' }}>
            Claim +${dailyAmount}
          </button>
        )}
      </div>
    </Modal>
  );
}

export function LevelBadge({ level, xp, levelXp, achievements, unlockedCount }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <div style={{
        width: '38px', height: '38px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: '900', fontSize: '16px', color: '#fff',
        background: 'linear-gradient(145deg, #7c3aed, #c026d3)', boxShadow: '0 4px 14px rgba(168, 85, 247, .35)',
      }}>
        {level}
      </div>
      <div style={{ minWidth: '110px' }}>
        <div style={{ fontSize: '11px', fontWeight: '700', color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '.5px' }}>
          Level {level} · {unlockedCount}/{achievements.length} <Trophy size={12} style={{ verticalAlign: 'middle' }} />
        </div>
        <div style={{ height: '6px', borderRadius: '3px', background: '#1e293b', marginTop: '4px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${levelXp}%`, background: 'linear-gradient(90deg, #8b5cf6, #d946ef)', borderRadius: '3px' }} />
        </div>
        <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>{xp} XP · {levelXp}/100 to next</div>
      </div>
    </div>
  );
}

export function AchievementsCard({ achievements, unlockedCount, stats, transactions }) {
  return (
    <section className="glass-card stats-card">
      <div className="card-header">
        <div>
          <p className="eyebrow">Achievements</p>
          <h3>Trophies</h3>
        </div>
        <span style={{ color: '#a78bfa', fontWeight: '800' }}>{unlockedCount}/{achievements.length}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }}>
        {achievements.map((a) => (
          <div key={a.id} style={{
            padding: '12px', borderRadius: '12px', textAlign: 'center',
            background: a.unlocked ? 'rgba(139, 92, 246, .12)' : 'rgba(30, 41, 59, .6)',
            border: a.unlocked ? '1px solid rgba(139, 92, 246, .35)' : '1px solid rgba(51, 65, 85, .6)',
            opacity: a.unlocked ? 1 : 0.55, transition: 'all .2s',
          }}>
            <div style={{ fontSize: '24px' }}>{a.icon}</div>
            <div style={{ fontWeight: '800', fontSize: '12px', marginTop: '4px' }}>{a.name}</div>
            <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>{a.desc}</div>
          </div>
        ))}
      </div>

      <div className="card-header" style={{ marginTop: '28px' }}>
        <div>
          <p className="eyebrow">Statistics</p>
          <h3>My Performance</h3>
        </div>
      </div>
      <MyStatsCard stats={stats} transactions={transactions} />
    </section>
  );
}
