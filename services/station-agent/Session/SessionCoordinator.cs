using System.Diagnostics;
using System.Net;
using System.Text.Json.Nodes;
using GamingHouse.Agent.Ipc;

namespace GamingHouse.Agent.Session;

public sealed record BackendPermit(string AttemptId, string SessionId, long StationEpoch, DateTimeOffset ExpiresAt, long ValidForMilliseconds = 20000);

/// <summary>Durable station observations and device API access. No financial arithmetic.</summary>
public sealed class SessionCoordinator : IDisposable
{
    private readonly object gate = new();
    private readonly StationSettings settings;
    private readonly StateStore store;
    private readonly CredentialVault vault;
    private readonly CredentialVault renewalVault;
    private readonly BackendTransport transport;
    private readonly Stopwatch monotonic = Stopwatch.StartNew();
    private readonly string boot = Guid.NewGuid().ToString(); // A conservative new monitoring epoch after agent restart.
    private long sequence, heartbeatSequence;
    private JsonObject? snapshot;
    private JsonObject? configuration;
    private string connection = "connecting";
    private string? sessionId, segmentId;
    private double segmentStart, leaseDeadline;
    private int playerSession;
    private readonly Dictionary<string, JsonObject> running = new();
    private JsonObject launch = new() { ["phase"] = "idle" };
    private double lastObservation;
    private int leaseEnforced, activeLease;
    private double observedBase, observedSeconds, lastUseTick;
    private string segmentStartedUtc = Json.Utc(DateTimeOffset.UtcNow);
    public Func<int, string, string> Restrict { get; set; } = (_, _) => "restriction_not_configured";

    public SessionCoordinator(StationSettings settings, string directory)
    {
        this.settings = settings; store = new StateStore(directory); vault = new CredentialVault(directory, settings.Development);
        renewalVault = new CredentialVault(directory, settings.Development, "renewal.bin");
        transport = new BackendTransport(settings, vault);
        snapshot = JsonNode.Parse(store.Get("snapshot") ?? "null") as JsonObject;
        sessionId = snapshot?["snapshot"]?["session"]?["session_id"]?.GetValue<string>();
        playerSession = int.TryParse(store.Get("player-session"), out var savedPlayer) ? savedPlayer : 0;
        observedBase = observedSeconds = double.TryParse(store.Get("observed:" + sessionId), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var savedUse) ? savedUse : 0;
        connection = "disconnected"; leaseDeadline = 0; // Never revive access from a cached wall clock.
        activeLease = Text(snapshot?["snapshot"]?["session"]?["state"]) is "active" or "pending" ? 1 : 0;
    }
    private static string? Text(JsonNode? n) => n?.GetValue<string>();
    private JsonObject RequestBody() => new() { ["api_version"] = "1", ["request_id"] = Guid.NewGuid().ToString(), ["station_id"] = settings.StationId, ["sent_at"] = Json.Utc(DateTimeOffset.UtcNow) };
    public JsonObject DisplayState()
    {
        lock (gate) return new JsonObject {
            ["source"] = "native", ["station_label"] = settings.StationLabel, ["connection"] = connection,
            ["backend_mode"] = settings.Development ? "development" : "partner",
            ["snapshot"] = snapshot?.DeepClone(), ["launch"] = launch.DeepClone(),
            ["running_game_ids"] = new JsonArray(running.Values.Select(r => (JsonNode?)JsonValue.Create(Text(r["game_id"]))).ToArray()),
            ["station_use"] = sessionId is not null && segmentId is not null ? new JsonObject { ["observed_seconds"] = (long)observedSeconds, ["coverage"] = "continuous" } : null,
            ["help"] = "idle",
        };
    }
    public void SetPlayerSession(int id) { lock (gate) { playerSession = id; store.Put("player-session", id.ToString(System.Globalization.CultureInfo.InvariantCulture)); } }
    private void Accept(JsonObject response)
    {
        if (response["snapshot"] is not JsonObject snap) throw new InvalidDataException("Backend snapshot missing.");
        var previousRevision = snapshot?["snapshot"]?["revision"]?.GetValue<long>() ?? 0;
        if ((snap["revision"]?.GetValue<long>() ?? 0) < previousRevision) return;
        if (snapshot is not null && DateTimeOffset.Parse(Text(response["server_time"])!) < DateTimeOffset.Parse(Text(snapshot["server_time"])!)) return;
        var nextId = Text(snap["session"]?["session_id"]);
        UpdateUse();
        if (Text(snapshot?["snapshot"]?["session"]?["state"]) is "active" or "pending" && Text(snap["session"]?["state"]) is not ("active" or "pending")) ObserveDuration();
        if (nextId != sessionId) { sessionId = nextId; segmentId = nextId is null ? null : Guid.NewGuid().ToString(); segmentStart = monotonic.Elapsed.TotalSeconds; segmentStartedUtc = Text(response["server_time"])!; observedBase = observedSeconds = 0; running.Clear(); }
        // Recovered sessions get a new segment, never infer continuity across service restarts.
        if (nextId is not null && segmentId is null) { segmentId = Guid.NewGuid().ToString(); segmentStart = monotonic.Elapsed.TotalSeconds; segmentStartedUtc = Text(response["server_time"])!; }
        snapshot = new JsonObject { ["api_version"] = "1", ["request_id"] = response["request_id"]!.DeepClone(), ["station_id"] = settings.StationId, ["server_time"] = response["server_time"]!.DeepClone(), ["snapshot"] = snap.DeepClone() };
        var serverTime = DateTimeOffset.Parse(Text(response["server_time"])!);
        leaseDeadline = DateTimeOffset.TryParse(Text(snap["authorized_play_until"]), out var until)
            ? monotonic.Elapsed.TotalSeconds + Math.Max(0, (until - serverTime).TotalSeconds - 5) : 0; // Account for entire bounded HTTP round trip.
        store.Put("snapshot", snapshot.ToJsonString()); connection = "connected";
        if (leaseDeadline > monotonic.Elapsed.TotalSeconds) Interlocked.Exchange(ref leaseEnforced, 0);
        Volatile.Write(ref activeLease, Text(snap["session"]?["state"]) is "active" or "pending" ? 1 : 0);
    }
    public BackendPermit? RequestLaunch(string gameId)
    {
        lock (gate) {
            if (connection != "connected" || store.Get("maintenance") == "1") return null;
            try {
                Accept(transport.Request("snapshot"));
                var snap = snapshot!["snapshot"]!;
                var auth = snap["authorization"];
                if (auth is null || Text(snap["restriction"]?["state"]) != "unrestricted") return null;
                var old = store.Get("pending-launch");
                JsonObject body;
                if (old is not null) {
                    body = JsonNode.Parse(old)!.AsObject();
                    if (Text(body["game_id"]) != gameId) return null; // Resolve uncertain earlier request first.
                } else {
                    body = RequestBody(); body["session_id"] = sessionId; body["authorization_id"] = auth["authorization_id"]!.DeepClone();
                    body["station_epoch"] = snap["station_epoch"]!.DeepClone(); body["game_id"] = gameId; body["boot_id"] = boot;
                    body["expected_snapshot_revision"] = snap["revision"]!.DeepClone(); store.Put("pending-launch", body.ToJsonString());
                }
                var reply = transport.Request("launches", body, Text(body["request_id"])); Accept(reply);
                if (store.Get("maintenance") == "1") return null;
                var attempt = reply["attempt"]!;
                var expires = DateTimeOffset.Parse(Text(attempt["expires_at"])!);
                var serverNow = DateTimeOffset.Parse(Text(reply["server_time"])!);
                var remaining = (long)Math.Max(0, Math.Min(20000, (expires - serverNow).TotalMilliseconds - 5000));
                var permit = new BackendPermit(Text(attempt["attempt_id"])!, Text(attempt["session_id"])!, attempt["station_epoch"]!.GetValue<long>(), expires, remaining);
                store.Remove("pending-launch");
                if (remaining <= 0 || permit.SessionId != sessionId || permit.ExpiresAt <= serverNow || store.Get("launched:" + permit.AttemptId) is not null) return null;
                store.Put("launched:" + permit.AttemptId, reply.ToJsonString());
                ObserveDuration();
                launch = new JsonObject { ["phase"] = "starting", ["game_id"] = gameId };
                return permit;
            } catch (BackendException error) {
                if ((int)error.Status is >= 400 and < 500) store.Remove("pending-launch");
                connection = "stale"; return null;
            } catch (Exception error) when (error is HttpRequestException or IOException or TaskCanceledException or InvalidDataException) { connection = "disconnected"; return null; }
        }
    }
    private JsonObject Event(string type, string eventSession)
    {
        var e = new JsonObject { ["api_version"] = "1", ["event_id"] = Guid.NewGuid().ToString(), ["station_id"] = settings.StationId, ["session_id"] = eventSession,
            ["boot_id"] = boot, ["sequence"] = ++sequence, ["observed_at"] = Json.Utc(DateTimeOffset.UtcNow), ["monotonic_elapsed_ms"] = monotonic.ElapsedMilliseconds, ["type"] = type };
        return e;
    }
    public void Observe(AgentMessage message)
    {
        lock (gate) {
            if (sessionId is null) return;
            if (message is AttemptMessage a && a.State is "running" or "failed" or "cancelled") {
                var permitJson = store.Get("launched:" + a.AttemptId); if (permitJson is null) return;
                var permit = JsonNode.Parse(permitJson)!["attempt"]!;
                if (Text(permit["session_id"]) != sessionId) return;
                if (a.State == "running") {
                    var run = new JsonObject { ["session_id"] = sessionId, ["attempt_id"] = a.AttemptId, ["game_run_id"] = Guid.NewGuid().ToString(), ["game_id"] = a.GameId, ["process_started_at"] = a.ProcessStartedAt ?? Json.Utc(DateTimeOffset.UtcNow) };
                    running[a.GameId] = run;
                    var e = Event("game_running", sessionId); foreach (var p in run) if (p.Key != "session_id") e[p.Key] = p.Value?.DeepClone();
                    e["detection_profile_version"] = "local-1"; store.Enqueue(e); launch = new JsonObject { ["phase"] = "idle" };
                } else {
                    var e = Event("launch_failed", sessionId); e["attempt_id"] = a.AttemptId; e["game_id"] = a.GameId;
                    e["reason"] = a.Reason is "timeout" or "not_installed" or "login_required" or "process_unreliable" or "communication_lost" ? a.Reason : "start_failed";
                    e["diagnostic"] = a.Diagnostic; store.Enqueue(e);
                    launch = new JsonObject { ["phase"] = "failed", ["game_id"] = a.GameId, ["reason"] = e["reason"]!.DeepClone() };
                }
            } else if (message is GameExitedMessage exit && running.Remove(exit.GameId, out var run)) {
                var e = Event("game_exited", sessionId); foreach (var key in new[] { "attempt_id", "game_run_id", "game_id" }) e[key] = run[key]!.DeepClone(); e["exit_code"] = exit.ExitCode; store.Enqueue(e);
            }
        }
    }
    private void ObserveDuration()
    {
        if (sessionId is null || segmentId is null || Text(snapshot?["snapshot"]?["session"]?["state"]) is not ("active" or "pending")) return;
        var e = Event("station_use_observed", sessionId); e["segment_id"] = segmentId;
        e["segment_started_at"] = segmentStartedUtc;
        e["observed_station_use_seconds"] = (long)Math.Max(0, observedSeconds - observedBase); e["coverage"] = "continuous"; store.Enqueue(e);
    }
    private void UpdateUse()
    {
        var now = monotonic.Elapsed.TotalSeconds;
        if (sessionId is not null && Text(snapshot?["snapshot"]?["session"]?["state"]) is "active" or "pending") {
            observedSeconds += Math.Max(0, Math.Min(now, leaseDeadline) - lastUseTick);
            store.Put("observed:" + sessionId, observedSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }
        lastUseTick = now;
    }
    private void SendOutbox()
    {
        var batch = store.Get("pending-events");
        var pending = store.Pending(); if (batch is null && pending.Count == 0) return;
        var body = batch is null ? RequestBody() : JsonNode.Parse(batch)!.AsObject();
        if (batch is null) { body["events"] = new JsonArray(pending.Select(p => (JsonNode?)p.DeepClone()).ToArray()); store.Put("pending-events", body.ToJsonString()); }
        var response = transport.Request("events", body, Text(body["request_id"]));
        foreach (var result in response["results"]!.AsArray()) store.Acknowledge(Text(result!["event_id"])!, Text(result["outcome"])!);
        store.Remove("pending-events"); Accept(response);
    }
    private void Commands()
    {
        var response = transport.Request("commands"); Accept(response);
        foreach (var command in response["commands"]!.AsArray()) {
            var id = Text(command!["command_id"])!;
            var prior = store.Get("command:" + id);
            JsonObject result;
            if (prior is not null) result = JsonNode.Parse(prior)!.AsObject();
            else {
                var snap = snapshot!["snapshot"]!;
                var matches = Text(command["station_id"]) == settings.StationId && Text(command["session_id"]) == sessionId && command["station_epoch"]!.GetValue<long>() == snap["station_epoch"]!.GetValue<long>();
                var expired = DateTimeOffset.Parse(Text(command["expires_at"])!) <= DateTimeOffset.Parse(Text(response["server_time"])!);
                var outcome = !matches ? "rejected_stale" : expired ? "expired" : "failed";
                var failure = !matches ? "session_mismatch" : expired ? "command_expired" : "restriction_not_configured";
                if (matches && !expired && Text(command["type"]) == "restrict_station") {
                    store.Put("command-pending:" + id, command.ToJsonString());
                    failure = Restrict(playerSession, Text(command["restriction_profile_id"])!);
                    if (failure == "verified") outcome = "verified";
                }
                result = RequestBody(); result["session_id"] = command["session_id"]!.DeepClone(); result["station_epoch"] = command["station_epoch"]!.DeepClone(); result["command_id"] = id;
                result["boot_id"] = boot; result["result_id"] = Guid.NewGuid().ToString(); result["attempted_at"] = Json.Utc(DateTimeOffset.UtcNow);
                result["outcome"] = outcome; result["restriction_state"] = outcome == "verified" ? "restricted" : "failed";
                result["verified_at"] = outcome == "verified" ? Json.Utc(DateTimeOffset.UtcNow) : null;
                result["evidence"] = outcome == "verified" ? "WTS session reports disconnected." : null; result["failure_code"] = outcome == "verified" ? null : failure;
                store.Put("command:" + id, result.ToJsonString());
            }
            Accept(transport.Request("commands/results", result, Text(result["result_id"])));
        }
    }
    public async Task RunAsync(CancellationToken stop)
    {
        var failures = 0;
        while (!stop.IsCancellationRequested) {
            lock (gate) {
                try {
                    if (configuration is null) configuration = transport.Request("configuration")["config"]!.AsObject();
                    Accept(transport.Request("snapshot"));
                    Commands();
                    if (monotonic.Elapsed.TotalSeconds - lastObservation >= 5) { ObserveDuration(); lastObservation = monotonic.Elapsed.TotalSeconds; }
                    SendOutbox();
                    var heartbeat = RequestBody(); heartbeat["boot_id"] = boot; heartbeat["sequence"] = ++heartbeatSequence; heartbeat["monotonic_elapsed_ms"] = monotonic.ElapsedMilliseconds;
                    heartbeat["session_id"] = sessionId; heartbeat["last_snapshot_revision"] = snapshot!["snapshot"]!["revision"]!.DeepClone();
                    heartbeat["restriction"] = snapshot["snapshot"]!["restriction"]!.DeepClone(); heartbeat["running_games"] = new JsonArray(running.Values.Select(v => (JsonNode?)v.DeepClone()).ToArray()); heartbeat["outbox_depth"] = store.Pending().Count;
                    Accept(transport.Request("heartbeat", heartbeat, Text(heartbeat["request_id"]))); failures = 0;
                } catch (BackendException error) {
                    connection = "disconnected"; failures++;
                    if (error.Status == HttpStatusCode.Unauthorized) {
                        try {
                            var body = renewalVault.Exists ? renewalVault.Read() : RequestBody();
                            if (!renewalVault.Exists) { var credentials = vault.Read(); body["credential_id"] = credentials["credential_id"]!.DeepClone(); body["renewal_token"] = credentials["renewal_token"]!.DeepClone(); renewalVault.Write(body); }
                            vault.Write(transport.Request("credentials/renew", body, Text(body["request_id"]), true)["credentials"]!.AsObject()); renewalVault.Remove();
                        } catch { /* Keep disconnected; operator re-pairing may be required. Never print credentials. */ }
                    }
                } catch (Exception error) when (error is HttpRequestException or IOException or TaskCanceledException or InvalidDataException or System.Text.Json.JsonException) { connection = "disconnected"; failures++; }
            }
            var delay = failures == 0 ? (configuration?["heartbeat_interval_seconds"]?.GetValue<int>() ?? 1) * 1000
                : Math.Max(250, Random.Shared.NextDouble() * Math.Min(30000, 1000 * Math.Pow(2, Math.Min(5, failures))));
            await Task.Delay(TimeSpan.FromMilliseconds(delay), stop);
        }
    }
    public async Task WatchAuthorizationAsync(CancellationToken stop)
    {
        // Independent of slow HTTPS calls/backoff; no coordinator lock is taken here.
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(250));
        while (await timer.WaitForNextTickAsync(stop)) {
            if (Volatile.Read(ref playerSession) > 0 && Volatile.Read(ref activeLease) == 1 && monotonic.Elapsed.TotalSeconds >= Volatile.Read(ref leaseDeadline) &&
                Interlocked.CompareExchange(ref leaseEnforced, 1, 0) == 0) {
                var outcome = Restrict(Volatile.Read(ref playerSession), "disconnect-session-v1");
                store.Put("offline-restriction", outcome);
            }
        }
    }
    public void Dispose() { transport.Dispose(); store.Dispose(); }
}
