using System.Diagnostics;
using System.Text.Json;
using GamingHouse.Agent.Admin;
using GamingHouse.Agent.Catalog;
using GamingHouse.Agent.Ipc;
using GamingHouse.Agent.Platform;
using GamingHouse.Agent.Steam;

namespace GamingHouse.Agent.Tests;

public class AdminAuthorityTests
{
    private static (AdminAuthority Authority, TempDir Temp) Create(Func<DateTimeOffset> clock)
    {
        var temp = new TempDir();
        return (new AdminAuthority(temp.Path, clock), temp);
    }

    [Fact]
    public void ThePasswordIsNeverStored()
    {
        var now = Times.T0;
        var (authority, temp) = Create(() => now);
        using (temp)
        {
            Assert.False(authority.PasswordSet);
            authority.SetPassword("padel-house-1");
            Assert.True(authority.PasswordSet);
            var written = File.ReadAllText(Path.Combine(temp.Path, "admin.json"));
            Assert.DoesNotContain("padel-house-1", written);
            Assert.Contains("pbkdf2-sha256", written);
        }
    }

    [Fact]
    public void OnlyTheRightPasswordUnlocks()
    {
        var now = Times.T0;
        var (authority, temp) = Create(() => now);
        using (temp)
        {
            authority.SetPassword("padel-house-1");
            Assert.Null(authority.Unlock("wrong-password"));
            var token = authority.Unlock("padel-house-1");
            Assert.NotNull(token);
            Assert.True(authority.Holds(token));
            Assert.False(authority.Holds("some-other-token"));
            authority.Lock(token);
            Assert.False(authority.Holds(token));
        }
    }

    [Fact]
    public void ShortPasswordsAreRefused()
    {
        var (authority, temp) = Create(() => Times.T0);
        using (temp) Assert.Throws<ArgumentException>(() => authority.SetPassword("12345"));
    }

    [Fact]
    public void RepeatedWrongTriesLockOutAndTheLockoutExpires()
    {
        var now = Times.T0;
        var (authority, temp) = Create(() => now);
        using (temp)
        {
            authority.SetPassword("padel-house-1");
            for (var attempt = 0; attempt < 5; attempt++) Assert.Null(authority.Unlock("wrong-password"));
            Assert.True(authority.LockedOutSeconds > 0);
            Assert.Null(authority.Unlock("padel-house-1")); // correct password is refused while locked out
            now = now.AddMinutes(2);
            Assert.Equal(0, authority.LockedOutSeconds);
            Assert.NotNull(authority.Unlock("padel-house-1"));
        }
    }

    [Fact]
    public void AnIdlePanelLocksItselfAndUseKeepsItOpen()
    {
        var now = Times.T0;
        var (authority, temp) = Create(() => now);
        using (temp)
        {
            authority.SetPassword("padel-house-1");
            var token = authority.Unlock("padel-house-1");
            now = now.AddSeconds(AdminAuthority.IdleSeconds - 10);
            Assert.True(authority.Holds(token)); // this use extends it
            now = now.AddSeconds(AdminAuthority.IdleSeconds - 10);
            Assert.True(authority.Holds(token));
            now = now.AddSeconds(AdminAuthority.IdleSeconds + 1);
            Assert.False(authority.Holds(token));
        }
    }

    [Fact]
    public void ChangingThePasswordClosesOpenPanels()
    {
        var (authority, temp) = Create(() => Times.T0);
        using (temp)
        {
            authority.SetPassword("padel-house-1");
            var token = authority.Unlock("padel-house-1");
            authority.SetPassword("padel-house-2");
            Assert.False(authority.Holds(token));
            Assert.Null(authority.Unlock("padel-house-1"));
            Assert.NotNull(authority.Unlock("padel-house-2"));
        }
    }
}

public sealed class AdminPanelTests : IDisposable
{
    private const string Password = "padel-house-1";
    private readonly TempDir temp = new();
    private readonly string system = PathRules.FinalPath(Environment.SystemDirectory)!;
    private readonly AgentService service;
    private readonly ClientContext client;
    private readonly string token;

    public AdminPanelTests()
    {
        var authority = new AdminAuthority(temp.Path, () => Times.T0);
        authority.SetPassword(Password);
        new CatalogStore(temp.Path).Save(new CatalogFile(0,
        [
            CatalogValidatorTests.Executable("system-tool", Path.Combine(system, "cmd.exe"), system, "cmd.exe"),
            CatalogValidatorTests.Executable("missing-game", @"C:\Games\Missing\game.exe", @"C:\Games\Missing"),
        ]));
        // Development mode only so the test's temporary folder passes the catalog
        // protection guard; the catalog itself never allows user-writable games.
        service = new AgentService(new AgentOptions(temp.Path, Development: true, "test"), new FakeProcessSource(),
            () => Times.T0, () => new SteamLibrary(null), () => null, admin: authority);
        client = new ClientContext(Process.GetCurrentProcess().SessionId);
        Send(new { type = "hello", protocol = 1, client = "test", version = "1" });
        token = Assert.IsType<AdminSessionMessage>(Send(new { type = "admin.unlock", id = "u", password = Password })[0]).Token;
    }

    public void Dispose() => temp.Dispose();

    private IReadOnlyList<AgentMessage> Send(object message) => service.Handle(JsonSerializer.Serialize(message), client);

    private AdminGamesReply Games()
    {
        var reply = Send(new { type = "admin.games", id = "g", token })[0];
        if (reply is ErrorMessage error) throw new Xunit.Sdk.XunitException($"admin.games failed: {error.Code} — {error.Message}");
        return Assert.IsType<AdminGamesReply>(reply);
    }

    [Fact]
    public void NothingOpensWithoutTheStaffPassword()
    {
        Assert.Equal("admin_password", Assert.IsType<ErrorMessage>(Send(new { type = "admin.unlock", id = "u", password = "wrong-password" })[0]).Code);
        foreach (var message in new object[]
        {
            new { type = "admin.games", id = "1", token = "not-a-token" },
            new { type = "admin.remove", id = "2", token = "not-a-token", game_id = "system-tool" },
            new { type = "admin.reorder", id = "3", token = "not-a-token", game_ids = new[] { "system-tool" } },
        })
        {
            Assert.Equal("admin_locked", Assert.IsType<ErrorMessage>(Send(message)[0]).Code);
        }
        Assert.Equal(2, Games().Games.Count); // the real token still works
    }

    [Fact]
    public void StaffSeeEveryGameIncludingBrokenOnesThePlayerNeverSees()
    {
        var games = Games().Games;
        Assert.Equal(["system-tool", "missing-game"], games.Select(g => g.GameId).Order().Reverse());
        Assert.Equal("ready", games.Single(g => g.GameId == "system-tool").Status);
        var missing = games.Single(g => g.GameId == "missing-game");
        Assert.Equal("not_installed", missing.Status);
        Assert.NotEmpty(missing.Missing);
    }

    [Fact]
    public void HidingAGameKeepsItForStaffAndRemovesItForPlayers()
    {
        Assert.IsType<AdminGamesReply>(Send(new { type = "admin.update", id = "1", token, game_id = "system-tool", enabled = false })[0]);
        Assert.Equal("disabled", Games().Games.Single(g => g.GameId == "system-tool").Status);
        Assert.Empty(Assert.IsType<CatalogMessage>(Send(new { type = "catalog.get", id = "c" })[0]).Games);
    }

    [Fact]
    public void RenamingAndReorderingChangeWhatThePlayerSees()
    {
        Assert.IsType<AdminGamesReply>(Send(new
        {
            type = "admin.update", id = "1", token, game_id = "system-tool", title = "Station Tool", category = "Utilities", controller = true,
        })[0]);
        var player = Assert.IsType<CatalogMessage>(Send(new { type = "catalog.get", id = "c" })[0]).Games.Single();
        Assert.Equal(("Station Tool", "Utilities", true), (player.Title, player.Category, player.Controller));

        Assert.IsType<AdminGamesReply>(Send(new { type = "admin.rename_category", id = "2", token, from = "Utilities", to = "Tools" })[0]);
        Assert.Equal("Tools", Games().Games.Single(g => g.GameId == "system-tool").Category);

        Assert.IsType<AdminGamesReply>(Send(new { type = "admin.reorder", id = "3", token, game_ids = new[] { "missing-game", "system-tool" } })[0]);
        Assert.Equal(["missing-game", "system-tool"], Games().Games.Select(g => g.GameId));
    }

    [Fact]
    public void AGameStaffCouldTamperWithIsRefusedWithReasons()
    {
        using var games = new TempDir();
        var unsafeExe = games.File(@"Game\game.exe");
        var rejected = Assert.IsType<AdminRejectedMessage>(Send(new
        {
            type = "admin.add", id = "1", token, kind = "executable", game_id = "demo", title = "Demo", category = "Action",
            executable_names = new[] { "game.exe" }, timeout_seconds = 60, controller = false, multiplayer = false,
            executable_path = unsafeExe,
        })[0]);
        Assert.Contains(rejected.Problems, problem => problem.Contains("players could replace"));
        Assert.DoesNotContain(Games().Games, game => game.GameId == "demo");
    }

    [Fact]
    public void TheAdminPanelCannotRunACommandOrInventAGame()
    {
        // No launch arguments, no scripts, no games that are not really installed.
        foreach (var (message, code) in new (object, string)[]
        {
            (new { type = "admin.add", id = "1", token, kind = "executable", game_id = "bad id", title = "x", category = "Action",
                executable_names = new[] { "game.exe" }, timeout_seconds = 60, controller = false, multiplayer = false,
                executable_path = Path.Combine(system, "cmd.exe") }, "invalid_request"),
            (new { type = "admin.add", id = "2", token, kind = "shell", game_id = "demo", title = "x", category = "Action",
                executable_names = new[] { "game.exe" }, timeout_seconds = 60, controller = false, multiplayer = false,
                executable_path = Path.Combine(system, "cmd.exe") }, "invalid_request"),
            (new { type = "admin.add", id = "3", token, kind = "steam", game_id = "demo", title = "x", category = "Action",
                executable_names = new[] { "game.exe" }, timeout_seconds = 60, controller = false, multiplayer = false,
                app_id = "440" }, "invalid_request"),
            (new { type = "admin.remove", id = "4", token, game_id = "not-in-the-list" }, "rejected"),
        })
        {
            Assert.Equal(code, Assert.IsType<ErrorMessage>(Send(message)[0]).Code);
        }
        Assert.Equal(2, Games().Games.Count);
    }

    [Fact]
    public void StaffCanAddAnApprovedGameAndRemoveItAgain()
    {
        var added = Assert.IsType<AdminGamesReply>(Send(new
        {
            type = "admin.add", id = "1", token, kind = "executable", game_id = "station-tool-2", title = "Second tool",
            category = "Utilities", executable_names = new[] { "cmd.exe" }, timeout_seconds = 60, controller = false,
            multiplayer = true, executable_path = Path.Combine(system, "cmd.exe"),
        })[0]);
        Assert.Contains(added.Games, game => game.GameId == "station-tool-2" && game.Status == "ready");
        Assert.Equal(2, Assert.IsType<CatalogMessage>(Send(new { type = "catalog.get", id = "c" })[0]).Games.Count);

        Assert.IsType<AdminGamesReply>(Send(new { type = "admin.remove", id = "2", token, game_id = "station-tool-2" })[0]);
        Assert.DoesNotContain(Games().Games, game => game.GameId == "station-tool-2");
    }

    [Fact]
    public void StaffCanChangeThePasswordAndTheOldOneStopsWorking()
    {
        Assert.IsType<AdminStateMessage>(Send(new { type = "admin.set_password", id = "1", token, next_password = "padel-house-2" })[0]);
        Assert.Equal("admin_locked", Assert.IsType<ErrorMessage>(Send(new { type = "admin.games", id = "2", token })[0]).Code);
        Assert.Equal("admin_password", Assert.IsType<ErrorMessage>(Send(new { type = "admin.unlock", id = "3", password = Password })[0]).Code);
        Assert.IsType<AdminSessionMessage>(Send(new { type = "admin.unlock", id = "4", password = "padel-house-2" })[0]);
    }
}
