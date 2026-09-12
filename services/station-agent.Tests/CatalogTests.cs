using GamingHouse.Agent.Catalog;
using GamingHouse.Agent.Platform;
using GamingHouse.Agent.Steam;

namespace GamingHouse.Agent.Tests;

public class CatalogValidatorTests
{
    private static readonly ValidationContext NoSteam = new(new SteamLibrary(null), AllowUserWritable: false);

    public static CatalogEntry Executable(string id, string path, string root, string exe = "game.exe", bool enabled = true) =>
        new(id, "Demo", null, "Action", false, true, enabled, new ExecutableLaunch(path, ["-fullscreen"], root),
            new DetectionProfile([exe], root, 60, HandoffStrategy.DirectProcess));

    [Fact]
    public void ProtectedSystemExecutableIsReady()
    {
        var system = PathRules.FinalPath(Environment.SystemDirectory)!;
        var result = CatalogValidator.Validate(Executable("system-tool", Path.Combine(system, "cmd.exe"), system, "cmd.exe"), NoSteam);
        Assert.Equal(GameStatus.Ready, result.Status);
        Assert.True(result.Playable);
    }

    [Fact]
    public void PlayerWritableExecutableIsRejectedOutsideDevelopment()
    {
        using var temp = new TempDir();
        var exe = temp.File(@"Game\game.exe");
        var root = Path.GetDirectoryName(exe)!;
        var production = CatalogValidator.Validate(Executable("demo", exe, root), NoSteam);
        Assert.Equal(GameStatus.Invalid, production.Status);
        Assert.Contains(production.Problems, p => p.Contains("players could replace"));

        var development = CatalogValidator.Validate(Executable("demo", exe, root), NoSteam with { AllowUserWritable = true });
        Assert.Equal(GameStatus.Ready, development.Status);
        Assert.Contains(development.Warnings, w => w.Contains("development only"));
    }

    [Fact]
    public void UnsafeOrMisplacedTargetsAreInvalid()
    {
        using var temp = new TempDir();
        var root = Path.Combine(temp.Path, "Game");
        var outside = temp.File(@"Elsewhere\game.exe");
        temp.File(@"Game\run.bat");
        var dev = NoSteam with { AllowUserWritable = true };
        Assert.Equal(GameStatus.Invalid, CatalogValidator.Validate(Executable("a", Path.Combine(root, "run.bat"), root), dev).Status);
        Assert.Equal(GameStatus.Invalid, CatalogValidator.Validate(Executable("b", outside, root), dev).Status);
        Assert.Equal(GameStatus.Invalid, CatalogValidator.Validate(Executable("c", @"\\server\share\game.exe", root), dev).Status);
        Assert.Equal(GameStatus.Invalid, CatalogValidator.Validate(Executable("d", Path.Combine(root, "..", "Elsewhere", "game.exe"), root), dev).Status);
        Assert.Equal(GameStatus.Invalid, CatalogValidator.Validate(Executable("Bad ID!", outside, Path.GetDirectoryName(outside)!), dev).Status);
        Assert.Equal(GameStatus.Invalid, CatalogValidator.Validate(Executable("e", outside, Path.GetDirectoryName(outside)!, exe: "game.bat"), dev).Status);
    }

    [Fact]
    public void MissingFilesMeanNotInstalledAndDisabledStaysOff()
    {
        using var temp = new TempDir();
        var root = Path.Combine(temp.Path, "Game");
        var dev = NoSteam with { AllowUserWritable = true };
        Assert.Equal(GameStatus.NotInstalled, CatalogValidator.Validate(Executable("a", Path.Combine(root, "game.exe"), root), dev).Status);
        var exe = temp.File(@"Game\game.exe");
        var disabled = CatalogValidator.Validate(Executable("b", exe, root, enabled: false), dev);
        Assert.Equal(GameStatus.Disabled, disabled.Status);
        Assert.False(disabled.Playable);
    }

    [Fact]
    public void SteamGamesAreCheckedAgainstSteamsOwnLibrary()
    {
        using var temp = new TempDir();
        var steam = SteamLibraryTests.FakeSteam(temp, out _);
        var context = new ValidationContext(steam, AllowUserWritable: false);
        var app = steam.Find("252950")!;
        CatalogEntry Entry(string appId, string root, HandoffStrategy strategy = HandoffStrategy.SteamProcess) =>
            new("rocket-league", "Rocket League", null, "Sports", true, true, true, new SteamLaunch(appId),
                new DetectionProfile(["RocketLeague.exe"], root, 120, strategy));

        Assert.Equal(GameStatus.Ready, CatalogValidator.Validate(Entry("252950", app.InstallPath), context).Status);
        Assert.Equal(GameStatus.NotInstalled, CatalogValidator.Validate(Entry("440", app.InstallPath), context).Status);
        Assert.Equal(GameStatus.Invalid, CatalogValidator.Validate(Entry("252950", steam.Find("730")!.InstallPath), context).Status);
        Assert.Equal(GameStatus.Invalid, CatalogValidator.Validate(Entry("252950", app.InstallPath, HandoffStrategy.DirectProcess), context).Status);
        Assert.Equal(GameStatus.Invalid, CatalogValidator.Validate(Entry("steam://run/1", app.InstallPath), context).Status);
        Assert.Equal(GameStatus.NotInstalled, CatalogValidator.Validate(Entry("252950", app.InstallPath), new ValidationContext(new SteamLibrary(null), false)).Status);
    }
}

public class CatalogStoreTests
{
    [Fact]
    public void SavesAtomicallyAndBumpsTheVersion()
    {
        using var temp = new TempDir();
        var store = new CatalogStore(temp.Path);
        Assert.Empty(store.Load().Games);
        var entry = CatalogValidatorTests.Executable("demo", @"C:\Games\Demo\game.exe", @"C:\Games\Demo");
        var saved = store.Save(new CatalogFile(0, [entry]));
        Assert.Equal(1, saved.CatalogVersion);
        var loaded = store.Load();
        Assert.Equal(1, loaded.CatalogVersion);
        var launch = Assert.IsType<ExecutableLaunch>(loaded.Games.Single().Launch);
        Assert.Equal(@"C:\Games\Demo\game.exe", launch.ExecutablePath);
        Assert.Equal(["-fullscreen"], launch.Arguments);
        Assert.False(File.Exists(store.CatalogPath + ".tmp"));
    }

    [Fact]
    public void RejectsUnknownFieldsAndDuplicates()
    {
        using var temp = new TempDir();
        var store = new CatalogStore(temp.Path);
        temp.Text("catalog.json", """{ "catalog_version": 1, "games": [], "run_command": "cmd.exe" }""");
        Assert.Throws<CatalogException>(() => store.Load());
        var entry = CatalogValidatorTests.Executable("demo", @"C:\Games\Demo\game.exe", @"C:\Games\Demo");
        Assert.Throws<CatalogException>(() => store.Save(new CatalogFile(0, [entry, entry])));
    }
}

public class CommandLineTests
{
    [Fact]
    public void OptionValuesAreTakenLiterally()
    {
        var cli = CommandLine.Parse(["setup", "add-exe", "--arg", "--exit-after", "--arg", "60", "--dev"]);
        Assert.Equal(["setup", "add-exe"], cli.Positionals);
        Assert.Equal(["--exit-after", "60"], cli.Values("--arg"));
        Assert.True(cli.Flag("--dev"));
    }

    [Fact]
    public void RejectsUnknownOptionsAndMissingValues()
    {
        Assert.Throws<ArgumentException>(() => CommandLine.Parse(["setup", "--shell", "x"]));
        Assert.Throws<ArgumentException>(() => CommandLine.Parse(["setup", "--id"]));
    }
}
