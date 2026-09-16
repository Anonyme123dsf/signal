export function NotConfigured() {
  return (
    <div className="card">
      <h2 className="text-lg font-medium mb-2">Supabase ist nicht konfiguriert</h2>
      <p className="text-sm text-[#9c9cba] mb-3">
        Das Dashboard liest die Daten des Workers aus Supabase. Setze diese Umgebungsvariablen (lokal in <code>.env.local</code>, auf Vercel in den Projekteinstellungen):
      </p>
      <pre className="text-xs">{`SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...`}</pre>
      <p className="text-sm text-[#9c9cba] mt-3">
        Vorher die Migration <code>supabase/migrations/0001_arbitrage.sql</code> im SQL-Editor ausführen. Details in der README.
      </p>
    </div>
  );
}
