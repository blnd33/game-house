using System.Diagnostics;
using System.Text.RegularExpressions;
using GamingHouse.Agent.Detection;
using GamingHouse.Agent.Ipc;
using GamingHouse.Agent.Session;

namespace GamingHouse.Agent;

/// <summary>
/// Runs the agent as a console process. Installing it as a Windows Service (the
/// production host, running outside the player's session) is Phase 5.
/// </summary>
public static partial class AgentHost
{
    [GeneratedRegex("^[A-Za-z0-9._-]{1,100}$")]
    private static partial Regex PipeName();

    public static void Log(string message) => Console.Error.WriteLine($"{DateTime.Now:HH:mm:ss} {message}");

    public static async Task<int> RunAsync(CommandLine cli, string version, CancellationToken serviceStop = default)
    {
        var pipe = cli.Value("--pipe") ?? PipeServer.DefaultName;
        if (!PipeName().IsMatch(pipe)) { Log("invalid --pipe name"); return 2; }
        var options = new AgentOptions(cli.ConfigDirectory, cli.Flag("--dev"), version);

        using var stop = CancellationTokenSource.CreateLinkedTokenSource(serviceStop);
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Cancel(); };
        if (cli.Value("--parent-pid") is { } parent && int.TryParse(parent, out var parentPid)) _ = ExitWithParentAsync(parentPid, stop);

        var settings = StationSettings.Load(options.ConfigDirectory, options.Development);
        using var sessions = settings is null ? null : new SessionCoordinator(settings, options.ConfigDirectory);
        if (sessions is not null) sessions.Restrict = (sessionId, profile) => WindowsRestriction.Apply(sessionId, profile, settings!.EnableRestriction && !settings.Development, settings.PlayerSid);
        var clockStart = DateTimeOffset.UtcNow; var elapsed = Stopwatch.StartNew();
        var service = new AgentService(options, new WindowsProcessSource(), () => clockStart + elapsed.Elapsed, sessions: sessions);
        var server = new PipeServer(pipe, service.ServeAsync, settings?.PlayerSid, options.Development ? null : Environment.ProcessPath);
        Log($"Gaming House agent {version} on \\\\.\\pipe\\{pipe}; catalog {options.ConfigDirectory}{(options.Development ? " (development)" : "")}");
        try
        {
            await Task.WhenAll(server.RunAsync(stop.Token), service.MonitorAsync(stop.Token), sessions?.RunAsync(stop.Token) ?? Task.CompletedTask, sessions?.WatchAuthorizationAsync(stop.Token) ?? Task.CompletedTask);
        }
        catch (OperationCanceledException) { }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            Log($"cannot open the station pipe (is another agent running?): {error.Message}");
            return 3;
        }
        return 0;
    }

    private static async Task ExitWithParentAsync(int pid, CancellationTokenSource stop)
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                using var parent = Process.GetProcessById(pid);
                if (parent.HasExited) break;
            }
            catch (ArgumentException) { break; }
            await Task.Delay(2000);
        }
        Log("parent process ended; stopping");
        stop.Cancel();
    }
}
