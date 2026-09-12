using System.Diagnostics;
using GamingHouse.Agent.Detection;
using GamingHouse.Agent.Platform;

namespace GamingHouse.Agent.Tests;

public class PathRulesTests
{
    [Theory]
    [InlineData(@"C:\Games\X\x.exe", true)]
    [InlineData(@"d:/games/x.exe", true)]
    [InlineData(@"\\server\share\x.exe", false)]
    [InlineData(@"\\?\C:\x.exe", false)]
    [InlineData(@"\\.\C:\x.exe", false)]
    [InlineData(@"Games\x.exe", false)]
    [InlineData(@"C:x.exe", false)]
    [InlineData("", false)]
    public void OnlyDriveRootedLocalPathsAreAccepted(string path, bool expected) => Assert.Equal(expected, PathRules.IsLocalAbsolute(path));

    [Theory]
    [InlineData(@"C:\Games\..\Windows\x.exe", true)]
    [InlineData(@"C:\Games\.\x.exe", true)]
    [InlineData(@"C:\Games\x..y\a.exe", false)]
    public void DetectsTraversalSegments(string path, bool expected) => Assert.Equal(expected, PathRules.HasTraversal(path));

    [Theory]
    [InlineData(@"C:\Games\Demo\bin\a.exe", @"C:\Games\Demo", true)]
    [InlineData(@"c:\games\demo\A.EXE", @"C:\Games\Demo\", true)]
    [InlineData(@"C:\Games\Demo2\a.exe", @"C:\Games\Demo", false)]
    [InlineData(@"C:\Games", @"C:\Games\Demo", false)]
    public void UnderRootRespectsFolderBoundaries(string path, string root, bool expected) => Assert.Equal(expected, PathRules.IsUnder(path, root));

    [Fact]
    public void FinalPathResolvesExistingItemsOnly()
    {
        using var temp = new TempDir();
        var file = temp.File("game.exe");
        var final = PathRules.FinalPath(file);
        Assert.NotNull(final);
        Assert.EndsWith("game.exe", final, StringComparison.OrdinalIgnoreCase);
        Assert.False(final.StartsWith(@"\\?\", StringComparison.Ordinal));
        Assert.Null(PathRules.FinalPath(System.IO.Path.Combine(temp.Path, "missing.exe")));
    }
}

public class AclInspectorTests
{
    [Fact]
    public void UserFoldersArePlayerWritable()
    {
        using var temp = new TempDir();
        var file = temp.File(@"Game\game.exe");
        Assert.NotEmpty(AclInspector.UntrustedWriters(file, System.IO.Path.Combine(temp.Path, "Game")));
    }

    [Fact]
    public void WindowsSystemFilesAreNotPlayerWritable()
    {
        var system = PathRules.FinalPath(Environment.SystemDirectory)!;
        Assert.Empty(AclInspector.UntrustedWriters(System.IO.Path.Combine(system, "cmd.exe"), system));
    }
}

public class WindowsProcessSourceTests
{
    [Fact]
    public void DetectsARealProcessWithItsLocationSessionAndStartTime()
    {
        var source = new WindowsProcessSource();
        var system = PathRules.FinalPath(Environment.SystemDirectory)!;
        using var process = Process.Start(new ProcessStartInfo(System.IO.Path.Combine(system, "cmd.exe"), "/c ping -n 8 127.0.0.1 >nul")
        {
            CreateNoWindow = true, UseShellExecute = false,
        })!;
        ObservedProcess? found;
        try
        {
            found = source.Find(["cmd.exe"]).FirstOrDefault(p => p.Pid == process.Id);
            Assert.NotNull(found);
            Assert.Equal(Process.GetCurrentProcess().SessionId, found.SessionId);
            Assert.True(PathRules.IsUnder(found.ImagePath!, system));
            Assert.NotNull(found.StartedAt);
            Assert.True(source.IsAlive(found));
            Assert.Single(ProcessMatch.Verified(source, ["cmd.exe"], system, found.SessionId), p => p.Pid == process.Id);
        }
        finally
        {
            process.Kill(entireProcessTree: true);
            process.WaitForExit();
        }
        Assert.False(source.IsAlive(found));
    }
}
