using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace GamingHouse.Agent.Catalog;

// On-disk station catalog. Mirrors the contract's GameProfile, except that
// `installed` is never stored: it is always re-verified on this PC.
public sealed record CatalogFile(int CatalogVersion, IReadOnlyList<CatalogEntry> Games, DevelopmentOptions? Development = null);

/// <summary>Honored only when the agent runs with --dev. Never set on venue PCs.</summary>
public sealed record DevelopmentOptions(bool AllowUserWritablePaths);

public sealed record CatalogEntry(
    string GameId, string Title, string? ArtworkAsset, string Category, bool Controller, bool Multiplayer, bool Enabled,
    LaunchSpec Launch, DetectionProfile Detection);

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(SteamLaunch), "steam")]
[JsonDerivedType(typeof(ExecutableLaunch), "executable")]
public abstract record LaunchSpec;

/// <summary>Launched through Steam's supported URI, built locally from the digits-only AppID.</summary>
public sealed record SteamLaunch(string AppId) : LaunchSpec;

/// <summary>An admin-approved .exe started directly, with arguments passed individually (never through a shell).</summary>
public sealed record ExecutableLaunch(string ExecutablePath, IReadOnlyList<string> Arguments, string WorkingDirectory) : LaunchSpec;

public enum HandoffStrategy { DirectProcess, SteamProcess }

public sealed record DetectionProfile(
    IReadOnlyList<string> ExecutableNames, string ExpectedInstallRoot, int LaunchTimeoutSeconds, HandoffStrategy HandoffStrategy);

public enum GameStatus { Ready, Disabled, NotInstalled, Invalid }

public sealed record ValidatedGame(
    CatalogEntry Entry, string? InstallRoot, bool FilesPresent,
    IReadOnlyList<string> Problems, IReadOnlyList<string> Missing, IReadOnlyList<string> Warnings)
{
    public GameStatus Status => Problems.Count > 0 ? GameStatus.Invalid
        : !FilesPresent || Missing.Count > 0 ? GameStatus.NotInstalled
        : !Entry.Enabled ? GameStatus.Disabled : GameStatus.Ready;

    public bool Playable => Status == GameStatus.Ready && InstallRoot is not null;
}

public static partial class Patterns
{
    [GeneratedRegex("^[a-z0-9][a-z0-9._-]{0,63}$")]
    public static partial Regex GameId();

    [GeneratedRegex("^[1-9][0-9]{0,9}$")]
    public static partial Regex SteamAppId();

    [GeneratedRegex("^[^\\\\/:*?\"<>|]+\\.exe$", RegexOptions.IgnoreCase)]
    public static partial Regex ExecutableName();
}
