/*
 * Bildschirmzeit für Tobis Widget: Android zählt die Bewerbungszentrale als
 * „Chrome“. js/bildschirmzeit.js – eine wortgleiche Kopie aus dem Repo
 * Finanzdienste/Bildschirmzeit (web/bildschirmzeit.js, nur dort ändern) –
 * misst, wie lange die App heute sichtbar offen war, und meldet es an
 * Supabase; die Widget-App zieht das von Chrome ab und zeigt „Bewerbungen“.
 *
 * Verbunden wird nur über den Link aus der Widget-App
 * (…/Bewerbungszentrale/#bildschirmzeit=<Kennung>). Ohne ihn misst, schickt
 * und zeigt nichts davon etwas.
 *
 * index.html ist ein klassisches Skript und läuft vor diesem Modul (Module
 * kommen erst, wenn die Seite gelesen ist). Deshalb lässt route() in
 * index.html den Link in der Adresse stehen; dieses Modul nimmt ihn heraus.
 * Für den Abschnitt unter „Profil & Daten“ und den Hinweis legt es seine
 * Funktionen unter window.bzBildschirmzeit ab.
 */
import {
  bildschirmzeitStarten, bildschirmzeitStand, bildschirmzeitTrennen, dauerText, BZ_EREIGNIS,
} from './bildschirmzeit.js';

window.bzBildschirmzeit = { stand: bildschirmzeitStand, trennen: bildschirmzeitTrennen, dauerText };
bildschirmzeitStarten('bewerbungszentrale', { meldung: (text) => window.bzMeldung?.(text) });
// index.html hat schon gezeichnet, bevor es dieses Modul gab: einmal nachziehen.
window.dispatchEvent(new CustomEvent(BZ_EREIGNIS));
