using GamingHouse.Agent.Catalog;

namespace GamingHouse.Agent.Detection;

public abstract record LaunchVerdict
{
    private LaunchVerdict() { }
    public sealed record Waiting(string? Diagnostic) : LaunchVerdict;
    public sealed record Running(ObservedProcess Process) : LaunchVerdict;
    /// <summary>Reason uses the contract's launch_failed reasons.</summary>
    public sealed record Failed(string Reason, string Diagnostic) : LaunchVerdict;
}

/// <summary>
/// Decides whether one launch attempt produced the configured game. Only a
/// matching process in the player's session, located inside the install root,
/// counts. Steam, a launcher or a sign-in window alone never does.
/// </summary>
public sealed class LaunchWatcher(DetectionProfile profile, string installRoot, int playerSession, DateTimeOffset startedAt, Func<bool?> steamSignedIn)
{
    /// <summary>Exit code of a directly started process, when the desktop reports one.</summary>
    public int? ChildExitCode { get; set; }

    public LaunchVerdict Evaluate(IProcessSource source, DateTimeOffset now)
    {
        var steam = profile.HandoffStrategy == HandoffStrategy.SteamProcess;
        var candidates = source.Find(profile.ExecutableNames).Where(p => p.SessionId == playerSession).ToList();
        var verified = ProcessMatch.Verified(source, profile.ExecutableNames, installRoot, playerSession)
            .OrderByDescending(p => p.StartedAt ?? DateTimeOffset.MinValue).FirstOrDefault();
        if (verified is not null) return new LaunchVerdict.Running(verified);

        if (!steam && ChildExitCode is int code && code != 0 && candidates.Count == 0)
            return new LaunchVerdict.Failed("start_failed", $"The game closed with exit code {code} before it was detected.");

        if (now - startedAt < TimeSpan.FromSeconds(profile.LaunchTimeoutSeconds))
        {
            return new LaunchVerdict.Waiting(candidates.Count > 0 ? "The game process was found but its location is not confirmed yet."
                : steam ? "Waiting for Steam to start the game." : null);
        }
        if (candidates.Count > 0)
            return new LaunchVerdict.Failed("process_unreliable", $"{candidates[0].ImageName} is running, but it could not be confirmed as the installed game.");
        if (steam && steamSignedIn() == false)
            return new LaunchVerdict.Failed("login_required", "Steam is not signed in.");
        return new LaunchVerdict.Failed("timeout", steam
            ? "Steam did not start the game in time. It may be updating or waiting for a prompt."
            : $"{string.Join(", ", profile.ExecutableNames)} did not start within {profile.LaunchTimeoutSeconds} seconds.");
    }
}
