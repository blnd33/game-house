using Microsoft.Win32;

namespace GamingHouse.Agent.Steam;

public sealed record SteamApp(string AppId, string Name, string InstallDir, string LibraryPath, int StateFlags)
{
    public string InstallPath => Path.Combine(LibraryPath, "steamapps", "common", InstallDir);
    public bool FullyInstalled => (StateFlags & 4) != 0;
    public bool UpdateRequired => (StateFlags & 2) != 0;
}

/// <summary>
/// Read-only view of Steam's own library files. Steam keeps handling accounts,
/// licenses and updates; this only answers "is this AppID installed, and where".
/// </summary>
public sealed class SteamLibrary(string? root)
{
    public string? Root { get; } = root is not null && Directory.Exists(root) ? Path.GetFullPath(root) : null;

    public static SteamLibrary Detect() => new(FindRoot());

    private static string? FindRoot()
    {
        (RegistryKey Hive, string Key, string Value)[] candidates =
        [
            (Registry.LocalMachine, @"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
            (Registry.LocalMachine, @"SOFTWARE\Valve\Steam", "InstallPath"),
            (Registry.CurrentUser, @"Software\Valve\Steam", "SteamPath"),
        ];
        foreach (var (hive, key, value) in candidates)
        {
            using var node = hive.OpenSubKey(key);
            if (node?.GetValue(value) is string path && Directory.Exists(path)) return Path.GetFullPath(path.Replace('/', '\\'));
        }
        return null;
    }

    /// <summary>Signed-in state of the current user's Steam client; null when unknown.</summary>
    public static bool? IsSignedIn()
    {
        using var node = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam\ActiveProcess");
        return node?.GetValue("ActiveUser") is int user ? user != 0 : null;
    }

    public IReadOnlyList<string> LibraryPaths()
    {
        if (Root is null) return [];
        var paths = new List<string> { Root };
        var file = Path.Combine(Root, "steamapps", "libraryfolders.vdf");
        if (File.Exists(file))
        {
            var folders = Vdf.Parse(File.ReadAllText(file)).Child("libraryfolders");
            foreach (var value in folders?.Entries.Values.ToList() ?? [])
            {
                // Current format: "0" { "path" "D:\\SteamLibrary" ... }; old format: "1" "D:\\SteamLibrary".
                var path = value is VdfNode node ? node.Value("path") : value as string;
                if (path is not null && Path.IsPathFullyQualified(path)) paths.Add(Path.GetFullPath(path));
            }
        }
        return paths.Where(Directory.Exists).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    public IReadOnlyList<SteamApp> InstalledApps()
    {
        var apps = new List<SteamApp>();
        foreach (var library in LibraryPaths())
        {
            var steamapps = Path.Combine(library, "steamapps");
            if (!Directory.Exists(steamapps)) continue;
            foreach (var manifest in Directory.EnumerateFiles(steamapps, "appmanifest_*.acf"))
            {
                try
                {
                    var state = Vdf.Parse(File.ReadAllText(manifest)).Child("AppState");
                    if (state?.Value("appid") is not { } appId || state.Value("installdir") is not { } installDir) continue;
                    if (installDir.Contains("..") || installDir.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) continue;
                    _ = int.TryParse(state.Value("StateFlags"), out var flags);
                    apps.Add(new SteamApp(appId, state.Value("name") ?? appId, installDir, library, flags));
                }
                catch (FormatException) { } // a damaged manifest is skipped, not fatal
                catch (IOException) { }
            }
        }
        return apps;
    }

    public SteamApp? Find(string appId) => InstalledApps().FirstOrDefault(app => app.AppId == appId);

    private static readonly string[] NotTheGame = ["unins", "crash", "redist", "vcredist", "directx", "dxsetup", "setup", "launcherhelper", "easyanticheat_setup", "be_service"];

    /// <summary>Likely game executables in an install folder, largest first, to help the operator fill executable_names.</summary>
    public static IReadOnlyList<string> CandidateExecutables(string installPath, int limit = 5)
    {
        if (!Directory.Exists(installPath)) return [];
        var options = new EnumerationOptions { RecurseSubdirectories = true, MaxRecursionDepth = 4, IgnoreInaccessible = true };
        return new DirectoryInfo(installPath).EnumerateFiles("*.exe", options)
            .Where(f => !NotTheGame.Any(word => f.Name.Contains(word, StringComparison.OrdinalIgnoreCase)))
            .OrderByDescending(f => f.Length)
            .Take(limit)
            .Select(f => Path.GetRelativePath(installPath, f.FullName))
            .ToList();
    }
}
