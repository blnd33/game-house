using GamingHouse.Agent.Platform;
using GamingHouse.Agent.Steam;

namespace GamingHouse.Agent.Catalog;

public sealed record ValidationContext(SteamLibrary Steam, bool AllowUserWritable);

/// <summary>
/// Decides whether a catalog entry is safe and actually installed on this PC.
/// Invalid entries are never launched; a central catalog cannot bypass this.
/// </summary>
public static class CatalogValidator
{
    public const int MinTimeoutSeconds = 10;
    public const int MaxTimeoutSeconds = 900;

    public static ValidatedGame Validate(CatalogEntry entry, ValidationContext context)
    {
        var problems = new List<string>();
        var missing = new List<string>();
        var warnings = new List<string>();

        if (!Patterns.GameId().IsMatch(entry.GameId)) problems.Add("game_id must be 1-64 lowercase letters, digits, '.', '_' or '-'");
        if (string.IsNullOrWhiteSpace(entry.Title) || entry.Title.Length > 80) problems.Add("title must be 1-80 characters");
        if (string.IsNullOrWhiteSpace(entry.Category) || entry.Category.Length > 40) problems.Add("category must be 1-40 characters");
        if (entry.ArtworkAsset is { } asset && !Patterns.GameId().IsMatch(asset)) problems.Add("artwork_asset must be a local asset ID");

        var detection = entry.Detection;
        if (detection.ExecutableNames.Count is < 1 or > 20 || detection.ExecutableNames.Any(n => !Patterns.ExecutableName().IsMatch(n)))
            problems.Add("executable_names must list 1-20 process file names ending in .exe");
        if (detection.LaunchTimeoutSeconds is < MinTimeoutSeconds or > MaxTimeoutSeconds)
            problems.Add($"launch_timeout_seconds must be {MinTimeoutSeconds}-{MaxTimeoutSeconds}");

        string? root = null;
        if (!PathRules.IsLocalAbsolute(detection.ExpectedInstallRoot) || PathRules.HasTraversal(detection.ExpectedInstallRoot))
            problems.Add("expected_install_root must be a local absolute folder without . or .. segments");
        else if (PathRules.FinalPath(detection.ExpectedInstallRoot) is { } finalRoot && Directory.Exists(finalRoot))
            root = finalRoot;
        else
            missing.Add($"install folder not found: {detection.ExpectedInstallRoot}");

        switch (entry.Launch)
        {
            case SteamLaunch steam:
                ValidateSteam(steam, detection, root, context, problems, missing, warnings);
                break;
            case ExecutableLaunch executable:
                ValidateExecutable(executable, detection, root, context, problems, missing, warnings);
                break;
            default:
                problems.Add("unsupported launch type");
                break;
        }

        return new ValidatedGame(entry, root, root is not null && missing.Count == 0, problems, missing, warnings);
    }

    private static void ValidateSteam(SteamLaunch steam, DetectionProfile detection, string? root, ValidationContext context,
        List<string> problems, List<string> missing, List<string> warnings)
    {
        if (detection.HandoffStrategy != HandoffStrategy.SteamProcess) problems.Add("Steam games must use handoff_strategy steam_process");
        if (!Patterns.SteamAppId().IsMatch(steam.AppId)) { problems.Add("app_id must be a Steam AppID (digits only)"); return; }
        if (context.Steam.Root is null) { missing.Add("Steam is not installed on this PC"); return; }
        var app = context.Steam.Find(steam.AppId);
        if (app is null) { missing.Add($"Steam app {steam.AppId} is not installed in any Steam library"); return; }
        if (!app.FullyInstalled) missing.Add("Steam reports the game is not fully installed");
        if (app.UpdateRequired) warnings.Add("Steam reports an update is required; the first launch may be slow");
        var appRoot = PathRules.FinalPath(app.InstallPath);
        if (root is not null && appRoot is not null && !PathRules.SamePath(root, appRoot))
            problems.Add($"expected_install_root does not match Steam's install folder {app.InstallPath}");
        if (root is not null && !AnyUnder(root, detection.ExecutableNames))
            warnings.Add("none of the expected process files were found in the install folder; check executable_names");
    }

    private static void ValidateExecutable(ExecutableLaunch executable, DetectionProfile detection, string? root, ValidationContext context,
        List<string> problems, List<string> missing, List<string> warnings)
    {
        if (detection.HandoffStrategy != HandoffStrategy.DirectProcess) warnings.Add("executable games normally use handoff_strategy direct_process");
        if (executable.Arguments.Count > 32 || executable.Arguments.Any(a => a.Length > 256 || a.Any(char.IsControl)))
            problems.Add("arguments must be at most 32 items of at most 256 printable characters");

        var path = executable.ExecutablePath;
        if (!PathRules.IsLocalAbsolute(path) || PathRules.HasTraversal(path)) problems.Add("executable_path must be a local absolute path without . or .. segments");
        else if (!path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) problems.Add("executable_path must point to an .exe file");
        else if (PathRules.FinalPath(path) is not { } final || !File.Exists(final)) missing.Add($"executable not found: {path}");
        else if (!final.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) problems.Add("executable_path resolves to a file that is not an .exe");
        else if (root is not null)
        {
            if (!PathRules.IsUnder(final, root)) problems.Add("executable_path resolves outside expected_install_root");
            else
            {
                var writers = AclInspector.UntrustedWriters(final, root);
                if (writers.Count > 0)
                {
                    var message = "players could replace the executable: " + string.Join("; ", writers.Take(3));
                    if (context.AllowUserWritable) warnings.Add(message + " (allowed for development only)");
                    else problems.Add(message);
                }
            }
        }

        var workingDirectory = executable.WorkingDirectory;
        if (!PathRules.IsLocalAbsolute(workingDirectory) || PathRules.HasTraversal(workingDirectory))
            problems.Add("working_directory must be a local absolute folder without . or .. segments");
        else if (PathRules.FinalPath(workingDirectory) is not { } finalDirectory || !Directory.Exists(finalDirectory))
            missing.Add($"working directory not found: {workingDirectory}");
        else if (root is not null && !PathRules.IsUnder(finalDirectory, root))
            problems.Add("working_directory resolves outside expected_install_root");
    }

    private static bool AnyUnder(string root, IReadOnlyList<string> names)
    {
        var options = new EnumerationOptions { RecurseSubdirectories = true, MaxRecursionDepth = 5, IgnoreInaccessible = true };
        return names.Any(name => Directory.EnumerateFiles(root, name, options).Any());
    }
}
