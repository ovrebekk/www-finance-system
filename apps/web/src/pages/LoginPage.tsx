import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Me } from '@finance/shared';
import { api, errorMessage } from '../lib/api';
import { keys } from '../lib/queries';

export function LoginPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const me = await api<Me>('/auth/login', { method: 'POST', body: { email, password } });
      qc.setQueryData(keys.me, me);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand login-brand">
          <img src="/favicon.svg" alt="" width="40" height="40" />
          <span>Finance</span>
        </div>
        <label className="field">
          <span className="field-label">Email</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="error-box">{error}</div>}
        <button type="submit" className="button button-primary button-block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
