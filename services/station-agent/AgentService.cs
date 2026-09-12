using System.Diagnostics;
using System.Text.Json;
using GamingHouse.Agent.Catalog;
using GamingHouse.Agent.Detection;
using GamingHouse.Agent.Ipc;
using GamingHouse.Agent.Steam;
using GamingHouse.Agent.Session;

namespace GamingHouse.Agent;

public sealed record AgentOptions(string ConfigDirectory, bool Development, string AgentVersion);

public sealed class ClientContext(int sessionId)
{
    public int SessionId { get; } = sessionId;
    public bool Greeted { get; set; }
    public int Errors { get; set; }
}

/// <summary>
/// Resolves game IDs through the protected catalog, hands validated launch plans
/// to the interactive desktop, and confirms or rejects each attempt from real
/// process evidence. It has no session, billing or pricing authority.
/// </summary>
public sealed class AgentService
{
    public const int ProtocolVersion = 1;
    private static readonly TimeSpan StartReportTimeout = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan KeepFinishedAttempts = TimeSpan.FromMinutes(5);

    private sealed class Attempt(string id, ValidatedGame game, DateTimeOffset createdAt, DateTimeOffset startDeadline, int playerSession)
    {
        public string Id { get; } = id;
        public ValidatedGame Game { get; } = game;
        public DateTimeOffset CreatedAt { get; } = createdAt;
        public DateTimeOffset StartDeadline { get; } = startDeadline;
        public int PlayerSession { get; } = playerSession;
        public DateTimeOffset UpdatedAt { get; set; } = createdAt;
        public string State { get; set; } = "permitted";
        public LaunchWatcher? Watcher { get; set; }
        public int? ChildPid { get; set; }
    }

    private readonly object gate = new();
    private readonly AgentOptions options;
    private readonly CatalogStore store;
    private readonly IProcessSource processes;
    private readonly Func<DateTimeOffset> clock;
    private readonly Func<SteamLibrary> steam;
    private readonly Func<bool?> steamSignedIn;
    private readonly Dictionary<string, Attempt> attempts = new();
    private readonly Dictionary<int, int> childExitCodes = new();
    private readonly RunTracker runs;
    private readonly SessionCoordinator? sessions;
    private readonly Func<string, BackendPermit?> authorize;
    private PipeConnection? client;

    public AgentService(AgentOptions options, IProcessSource processes, Func<DateTimeOffset>? clock = null,
        Func<SteamLibrary>? steam = null, Func<bool?>? steamSignedIn = null, TimeSpan? exitGrace = null,
        SessionCoordinator? sessions = null, Func<string, BackendPermit?>? authorize = null)
    {
        this.options = options;
        this.sessions = sessions;
        this.authorize = authorize ?? (sessions is not null ? sessions.RequestLaunch : _ => null);
        store = new CatalogStore(options.ConfigDirectory);
        this.processes = processes;
        this.clock = clock ?? (() => DateTimeOffset.UtcNow);
        this.steam = steam ?? SteamLibrary.Detect;
        this.steamSignedIn = steamSignedIn ?? SteamLibrary.IsSignedIn;
        runs = new RunTracker(Process.GetCurrentProcess().SessionId, exitGrace ?? TimeSpan.FromSeconds(5));
    }

    public async Task ServeAsync(PipeConnection connection, CancellationToken cancellationToken)
    {
        var context = new ClientContext(connection.SessionId ?? Process.GetCurrentProcess().SessionId);
        lock (gate) { client = connection; runs.PlayerSession = context.SessionId; sessions?.SetPlayerSession(context.SessionId); }
        try
        {
            await foreach (var line in connection.ReadLinesAsync(cancellationToken))
            {
                IReadOnlyList<AgentMessage> replies;
                lock (gate) replies = Handle(line, context);
                foreach (var reply in replies) sessions?.Observe(reply);
                foreach (var reply in replies) await connection.SendAsync(reply, cancellationToken);
                if (context.Errors > 20) { AgentHost.Log("too many invalid messages; closing connection"); break; }
            }
        }
        finally
        {
            lock (gate) { if (client == connection) client = null; }
        }
    }

    public async Task MonitorAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        while (await timer.WaitForNextTickAsync(cancellationToken))
        {
            IReadOnlyList<AgentMessage> events;
            PipeConnection? target;
            lock (gate) { events = Tick(); target = client; }
            foreach (var message in events) sessions?.Observe(message);
            if (target is null) continue;
            foreach (var message in events)
            {
                try { await target.SendAsync(message, cancellationToken); }
                catch (Exception error) when (error is IOException or ObjectDisposedException) { break; }
            }
            if (sessions is not null) {
                try { await target.SendAsync(new StateMessage(null, sessions.DisplayState()), cancellationToken); }
                catch (Exception error) when (error is IOException or ObjectDisposedException) { }
            }
        }
    }

    public IReadOnlyList<AgentMessage> Handle(string line, ClientContext context)
    {
        ClientMessage? message;
        try { message = JsonSerializer.Deserialize<ClientMessage>(line, Json.Wire); }
        catch (JsonException) { message = null; }
        if (message is null) return Reject(context, null, "invalid_request", "The message was not understood.");
        if (!context.Greeted && message is not HelloMessage) return Reject(context, null, "protocol", "Send hello first.");

        switch (message)
        {
            case StateGetMessage state:
                return sessions is null ? [new ErrorMessage(state.Id, "not_enrolled", "Station is not enrolled. Ask the operator to complete setup.")]
                    : [new StateMessage(state.Id, sessions.DisplayState())];
            case HelloMessage hello:
                if (hello.Protocol != ProtocolVersion) return Reject(context, null, "protocol", $"Protocol {ProtocolVersion} is required.");
                context.Greeted = true;
                runs.PlayerSession = context.SessionId;
                return [new WelcomeMessage(ProtocolVersion, options.AgentVersion, options.Development), new RunningMessage(runs.RunningGameIds)];

            case CatalogGetMessage get:
            {
                var games = LoadCatalog(out var version, out var error);
                if (error is not null) return [new ErrorMessage(get.Id, "catalog_invalid", error)];
                var views = games.Where(g => g.Playable).Select(g => g.Entry)
                    .Select(e => new LibraryGameView(e.GameId, e.Title, e.ArtworkAsset, e.Category, e.Controller, e.Multiplayer)).ToList();
                return [new CatalogMessage(get.Id, version, views)];
            }

            case LaunchBeginMessage begin:
            {
                if (!Patterns.GameId().IsMatch(begin.GameId)) return Reject(context, begin.Id, "invalid_request", "Invalid game ID.");
                var game = LoadCatalog(out _, out var error).FirstOrDefault(g => g.Entry.GameId == begin.GameId);
                if (error is not null) return [new ErrorMessage(begin.Id, "catalog_invalid", error)];
                if (game is null) return [new ErrorMessage(begin.Id, "game_not_allowed", "This game is not in the station catalog.")];
                if (!game.Playable || game.InstallRoot is null)
                {
                    return [new ErrorMessage(begin.Id, game.Status == GameStatus.NotInstalled ? "not_installed" : "game_not_allowed",
                        $"This game cannot be launched ({game.Status}).")];
                }

                var permit = authorize(begin.GameId);
                if (permit is null) return [new ErrorMessage(begin.Id, "authorization_required", "Cashier authorization and a connected backend are required.")];
                if (attempts.ContainsKey(permit.AttemptId)) return [new ErrorMessage(begin.Id, "duplicate_attempt", "This launch attempt was already handled.")];

                var replies = new List<AgentMessage>();
                var now = clock();
                foreach (var old in attempts.Values.Where(a => a.State is "permitted" or "starting"))
                {
                    old.State = "cancelled";
                    old.UpdatedAt = now;
                    replies.Add(new AttemptMessage(old.Id, old.Game.Entry.GameId, "cancelled", null, "Replaced by a newer launch.", null, null));
                }
                if (permit.ValidForMilliseconds <= 0) return [new ErrorMessage(begin.Id, "authorization_expired", "Launch permit expired.")];
                var attempt = new Attempt(permit.AttemptId, game, now, now.AddMilliseconds(permit.ValidForMilliseconds), context.SessionId);
                attempts[attempt.Id] = attempt;
                replies.Add(new LaunchPlanMessage(begin.Id, attempt.Id, game.Entry.GameId, game.Entry.Launch, game.Entry.Detection.LaunchTimeoutSeconds, permit.ValidForMilliseconds));
                return replies;
            }

            case LaunchStartedMessage started:
            {
                if (!attempts.TryGetValue(started.AttemptId, out var attempt) || attempt.State != "permitted")
                    return Reject(context, null, "unknown_attempt", "No launch is waiting for that attempt.");
                var now = clock();
                if (now >= attempt.StartDeadline || context.SessionId != attempt.PlayerSession) return [Fail(attempt, "start_failed", "Launch permit expired or belongs to another Windows session.")];
                attempt.State = "starting";
                attempt.UpdatedAt = now;
                attempt.ChildPid = started.Pid;
                attempt.Watcher = new LaunchWatcher(attempt.Game.Entry.Detection, attempt.Game.InstallRoot!, context.SessionId, now, steamSignedIn);
                return [new AttemptMessage(attempt.Id, attempt.Game.Entry.GameId, "starting", null, null, null, null)];
            }

            case LaunchStartFailedMessage failed:
            {
                if (!attempts.TryGetValue(failed.AttemptId, out var attempt) || attempt.State != "permitted")
                    return Reject(context, null, "unknown_attempt", "No launch is waiting for that attempt.");
                return [Fail(attempt, "start_failed", $"The game could not be started: {Truncate(failed.Message)}")];
            }

            case ChildExitedMessage exited:
            {
                childExitCodes[exited.Pid] = exited.ExitCode;
                if (attempts.TryGetValue(exited.AttemptId, out var attempt) && attempt.ChildPid == exited.Pid && attempt.Watcher is not null)
                    attempt.Watcher.ChildExitCode = exited.ExitCode;
                return [];
            }

            default:
                return Reject(context, null, "invalid_request", "Unsupported message.");
        }
    }

    /// <summary>Advances launch attempts and running games from current process evidence.</summary>
    public IReadOnlyList<AgentMessage> Tick()
    {
        var events = new List<AgentMessage>();
        var now = clock();
        var runningChanged = false;
        foreach (var attempt in attempts.Values)
        {
            if (attempt.State == "permitted" && now - attempt.CreatedAt > StartReportTimeout)
                events.Add(Fail(attempt, "start_failed", "The desktop did not report starting the game."));
            if (attempt.State != "starting" || attempt.Watcher is null) continue;
            switch (attempt.Watcher.Evaluate(processes, now))
            {
                case LaunchVerdict.Running running:
                    attempt.State = "running";
                    attempt.UpdatedAt = now;
                    runs.Add(new GameRun(Guid.NewGuid().ToString(), attempt.Game.Entry.GameId, attempt.Id,
                        attempt.Game.Entry.Detection, attempt.Game.InstallRoot!, running.Process));
                    events.Add(new AttemptMessage(attempt.Id, attempt.Game.Entry.GameId, "running", null, null, running.Process.Pid,
                        running.Process.StartedAt is { } at ? Json.Utc(at) : null));
                    runningChanged = true;
                    break;
                case LaunchVerdict.Failed failed:
                    events.Add(Fail(attempt, failed.Reason, failed.Diagnostic));
                    break;
            }
        }
        foreach (var run in runs.Check(processes, now))
        {
            events.Add(new GameExitedMessage(run.GameRunId, run.GameId, childExitCodes.TryGetValue(run.Process.Pid, out var code) ? code : null));
            runningChanged = true;
        }
        if (runningChanged) events.Add(new RunningMessage(runs.RunningGameIds));
        foreach (var done in attempts.Values.Where(a => a.State is "failed" or "cancelled" or "running" && now - a.UpdatedAt > KeepFinishedAttempts).ToList())
            attempts.Remove(done.Id);
        return events;
    }

    private AttemptMessage Fail(Attempt attempt, string reason, string diagnostic)
    {
        attempt.State = "failed";
        attempt.UpdatedAt = clock();
        AgentHost.Log($"launch of {attempt.Game.Entry.GameId} failed: {reason} — {diagnostic}");
        return new AttemptMessage(attempt.Id, attempt.Game.Entry.GameId, "failed", reason, diagnostic, null, null);
    }

    private IReadOnlyList<ValidatedGame> LoadCatalog(out int version, out string? error)
    {
        try
        {
            if (!options.Development && File.Exists(store.CatalogPath) && GamingHouse.Agent.Platform.AclInspector.UntrustedWriters(store.CatalogPath, options.ConfigDirectory).Count > 0)
                throw new CatalogException("The station catalog must be administrator-owned and protected.");
            var file = store.Load();
            var duplicate = file.Games.GroupBy(g => g.GameId).FirstOrDefault(g => g.Count() > 1);
            if (duplicate is not null) throw new CatalogException($"duplicate game_id {duplicate.Key}");
            var context = new ValidationContext(steam(), options.Development && file.Development?.AllowUserWritablePaths == true);
            version = file.CatalogVersion;
            error = null;
            return file.Games.Select(g => CatalogValidator.Validate(g, context)).ToList();
        }
        catch (CatalogException failure)
        {
            version = 0;
            error = failure.Message;
            AgentHost.Log($"catalog error: {failure.Message}");
            return [];
        }
    }

    private static IReadOnlyList<AgentMessage> Reject(ClientContext context, string? id, string code, string message)
    {
        context.Errors++;
        return [new ErrorMessage(id, code, message)];
    }

    private static string Truncate(string text) => text.Length <= 200 ? text : text[..200];
}
