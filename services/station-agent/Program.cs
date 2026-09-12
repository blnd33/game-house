using System.Text.Json;
using GamingHouse.Agent;
using GamingHouse.Agent.Setup;
using GamingHouse.Agent.Steam;

var version = typeof(AgentService).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
CommandLine cli;
try { cli = CommandLine.Parse(args); }
catch (ArgumentException error)
{
    Console.Error.WriteLine($"error: {error.Message}");
    return 2;
}

if (cli.Flag("--self-check"))
{
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        component = "GamingHouse.Agent", version, phase = 4,
        operatingSystem = Environment.OSVersion.ToString(),
        serviceInstalled = false, catalogValidation = true, processDetection = true,
        persistenceImplemented = true, restrictionImplemented = true, restrictionVerifiedOnVenue = false,
        steamInstalled = SteamLibrary.Detect().Root is not null,
    }));
    return 0;
}

return cli.Positionals.FirstOrDefault() switch
{
    "run" => await AgentHost.RunAsync(cli, version),
    "service" => await ServiceHost.RunAsync(cli, version),
    "relay" => await GamingHouse.Agent.Ipc.AuthenticatedRelay.RunAsync(cli.Value("--pipe") ?? GamingHouse.Agent.Ipc.PipeServer.DefaultName),
    "enroll" => await Enrollment.RunAsync(cli),
    "maintenance-status" => MaintenanceStatus(cli.ConfigDirectory),
    "maintenance-enter" => MaintenanceStatus(cli.ConfigDirectory, true),
    "maintenance-exit" => LeaveMaintenance(cli.ConfigDirectory),
    "setup" => SetupCommands.Run(cli),
    "admin" => GamingHouse.Agent.Admin.AdminCli.Run(cli),
    _ => Usage(),
};

static int MaintenanceStatus(string directory, bool enter = false)
{
    using var store = new GamingHouse.Agent.Session.StateStore(directory);
    if (enter) store.Put("maintenance", "1");
    var snapshot = System.Text.Json.Nodes.JsonNode.Parse(store.Get("snapshot") ?? "null");
    var state = snapshot?["snapshot"]?["session"]?["state"]?.GetValue<string>();
    var restriction = snapshot?["snapshot"]?["restriction"]?["state"]?.GetValue<string>();
    var idle = state is not ("pending" or "active") && restriction is not ("pending" or "failed");
    if (enter && !idle) store.Remove("maintenance");
    Console.WriteLine(JsonSerializer.Serialize(new { idle, session_state = state, restriction_state = restriction }));
    return idle ? 0 : 5;
}
static int LeaveMaintenance(string directory)
{
    using var store = new GamingHouse.Agent.Session.StateStore(directory); store.Remove("maintenance"); return 0;
}

static int Usage()
{
    Console.Error.WriteLine("GamingHouse.Agent run [--config-dir <folder>] [--pipe <name>] [--dev] | setup ... | admin ... | --self-check");
    Console.Error.WriteLine(SetupCommands.Usage);
    Console.Error.WriteLine(GamingHouse.Agent.Admin.AdminCli.Usage);
    return 2;
}
