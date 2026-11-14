import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import '../../styles/Admin.css';

export default function Admin() {
  const { user, ready, isAdmin } = useAuth();

  if (!ready) {
    return (
      <main className="admin-page" aria-labelledby="admin-title">
        <header className="admin-intro">
          <p className="admin-eyebrow">ADMIN · CONSOLE</p>
          <h1 id="admin-title">Checking session…</h1>
        </header>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="admin-page" aria-labelledby="admin-title">
        <header className="admin-intro">
          <p className="admin-eyebrow">RESTRICTED · ADMIN</p>
          <h1 id="admin-title">This area is private.</h1>
          <p className="admin-lede">
            Sign in with the admin account to open the admin console.
          </p>
          <Link className="admin-link" to="/login">
            Go to sign in <span aria-hidden="true">↗</span>
          </Link>
        </header>
      </main>
    );
  }

  return (
    <main className="admin-page" aria-labelledby="admin-title">
      <header className="admin-intro">
        <p className="admin-eyebrow">ADMIN · CONSOLE</p>
        <h1 id="admin-title">
          Welcome back,
          <br />
          <span>{user?.name || user?.email || 'admin'}.</span>
        </h1>
        <p className="admin-lede">
          Admin-only surfaces live here. They stay hidden for every other account.
        </p>
      </header>

      <section className="admin-panel" aria-labelledby="admin-session-title">
        <h2 id="admin-session-title">Session</h2>
        <dl className="admin-facts">
          <div>
            <dt>Email</dt>
            <dd>{user?.email || '—'}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{user?.source === 'portal' ? 'Portal sign-in' : 'Games app sign-in'}</dd>
          </div>
          <div>
            <dt>Subject</dt>
            <dd className="admin-mono">{user?.sub || '—'}</dd>
          </div>
          <div>
            <dt>Groups</dt>
            <dd>{user?.groups?.length ? user.groups.join(', ') : '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="admin-panel" aria-labelledby="admin-shortcuts-title">
        <h2 id="admin-shortcuts-title">Shortcuts</h2>
        <div className="admin-links">
          <a className="admin-link" href="/games/">
            Games portal <span aria-hidden="true">↗</span>
          </a>
          <Link className="admin-link" to="/postboard">Post board</Link>
          <Link className="admin-link" to="/projects">Work</Link>
        </div>
        <p className="admin-note">
          Client-side admin gates only hide UI. Anything private must still be enforced by
          the API that serves the data.
        </p>
      </section>
    </main>
  );
}
