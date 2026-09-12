using System.Text.Json.Nodes;
using GamingHouse.Agent.Session;
using GamingHouse.Agent.Ipc;

// Contract integration probe only: synthetic process observations, never launches a game or locks Windows.
var directory = args.Single();
var settings = StationSettings.Load(directory, true)!;
using var coordinator = new SessionCoordinator(settings, directory);
using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(40));
var worker = Task.Run(() => coordinator.RunAsync(stop.Token));
async Task Wait(Func<JsonObject, bool> predicate)
{
    while (!stop.IsCancellationRequested) { if (predicate(coordinator.DisplayState())) return; await Task.Delay(100, stop.Token); }
    throw new TimeoutException();
}
try {
    await Wait(s => s["connection"]!.GetValue<string>() == "connected");
    var permit = coordinator.RequestLaunch("synthetic-process-observation") ?? throw new Exception("Launch authorization was denied.");
    coordinator.Observe(new AttemptMessage(permit.AttemptId, "synthetic-process-observation", "running", null, null, null, DateTimeOffset.UtcNow.UtcDateTime.ToString("O")));
    await Wait(s => s["snapshot"]?["snapshot"]?["session"]?["state"]?.GetValue<string>() == "active");
    Console.WriteLine("ACTIVE_SYNTHETIC");
    await Wait(s => s["snapshot"]?["snapshot"]?["restriction"]?["state"]?.GetValue<string>() == "failed");
    var final = coordinator.DisplayState();
    if (final["snapshot"]?["snapshot"]?["session"]?["state"]?.GetValue<string>() != "ended") throw new Exception("Cashier end missing.");
    Console.WriteLine("ENDED_RESTRICTION_HONESTLY_UNCONFIGURED");
    return 0;
} finally { stop.Cancel(); try { await worker; } catch (OperationCanceledException) { } }
