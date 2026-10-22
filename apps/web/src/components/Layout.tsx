import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useEffect } from 'react';
import { OfflineStatus } from './OfflineStatus';
import { QuickAdd } from './QuickAdd';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/transactions', label: 'Transactions' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/categories', label: 'Categories' },
  { to: '/recipients', label: 'Recipients' },
  { to: '/tags', label: 'Tags' },
  { to: '/settings', label: 'Settings' },
];

export function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className={`app${open ? ' nav-open' : ''}`}>
      <header className="topbar">
        <button
          type="button"
          className="icon-button menu-button"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          ☰
        </button>
        <span className="brand">
          <img src="/favicon.svg" alt="" width="24" height="24" /> Finance
        </span>
      </header>
      <nav className="sidenav" aria-label="Main">
        <div className="brand sidenav-brand">
          <img src="/favicon.svg" alt="" width="28" height="28" /> Finance
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="nav-link">
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="nav-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      <main className="content">
        <OfflineStatus />
        <Outlet />
      </main>
      {location.pathname !== '/transactions' && <QuickAdd />}
    </div>
  );
}
