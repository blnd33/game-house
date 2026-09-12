using GamingHouse.Agent.Catalog;

namespace GamingHouse.Agent.Detection;

public sealed record GameRun(string GameRunId, string GameId, string AttemptId, DetectionProfile Profile, string InstallRoot, ObservedProcess Process);

/// <summary>
/// Follows confirmed game runs until they end. A run survives its process being
/// replaced by another verified process of the same game (restarts, bootstrap
/// handoffs); it ends only after the game has been gone for the grace period.
/// Game exits are telemetry: they never end a paid session.
/// </summary>
public sealed class RunTracker(int playerSession, TimeSpan exitGrace)
{
    private readonly Dictionary<string, (GameRun Run, DateTimeOffset? MissingSince)> runs = new();

    public int PlayerSession { get; set; } = playerSession;
    public IReadOnlyList<GameRun> Runs => runs.Values.Select(v => v.Run).ToList();
    public IReadOnlyList<string> RunningGameIds => runs.Values.Select(v => v.Run.GameId).Distinct().ToList();

    public void Add(GameRun run)
    {
        foreach (var existing in runs.Where(r => r.Value.Run.GameId == run.GameId).Select(r => r.Key).ToList()) runs.Remove(existing);
        runs[run.GameRunId] = (run, null);
    }

    public IReadOnlyList<GameRun> Check(IProcessSource source, DateTimeOffset now)
    {
        var exited = new List<GameRun>();
        foreach (var (id, (run, missingSince)) in runs.ToList())
        {
            if (source.IsAlive(run.Process)) { runs[id] = (run, null); continue; }
            var replacement = ProcessMatch.Verified(source, run.Profile.ExecutableNames, run.InstallRoot, PlayerSession)
                .FirstOrDefault(p => p.Pid != run.Process.Pid);
            if (replacement is not null) { runs[id] = (run with { Process = replacement }, null); continue; }
            var since = missingSince ?? now;
            if (now - since >= exitGrace) { runs.Remove(id); exited.Add(run); }
            else runs[id] = (run, since);
        }
        return exited;
    }
}
