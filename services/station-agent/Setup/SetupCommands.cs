using System.Text.Json;
using GamingHouse.Agent.Catalog;
using GamingHouse.Agent.Steam;

namespace GamingHouse.Agent.Setup;

/// <summary>
/// Protected station setup: maps installed games into the catalog. Every entry
/// is validated on this PC before it is saved; nothing here launches a game.
/// On venue PCs the catalog folder is writable by administrators only.
/// </summary>
public static class SetupCommands
{
    public const string Usage = """
        Gaming House station setup
          setup steam-scan                 List Steam games installed on this PC (read-only)
          setup add-steam  --id <game-id> --app-id <digits> --exe <Game.exe>[,<Other.exe>] --category <name>
                           [--title <text>] [--timeout <seconds>] [--controller] [--multiplayer] [--artwork <asset-id>] [--disabled]
          setup add-exe    --id <game-id> --title <text> --category <name> --path <C:\...\game.exe> --exe <Game.exe>[,...]
                           [--root <install folder>] [--workdir <folder>] [--arg <value>]... [--timeout <seconds>]
                           [--controller] [--multiplayer] [--artwork <asset-id>] [--disabled]
          setup validate | list            Check every catalog entry on this PC
          setup remove  --id <game-id>
          setup enable  --id <game-id>
          setup disable --id <game-id>
        Common: --config-dir <folder> (default %ProgramData%\GamingHouse), --json, --dev (development PCs only)
        """;

    public static int Run(CommandLine cli)
    {
        var store = new CatalogStore(cli.ConfigDirectory);
        try
        {
            return cli.Positionals.ElementAtOrDefault(1) switch
            {
                "steam-scan" => SteamScan(cli),
                "add-steam" => Save(cli, store, SteamEntry(cli)),
                "add-exe" => Save(cli, store, ExecutableEntry(cli)),
                "validate" or "list" => Report(cli, store),
                "remove" => Change(store, cli.Require("--id"), _ => null),
                "enable" => Change(store, cli.Require("--id"), e => e with { Enabled = true }),
                "disable" => Change(store, cli.Require("--id"), e => e with { Enabled = false }),
                _ => Help(),
            };
        }
        catch (Exception error) when (error is ArgumentException or CatalogException or FormatException)
        {
            Console.Error.WriteLine($"error: {error.Message}");
            return 1;
        }
    }

    private static int Help()
    {
        Console.WriteLine(Usage);
        return 2;
    }

    private static int SteamScan(CommandLine cli)
    {
        var steam = SteamLibrary.Detect();
        var apps = steam.InstalledApps().OrderBy(a => a.Name, StringComparer.OrdinalIgnoreCase)
            .Select(a => new
            {
                app_id = a.AppId, name = a.Name, fully_installed = a.FullyInstalled, update_required = a.UpdateRequired,
                install_path = a.InstallPath, candidate_executables = SteamLibrary.CandidateExecutables(a.InstallPath),
            }).ToList();
        if (cli.Flag("--json"))
        {
            Console.WriteLine(JsonSerializer.Serialize(new { steam_root = steam.Root, libraries = steam.LibraryPaths(), apps }, Json.File));
            return 0;
        }
        if (steam.Root is null) { Console.WriteLine("Steam is not installed on this PC."); return 0; }
        Console.WriteLine($"Steam: {steam.Root}");
        foreach (var app in apps)
        {
            var state = !app.fully_installed ? "not fully installed" : app.update_required ? "update required" : "installed";
            Console.WriteLine($"\n{app.name}  (AppID {app.app_id}, {state})\n  {app.install_path}");
            foreach (var exe in app.candidate_executables) Console.WriteLine($"  candidate: {exe}");
        }
        if (apps.Count == 0) Console.WriteLine("No installed Steam games found.");
        return 0;
    }

    private static CatalogEntry SteamEntry(CommandLine cli)
    {
        var appId = cli.Require("--app-id");
        if (!Patterns.SteamAppId().IsMatch(appId)) throw new ArgumentException("--app-id must be digits only");
        var app = SteamLibrary.Detect().Find(appId) ?? throw new ArgumentException($"Steam app {appId} is not installed on this PC");
        return new CatalogEntry(cli.Require("--id"), cli.Value("--title") ?? app.Name, cli.Value("--artwork"), cli.Require("--category"),
            cli.Flag("--controller"), cli.Flag("--multiplayer"), !cli.Flag("--disabled"), new SteamLaunch(appId),
            new DetectionProfile(Executables(cli), app.InstallPath, Timeout(cli, 120), HandoffStrategy.SteamProcess));
    }

    private static CatalogEntry ExecutableEntry(CommandLine cli)
    {
        var path = cli.Require("--path");
        var folder = Path.GetDirectoryName(path) ?? throw new ArgumentException("--path must be a full path to an .exe");
        return new CatalogEntry(cli.Require("--id"), cli.Require("--title"), cli.Value("--artwork"), cli.Require("--category"),
            cli.Flag("--controller"), cli.Flag("--multiplayer"), !cli.Flag("--disabled"),
            new ExecutableLaunch(path, cli.Values("--arg"), cli.Value("--workdir") ?? folder),
            new DetectionProfile(Executables(cli), cli.Value("--root") ?? folder, Timeout(cli, 60), HandoffStrategy.DirectProcess));
    }

    private static IReadOnlyList<string> Executables(CommandLine cli) =>
        cli.Values("--exe").SelectMany(v => v.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)).ToList() is { Count: > 0 } names
            ? names : throw new ArgumentException("--exe is required (the game's process file name, e.g. Game.exe)");

    private static int Timeout(CommandLine cli, int fallback) =>
        cli.Value("--timeout") is { } text ? int.Parse(text, System.Globalization.CultureInfo.InvariantCulture) : fallback;

    private static int Save(CommandLine cli, CatalogStore store, CatalogEntry entry)
    {
        var development = cli.Flag("--dev");
        var result = CatalogValidator.Validate(entry, new ValidationContext(SteamLibrary.Detect(), development));
        Print(result);
        if (result.Problems.Count > 0 || result.Missing.Count > 0)
        {
            Console.Error.WriteLine("Not saved. Fix the problems above and try again.");
            return 1;
        }
        var catalog = store.Load();
        var games = catalog.Games.Where(g => g.GameId != entry.GameId).Append(entry).ToList();
        var allowWritable = development && result.Warnings.Any(w => w.Contains("players could replace", StringComparison.Ordinal));
        var saved = store.Save(catalog with
        {
            Games = games,
            Development = allowWritable || catalog.Development is not null ? new DevelopmentOptions(allowWritable || catalog.Development!.AllowUserWritablePaths) : null,
        });
        Console.WriteLine($"Saved {entry.GameId} to {store.CatalogPath} (catalog version {saved.CatalogVersion}).");
        return 0;
    }

    private static int Change(CatalogStore store, string gameId, Func<CatalogEntry, CatalogEntry?> change)
    {
        var catalog = store.Load();
        var target = catalog.Games.FirstOrDefault(g => g.GameId == gameId) ?? throw new ArgumentException($"{gameId} is not in the catalog");
        var updated = change(target);
        var games = catalog.Games.Select(g => g.GameId == gameId ? updated : g).OfType<CatalogEntry>().ToList();
        var saved = store.Save(catalog with { Games = games });
        Console.WriteLine($"{(updated is null ? "Removed" : "Updated")} {gameId} (catalog version {saved.CatalogVersion}).");
        return 0;
    }

    private static int Report(CommandLine cli, CatalogStore store)
    {
        var catalog = store.Load();
        var context = new ValidationContext(SteamLibrary.Detect(), cli.Flag("--dev") && catalog.Development?.AllowUserWritablePaths == true);
        var results = catalog.Games.Select(g => CatalogValidator.Validate(g, context)).ToList();
        if (cli.Flag("--json"))
        {
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                catalog_version = catalog.CatalogVersion,
                games = results.Select(r => new
                {
                    game_id = r.Entry.GameId, status = r.Status, launch_type = r.Entry.Launch is SteamLaunch ? "steam" : "executable",
                    problems = r.Problems, missing = r.Missing, warnings = r.Warnings,
                }),
            }, Json.File));
            return 0;
        }
        Console.WriteLine($"Catalog {store.CatalogPath} (version {catalog.CatalogVersion}), {results.Count} games");
        foreach (var result in results) Print(result);
        return 0;
    }

    private static void Print(ValidatedGame result)
    {
        Console.WriteLine($"\n{result.Entry.GameId}: {result.Status}  ({result.Entry.Title})");
        foreach (var line in result.Problems) Console.WriteLine($"  problem: {line}");
        foreach (var line in result.Missing) Console.WriteLine($"  missing: {line}");
        foreach (var line in result.Warnings) Console.WriteLine($"  warning: {line}");
    }
}
