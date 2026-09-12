using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace GamingHouse.Agent.Session;

public sealed class StateStore : IDisposable
{
    private readonly SqliteConnection db;
    private readonly object gate = new();
    public StateStore(string directory)
    {
        Directory.CreateDirectory(directory);
        db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(directory, "station.sqlite") }.ToString());
        db.Open();
        Execute("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS outbox (event_id TEXT PRIMARY KEY, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending');");
    }
    private void Execute(string sql, params (string Name, object Value)[] parameters)
    {
        using var cmd = db.CreateCommand(); cmd.CommandText = sql;
        foreach (var p in parameters) cmd.Parameters.AddWithValue(p.Name, p.Value);
        cmd.ExecuteNonQuery();
    }
    public string? Get(string key)
    {
        lock (gate) { using var cmd = db.CreateCommand(); cmd.CommandText = "SELECT value FROM kv WHERE key=$key"; cmd.Parameters.AddWithValue("$key", key); return cmd.ExecuteScalar() as string; }
    }
    public void Put(string key, string value) { lock (gate) Execute("INSERT OR REPLACE INTO kv VALUES($key,$value)", ("$key", key), ("$value", value)); }
    public void Remove(string key) { lock (gate) Execute("DELETE FROM kv WHERE key=$key", ("$key", key)); }
    public void Enqueue(JsonObject value)
    {
        lock (gate) Execute("INSERT OR IGNORE INTO outbox(event_id,payload) VALUES($id,$payload)", ("$id", value["event_id"]!.GetValue<string>()), ("$payload", value.ToJsonString()));
    }
    public IReadOnlyList<JsonObject> Pending()
    {
        lock (gate) {
            using var cmd = db.CreateCommand(); cmd.CommandText = "SELECT payload FROM outbox WHERE state='pending' ORDER BY rowid LIMIT 100";
            using var reader = cmd.ExecuteReader(); var values = new List<JsonObject>();
            while (reader.Read()) values.Add(JsonNode.Parse(reader.GetString(0))!.AsObject()); return values;
        }
    }
    public void Acknowledge(string id, string outcome)
    {
        lock (gate) {
            if (outcome is "accepted" or "duplicate") Execute("DELETE FROM outbox WHERE event_id=$id", ("$id", id));
            else if (outcome == "rejected") Execute("UPDATE outbox SET state='rejected' WHERE event_id=$id", ("$id", id));
        }
    }
    public void Dispose() { lock (gate) db.Dispose(); }
}
