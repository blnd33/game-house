using GamingHouse.Agent.Catalog;
using GamingHouse.Agent.Detection;
using static GamingHouse.Agent.Tests.Times;

namespace GamingHouse.Agent.Tests;

public class LaunchWatcherTests
{
    private const string Root = @"C:\Games\Demo";
    private const int Session = 1;

    private static LaunchWatcher Watcher(HandoffStrategy strategy = HandoffStrategy.DirectProcess, bool? signedIn = true) =>
        new(new DetectionProfile(["Game.exe"], Root, 30, strategy), Root, Session, T0, () => signedIn);

    [Fact]
    public void OnlyAVerifiedProcessInThePlayersSessionCounts()
    {
        var source = new FakeProcessSource();
        source.Processes.Add(new ObservedProcess(10, "Game.exe", @"C:\Other\Game.exe", T0, Session));
        source.Processes.Add(new ObservedProcess(11, "Game.exe", @"C:\Games\Demo\bin\Game.exe", T0, Session + 1));
        source.Processes.Add(new ObservedProcess(12, "Game.exe", @"C:\Games\Demo2\Game.exe", T0, Session));
        var watcher = Watcher();
        Assert.IsType<LaunchVerdict.Waiting>(watcher.Evaluate(source, At(5)));

        source.Processes.Add(new ObservedProcess(13, "Game.exe", @"C:\Games\Demo\bin\Game.exe", At(4), Session));
        var running = Assert.IsType<LaunchVerdict.Running>(watcher.Evaluate(source, At(6)));
        Assert.Equal(13, running.Process.Pid);
    }

    [Fact]
    public void SteamOrALauncherAloneNeverCounts()
    {
        var source = new FakeProcessSource();
        source.Processes.Add(new ObservedProcess(20, "steam.exe", @"C:\Program Files (x86)\Steam\steam.exe", T0, Session));
        var waiting = Assert.IsType<LaunchVerdict.Waiting>(Watcher(HandoffStrategy.SteamProcess).Evaluate(source, At(10)));
        Assert.Contains("Steam", waiting.Diagnostic);
        Assert.Equal("timeout", Assert.IsType<LaunchVerdict.Failed>(Watcher(HandoffStrategy.SteamProcess).Evaluate(source, At(31))).Reason);
        Assert.Equal("login_required", Assert.IsType<LaunchVerdict.Failed>(Watcher(HandoffStrategy.SteamProcess, signedIn: false).Evaluate(source, At(31))).Reason);
    }

    [Fact]
    public void AnUnverifiableProcessIsReportedForStaffReviewNotAsSuccess()
    {
        var source = new FakeProcessSource();
        source.Processes.Add(new ObservedProcess(30, "Game.exe", null, T0, Session));
        Assert.IsType<LaunchVerdict.Waiting>(Watcher().Evaluate(source, At(10)));
        Assert.Equal("process_unreliable", Assert.IsType<LaunchVerdict.Failed>(Watcher().Evaluate(source, At(30))).Reason);
    }

    [Fact]
    public void ACrashBeforeDetectionIsStartFailedButACleanBootstrapKeepsWaiting()
    {
        var source = new FakeProcessSource();
        var crashed = Watcher();
        crashed.ChildExitCode = 3;
        Assert.Equal("start_failed", Assert.IsType<LaunchVerdict.Failed>(crashed.Evaluate(source, At(2))).Reason);
        var bootstrap = Watcher();
        bootstrap.ChildExitCode = 0;
        Assert.IsType<LaunchVerdict.Waiting>(bootstrap.Evaluate(source, At(2)));
    }
}

public class RunTrackerTests
{
    private static GameRun Run(int pid) => new("run-1", "demo", "attempt-1",
        new DetectionProfile(["Game.exe"], @"C:\Games\Demo", 30, HandoffStrategy.DirectProcess), @"C:\Games\Demo",
        new ObservedProcess(pid, "Game.exe", @"C:\Games\Demo\Game.exe", T0, 1));

    [Fact]
    public void AGameEndsOnlyAfterTheGracePeriod()
    {
        var source = new FakeProcessSource();
        var tracker = new RunTracker(1, TimeSpan.FromSeconds(5));
        tracker.Add(Run(40));
        Assert.Empty(tracker.Check(source, At(0)));
        Assert.Empty(tracker.Check(source, At(4)));
        Assert.Single(tracker.Check(source, At(5)));
        Assert.Empty(tracker.RunningGameIds);
    }

    [Fact]
    public void ARestartedProcessContinuesTheSameRun()
    {
        var source = new FakeProcessSource();
        var tracker = new RunTracker(1, TimeSpan.FromSeconds(5));
        tracker.Add(Run(40));
        Assert.Empty(tracker.Check(source, At(0)));
        source.Processes.Add(new ObservedProcess(41, "Game.exe", @"C:\Games\Demo\Game.exe", At(1), 1));
        Assert.Empty(tracker.Check(source, At(2)));
        Assert.Empty(tracker.Check(source, At(20)));
        Assert.Equal(41, tracker.Runs.Single().Process.Pid);
    }
}
