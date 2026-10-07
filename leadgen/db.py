"""Lokale SQLite-Datenbank: Lead-Pipeline (Status, Notizen) und Abfrage-Cache."""

import json
import sqlite3
import threading
import time
from datetime import datetime

STATUSES = ["neu", "interessant", "kontaktiert", "termin", "angebot", "kunde", "kein_interesse"]

_lock = threading.Lock()


class Store:
    def __init__(self, path):
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        with _lock, self.conn:
            self.conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS leads (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'neu',
                    notes TEXT NOT NULL DEFAULT '',
                    first_seen TEXT NOT NULL,
                    last_seen TEXT NOT NULL,
                    updated TEXT
                );
                CREATE TABLE IF NOT EXISTS cache (
                    key TEXT PRIMARY KEY,
                    created REAL NOT NULL,
                    value TEXT NOT NULL
                );
                """
            )

    # --- Cache -------------------------------------------------------------
    def cache_get(self, key, max_age):
        row = self.conn.execute("SELECT created, value FROM cache WHERE key=?", (key,)).fetchone()
        if row and time.time() - row["created"] < max_age:
            return json.loads(row["value"])
        return None

    def cache_set(self, key, value):
        with _lock, self.conn:
            self.conn.execute(
                "INSERT OR REPLACE INTO cache(key, created, value) VALUES (?,?,?)",
                (key, time.time(), json.dumps(value)),
            )

    # --- Leads -------------------------------------------------------------
    def upsert(self, leads):
        """Speichert Suchergebnisse. Gibt die IDs zurück, die vorher unbekannt waren."""
        now = datetime.now().isoformat(timespec="seconds")
        fresh = []
        with _lock, self.conn:
            for lead in leads:
                payload = json.dumps(lead, ensure_ascii=False)
                cur = self.conn.execute(
                    "UPDATE leads SET data=?, last_seen=? WHERE id=?", (payload, now, lead["id"])
                )
                if cur.rowcount == 0:
                    self.conn.execute(
                        "INSERT INTO leads(id, data, first_seen, last_seen) VALUES (?,?,?,?)",
                        (lead["id"], payload, now, now),
                    )
                    fresh.append(lead["id"])
        return fresh

    def annotate(self, leads):
        """Ergänzt Status/Notizen/first_seen aus der Datenbank."""
        if not leads:
            return leads
        ids = [lead["id"] for lead in leads]
        rows = {}
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            q = f"SELECT id, status, notes, first_seen FROM leads WHERE id IN ({','.join('?' * len(chunk))})"
            rows.update({r["id"]: r for r in self.conn.execute(q, chunk)})
        for lead in leads:
            row = rows.get(lead["id"])
            lead["status"] = row["status"] if row else "neu"
            lead["notes"] = row["notes"] if row else ""
            lead["first_seen"] = row["first_seen"] if row else ""
        return leads

    def known_categories(self, ags):
        """Kategorien, die für diesen Kreis schon einmal gescannt wurden."""
        rows = self.conn.execute(
            "SELECT DISTINCT json_extract(data, '$.category') FROM leads WHERE json_extract(data, '$.kreis') = ?",
            (ags,),
        )
        return {r[0] for r in rows}

    def update(self, lead_id, status=None, notes=None):
        if status is not None and status not in STATUSES:
            raise ValueError(f"Ungültiger Status: {status}")
        now = datetime.now().isoformat(timespec="seconds")
        with _lock, self.conn:
            row = self.conn.execute("SELECT id FROM leads WHERE id=?", (lead_id,)).fetchone()
            if not row:
                raise KeyError(lead_id)
            if status is not None:
                self.conn.execute("UPDATE leads SET status=?, updated=? WHERE id=?", (status, now, lead_id))
            if notes is not None:
                self.conn.execute("UPDATE leads SET notes=?, updated=? WHERE id=?", (notes, now, lead_id))

    def add_manual(self, lead):
        """Lead manuell anlegen (z. B. aus dem News-Radar)."""
        self.upsert([lead])
        self.update(lead["id"], status="interessant")

    def pipeline(self):
        """Alle Leads, die bearbeitet wurden (Status != neu oder mit Notiz)."""
        rows = self.conn.execute(
            "SELECT * FROM leads WHERE status != 'neu' OR notes != '' ORDER BY updated DESC"
        ).fetchall()
        result = []
        for r in rows:
            lead = json.loads(r["data"])
            lead.update(status=r["status"], notes=r["notes"], first_seen=r["first_seen"], updated=r["updated"])
            result.append(lead)
        return result
