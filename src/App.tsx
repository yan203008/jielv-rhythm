import { FormEvent, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import RoutineApp from './routine-app';
import { supabase, supabaseConfigured } from './supabase';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) return <SetupNotice />;
  if (loading) return <div className="signin-shell"><div className="loading-mark">律</div></div>;
  if (!session) return <EmailSignIn />;

  return (
    <RoutineApp
      user={{
        id: session.user.id,
        name: session.user.email ?? '我的账号',
        onSignOut: () => { void supabase!.auth.signOut(); },
      }}
    />
  );
}

function EmailSignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !email.trim()) return;
    setSending(true);
    setMessage('');
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    });
    setSending(false);
    if (error) setMessage(error.message);
    else setSent(true);
  }

  return (
    <main className="signin-shell">
      <section className="signin-card">
        <span className="brand-mark">律</span>
        <p className="eyebrow">RHYTHM</p>
        <h1>把计划、生活和思考放回同一个节律里。</h1>
        <p>使用邮箱登录。手机和电脑使用同一邮箱，就会看到同一份数据。</p>
        {sent ? (
          <div className="auth-success"><strong>登录邮件已发送</strong><p>请打开邮件中的登录链接。第一次登录会自动创建账号。</p><button className="text-button" onClick={() => setSent(false)}>换一个邮箱</button></div>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <label><span>邮箱</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" required /></label>
            <button className="primary-button" type="submit" disabled={sending}>{sending ? '发送中…' : '发送登录链接'}</button>
            {message && <p className="auth-error">{message}</p>}
          </form>
        )}
      </section>
    </main>
  );
}

function SetupNotice() {
  return (
    <main className="signin-shell">
      <section className="signin-card">
        <span className="brand-mark">律</span>
        <p className="eyebrow">SETUP REQUIRED</p>
        <h1>等待连接云数据库</h1>
        <p>代码已经就绪。完成 Supabase 配置后，这里会自动切换为邮箱登录页面。</p>
      </section>
    </main>
  );
}
