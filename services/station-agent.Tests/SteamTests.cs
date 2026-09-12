using GamingHouse.Agent.Steam;

namespace GamingHouse.Agent.Tests;

public class VdfTests
{
    [Fact]
    public void ParsesNestedBlocksEscapesCommentsAndConditionals()
    {
        var doc = Vdf.Parse("""
            // Steam writes files like this
            "libraryfolders"
            {
                "0"
                {
                    "path"  "C:\\Program Files (x86)\\Steam"
                    "label" "say \"hi\""
                    "apps" { "252950" "123" }
                }
                "flag" "1" [$WIN32]
            }
            """);
        var folder = doc.Child("libraryfolders")!.Child("0")!;
        Assert.Equal(@"C:\Program Files (x86)\Steam", folder.Value("path"));
        Assert.Equal("say \"hi\"", folder.Value("label"));
        Assert.Equal("123", folder.Child("apps")!.Value("252950"));
        Assert.Equal("1", doc.Child("LIBRARYFOLDERS")!.Value("flag"));
    }

    [Theory]
    [InlineData("\"a\" { \"b\" \"c\"")]
    [InlineData("\"a\" \"unterminated")]
    [InlineData("}")]
    [InlineData("\"key-without-value\"")]
    public void RejectsDamagedFiles(string text) => Assert.Throws<FormatException>(() => Vdf.Parse(text));

    [Fact]
    public void RejectsHostileNesting() =>
        Assert.Throws<FormatException>(() => Vdf.Parse(string.Concat(Enumerable.Repeat("\"k\" {", 40))));
}

public class SteamLibraryTests
{
    public static SteamLibrary FakeSteam(TempDir temp, out string secondLibrary)
    {
        var root = System.IO.Path.Combine(temp.Path, "Steam");
        secondLibrary = System.IO.Path.Combine(temp.Path, "SteamLibrary");
        temp.Text(@"Steam\steamapps\libraryfolders.vdf", $$"""
            "libraryfolders"
            {
                "0" { "path" "{{root.Replace("\\", "\\\\")}}" }
                "1" { "path" "{{secondLibrary.Replace("\\", "\\\\")}}" }
            }
            """);
        temp.Text(@"Steam\steamapps\appmanifest_252950.acf",
            "\"AppState\" { \"appid\" \"252950\" \"name\" \"Rocket League\" \"StateFlags\" \"4\" \"installdir\" \"rocketleague\" }");
        temp.File(@"Steam\steamapps\common\rocketleague\Binaries\Win64\RocketLeague.exe", 4000);
        temp.File(@"Steam\steamapps\common\rocketleague\Binaries\Win64\UnityCrashHandler64.exe", 9000);
        temp.Text(@"SteamLibrary\steamapps\appmanifest_730.acf",
            "\"AppState\" { \"appid\" \"730\" \"name\" \"Counter-Strike 2\" \"StateFlags\" \"6\" \"installdir\" \"Counter-Strike Global Offensive\" }");
        temp.Text(@"SteamLibrary\steamapps\appmanifest_999.acf",
            "\"AppState\" { \"appid\" \"999\" \"name\" \"Escape\" \"StateFlags\" \"4\" \"installdir\" \"..\\\\..\\\\Windows\" }");
        Directory.CreateDirectory(System.IO.Path.Combine(secondLibrary, "steamapps", "common", "Counter-Strike Global Offensive"));
        return new SteamLibrary(root);
    }

    [Fact]
    public void FindsAppsAcrossLibrariesAndIgnoresHostileManifests()
    {
        using var temp = new TempDir();
        var steam = FakeSteam(temp, out var second);
        Assert.Equal(2, steam.LibraryPaths().Count);
        Assert.Contains(second, steam.LibraryPaths(), StringComparer.OrdinalIgnoreCase);
        var apps = steam.InstalledApps();
        Assert.Equal(["252950", "730"], apps.Select(a => a.AppId).Order());
        var cs = steam.Find("730")!;
        Assert.True(cs.FullyInstalled);
        Assert.True(cs.UpdateRequired);
        Assert.False(steam.Find("252950")!.UpdateRequired);
    }

    [Fact]
    public void SuggestsGameExecutablesButNotCrashHandlers()
    {
        using var temp = new TempDir();
        var app = FakeSteam(temp, out _).Find("252950")!;
        var candidates = SteamLibrary.CandidateExecutables(app.InstallPath);
        Assert.Equal([@"Binaries\Win64\RocketLeague.exe"], candidates);
    }

    [Fact]
    public void MissingSteamMeansNoLibraries()
    {
        var steam = new SteamLibrary(null);
        Assert.Null(steam.Root);
        Assert.Empty(steam.InstalledApps());
    }
}
