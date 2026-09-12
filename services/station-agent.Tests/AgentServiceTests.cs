using System.Diagnostics;
using System.Text.Json;
using GamingHouse.Agent.Catalog;
using GamingHouse.Agent.Detection;
using GamingHouse.Agent.Ipc;
using GamingHouse.Agent.Platform;
using GamingHouse.Agent.Steam;

namespace GamingHouse.Agent.Tests;

public sealed class AgentServiceTests : IDisposable
{
    private readonly TempDir temp = new();
    private readonly FakeProcessSource processes = new();
    private readonly string system = PathRules.FinalPath(Environment.SystemDirectory)!;
    private readonly int session = Process.GetCurrentProcess().SessionId;
    private DateTimeOffset now = Times.T0;
    private readonly AgentService service;
    private readonly ClientContext client;

    public AgentServiceTests()
    {
        new CatalogStore(temp.Path).Save(new CatalogFile(0,
        [
            CatalogValidatorTests.Executable("system-tool", Path.Combine(system, "cmd.exe"), system, "cmd.exe"),
            CatalogValidatorTests.Executable("missing-game", @"C:\Games\Missing\game.exe", @"C:\Games\Missing"),
        ]));
        service = new AgentService(new AgentOptions(temp.Path, Development: true, "test"), processes, () => now,
            () => new SteamLibrary(null), () => null, TimeSpan.FromSeconds(5), authorize: _ =>
                new GamingHouse.Agent.Session.BackendPermit(Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), 1, now.AddMinutes(1)));
        client = new ClientContext(session);
    }

    public void Dispose() => temp.Dispose();

    private IReadOnlyList<AgentMessage> Send(object message) => service.Handle(JsonSerializer.Serialize(message), client);
    private void Hello() => Assert.IsType<WelcomeMessage>(Send(new { type = "hello", protocol = 1, client = "test", version = "1" })[0]);

    [Fact]
    public void UnenrolledAgentCannotIssueANativeLaunchPermit()
    {
        var unpaired = new AgentService(new AgentOptions(temp.Path, true, "test"), processes, () => now, () => new SteamLibrary(null));
        var context = new ClientContext(session);
        unpaired.Handle("{\"type\":\"hello\",\"protocol\":1,\"client\":\"test\",\"version\":\"1\"}", context);
        var replies = unpaired.Handle("{\"type\":\"launch.begin\",\"id\":\"denied\",\"game_id\":\"system-tool\"}", context);
        Assert.Equal("authorization_required", Assert.IsType<ErrorMessage>(Assert.Single(replies)).Code);
    }

    [Fact]
    public void RequiresHelloAndRejectsMalformedOrUnknownMessages()
    {
        Assert.Equal("protocol", Assert.IsType<ErrorMessage>(Send(new { type = "catalog.get", id = "1" })[0]).Code);
        Assert.Equal("protocol", Assert.IsType<ErrorMessage>(Send(new { type = "hello", protocol = 2, client = "x", version = "1" })[0]).Code);
        Hello();
        Assert.Equal("invalid_request", Assert.IsType<ErrorMessage>(service.Handle("not json", client)[0]).Code);
        Assert.Equal("invalid_request", Assert.IsType<ErrorMessage>(Send(new { type = "catalog.get", id = "1", path = "C:\\x" })[0]).Code);
        Assert.Equal("invalid_request", Assert.IsType<ErrorMessage>(Send(new { type = "run.command", command = "cmd.exe" })[0]).Code);
        Assert.Equal("invalid_request", Assert.IsType<ErrorMessage>(Send(new { type = "launch.begin", id = "1", game_id = "..\\x" })[0]).Code);
    }

    [Fact]
    public void CatalogListsOnlyPlayableGamesWithDisplayFieldsOnly()
    {
        Hello();
        var catalog = Assert.IsType<CatalogMessage>(Send(new { type = "catalog.get", id = "c1" })[0]);
        Assert.Equal(["system-tool"], catalog.Games.Select(g => g.GameId));
        var wire = JsonSerializer.Serialize<AgentMessage>(catalog, Json.Wire);
        Assert.DoesNotContain("cmd.exe", wire, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("System32", wire, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void RefusesGamesThatAreMissingOrUnknown()
    {
        Hello();
        Assert.Equal("not_installed", Assert.IsType<ErrorMessage>(Send(new { type = "launch.begin", id = "1", game_id = "missing-game" })[0]).Code);
        Assert.Equal("game_not_allowed", Assert.IsType<ErrorMessage>(Send(new { type = "launch.begin", id = "2", game_id = "not-in-catalog" })[0]).Code);
    }

    [Fact]
    public void ConfirmsALaunchFromProcessEvidenceAndReportsTheExit()
    {
        Hello();
        var plan = Assert.IsType<LaunchPlanMessage>(Send(new { type = "launch.begin", id = "1", game_id = "system-tool" }).Single());
        var spec = Assert.IsType<ExecutableLaunch>(plan.Spec);
        Assert.Equal(Path.Combine(system, "cmd.exe"), spec.ExecutablePath, ignoreCase: true);

        var starting = Assert.IsType<AttemptMessage>(Send(new { type = "launch.started", attempt_id = plan.AttemptId, pid = 500 }).Single());
        Assert.Equal("starting", starting.State);
        Assert.Empty(service.Tick());

        processes.Processes.Add(new ObservedProcess(500, "cmd.exe", Path.Combine(system, "cmd.exe"), now, session));
        now = now.AddSeconds(2);
        var events = service.Tick();
        var running = Assert.IsType<AttemptMessage>(events[0]);
        Assert.Equal(("running", 500), (running.State, running.Pid));
        Assert.EndsWith("Z", running.ProcessStartedAt);
        Assert.Equal(["system-tool"], Assert.IsType<RunningMessage>(events[1]).GameIds);

        processes.Processes.Clear();
        Assert.Empty(service.Tick());
        now = now.AddSeconds(6);
        var ended = service.Tick();
        Assert.Equal("system-tool", Assert.IsType<GameExitedMessage>(ended[0]).GameId);
        Assert.Empty(Assert.IsType<RunningMessage>(ended[1]).GameIds);
    }

    [Fact]
    public void ANewLaunchReplacesAPendingOneAndUnreportedStartsExpire()
    {
        Hello();
        var first = Assert.IsType<LaunchPlanMessage>(Send(new { type = "launch.begin", id = "1", game_id = "system-tool" }).Single());
        var second = Send(new { type = "launch.begin", id = "2", game_id = "system-tool" });
        Assert.Equal(("cancelled", first.AttemptId), (Assert.IsType<AttemptMessage>(second[0]).State, Assert.IsType<AttemptMessage>(second[0]).AttemptId));
        Assert.Equal("unknown_attempt", Assert.IsType<ErrorMessage>(Send(new { type = "launch.started", attempt_id = first.AttemptId, pid = 1 })[0]).Code);

        now = now.AddSeconds(21);
        var expired = Assert.IsType<AttemptMessage>(service.Tick().Single());
        Assert.Equal(("failed", "start_failed"), (expired.State, expired.Reason));
    }

    [Fact]
    public void AChildThatCrashesBeforeDetectionFailsTheAttempt()
    {
        Hello();
        var plan = Assert.IsType<LaunchPlanMessage>(Send(new { type = "launch.begin", id = "1", game_id = "system-tool" }).Single());
        Send(new { type = "launch.started", attempt_id = plan.AttemptId, pid = 600 });
        Assert.Empty(Send(new { type = "child.exited", attempt_id = plan.AttemptId, pid = 600, exit_code = 1 }));
        var failed = Assert.IsType<AttemptMessage>(service.Tick().Single());
        Assert.Equal("start_failed", failed.Reason);
    }
}
