import { fmtNum, fmtTime } from "@/lib/arbitrage/format";
import { getListings } from "@/lib/arbitrage/queries";
import { addListing, closeListing } from "../actions";
import { NotConfigured } from "../components/NotConfigured";

export const dynamic = "force-dynamic";

export default async function ListingsPage() {
  const data = await getListings();
  if (!data) return <NotConfigured />;
  const listingsFee = data.markets.find((m) => m.id === "listings")?.taker_fee_bps;

  return (
    <>
      <section className="card">
        <h2 className="text-sm font-medium mb-1">Inserat erfassen</h2>
        <p className="text-xs text-[#7c7c9a] mb-4">
          Angebote und Gesuche aus Kleinanzeigen, Foren oder direkten Anfragen. Der Worker vergleicht sie mit Börsenkursen und untereinander
          und legt bei einer Gelegenheit einen Nachrichtenentwurf an den Kontakt an.
          {listingsFee !== undefined && ` Kostenaufschlag für Inserate: ${fmtNum(listingsFee, 0)} bps (Tabelle markets, id "listings").`}
        </p>
        <form action={addListing} className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label>Symbol</label><input name="symbol" placeholder="BTC/EUR" required /></div>
          <div><label>Seite</label><select name="side" defaultValue="sell"><option value="sell">bietet an (Verkauf)</option><option value="buy">sucht (Kauf)</option></select></div>
          <div><label>Preis</label><input name="price" type="number" step="any" min="0" placeholder="58000" required /></div>
          <div><label>Menge</label><input name="quantity" type="number" step="any" min="0" placeholder="0.05" required /></div>
          <div><label>Kontakt Name</label><input name="contact_name" placeholder="Anna Beispiel" /></div>
          <div><label>Kontakt E-Mail</label><input name="contact_email" type="email" placeholder="anna@example.com" /></div>
          <div className="col-span-2"><label>Link zum Inserat</label><input name="external_url" type="url" placeholder="https://…" /></div>
          <div className="col-span-2 md:col-span-4"><button className="btn btn-primary">Inserat speichern</button></div>
        </form>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="text-sm font-medium mb-3">Inserate</h2>
        {data.listings.length === 0 ? (
          <p className="text-sm text-[#7c7c9a]">Noch keine Inserate.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Erfasst</th><th>Symbol</th><th>Seite</th><th className="num">Preis</th><th className="num">Menge</th><th>Kontakt</th><th>Link</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {data.listings.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap text-[#9c9cba]">{fmtTime(l.created_at)}</td>
                  <td className="font-medium">{l.symbol}</td>
                  <td>{l.side === "sell" ? "bietet an" : "sucht"}</td>
                  <td className="num">{fmtNum(l.price)}</td>
                  <td className="num">{fmtNum(l.quantity, 6)}</td>
                  <td>{l.contact ? <>{l.contact.name}<br /><span className="text-xs text-[#7c7c9a]">{l.contact.email}</span></> : <span className="text-[#7c7c9a]">ohne Kontakt</span>}</td>
                  <td>{l.external_url ? <a className="text-[#8b8bff] underline" href={l.external_url} target="_blank" rel="noreferrer">öffnen</a> : "–"}</td>
                  <td><span className="badge">{l.status === "active" ? "aktiv" : "geschlossen"}</span></td>
                  <td>{l.status === "active" && <form action={closeListing}><input type="hidden" name="listing_id" value={l.id} /><button className="btn">Schließen</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
