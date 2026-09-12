using System.Text.Json.Serialization;
using GamingHouse.Agent.Catalog;
using System.Text.Json.Nodes;

namespace GamingHouse.Agent.Ipc;

// Local desktop ↔ agent protocol v1: one JSON object per line over the named pipe.
// Strictly parsed; unknown types or fields are rejected. The desktop sends only
// game IDs and launch outcomes, never paths or commands.

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(HelloMessage), "hello")]
[JsonDerivedType(typeof(CatalogGetMessage), "catalog.get")]
[JsonDerivedType(typeof(LaunchBeginMessage), "launch.begin")]
[JsonDerivedType(typeof(LaunchStartedMessage), "launch.started")]
[JsonDerivedType(typeof(LaunchStartFailedMessage), "launch.start_failed")]
[JsonDerivedType(typeof(ChildExitedMessage), "child.exited")]
[JsonDerivedType(typeof(StateGetMessage), "state.get")]
[JsonDerivedType(typeof(AdminStatusMessage), "admin.status")]
[JsonDerivedType(typeof(AdminUnlockMessage), "admin.unlock")]
[JsonDerivedType(typeof(AdminLockMessage), "admin.lock")]
[JsonDerivedType(typeof(AdminSetPasswordMessage), "admin.set_password")]
[JsonDerivedType(typeof(AdminGamesMessage), "admin.games")]
[JsonDerivedType(typeof(AdminSteamMessage), "admin.steam")]
[JsonDerivedType(typeof(AdminAddMessage), "admin.add")]
[JsonDerivedType(typeof(AdminUpdateMessage), "admin.update")]
[JsonDerivedType(typeof(AdminRemoveMessage), "admin.remove")]
[JsonDerivedType(typeof(AdminReorderMessage), "admin.reorder")]
[JsonDerivedType(typeof(AdminRenameCategoryMessage), "admin.rename_category")]
public abstract record ClientMessage;

public sealed record HelloMessage(int Protocol, string Client, string Version) : ClientMessage;
public sealed record CatalogGetMessage(string Id) : ClientMessage;
public sealed record LaunchBeginMessage(string Id, string GameId) : ClientMessage;
public sealed record LaunchStartedMessage(string AttemptId, int? Pid) : ClientMessage;
public sealed record LaunchStartFailedMessage(string AttemptId, string Message) : ClientMessage;
public sealed record ChildExitedMessage(string AttemptId, int Pid, int ExitCode) : ClientMessage;
public sealed record StateGetMessage(string Id) : ClientMessage;

// Admin panel (staff password). These change this station's game list only: never
// a price, a session, a launch argument or anything that runs a command.
public sealed record AdminStatusMessage(string Id) : ClientMessage;
public sealed record AdminUnlockMessage(string Id, string Password) : ClientMessage;
public sealed record AdminLockMessage(string Id, string Token) : ClientMessage;
public sealed record AdminSetPasswordMessage(string Id, string Token, string NextPassword) : ClientMessage;
public sealed record AdminGamesMessage(string Id, string Token) : ClientMessage;
public sealed record AdminSteamMessage(string Id, string Token) : ClientMessage;
public sealed record AdminAddMessage(string Id, string Token, string Kind, string GameId, string Title, string Category,
    IReadOnlyList<string> ExecutableNames, int TimeoutSeconds, bool Controller, bool Multiplayer,
    string? AppId = null, string? ExecutablePath = null) : ClientMessage;
public sealed record AdminUpdateMessage(string Id, string Token, string GameId, string? Title = null, string? Category = null,
    bool? Controller = null, bool? Multiplayer = null, bool? Enabled = null) : ClientMessage;
public sealed record AdminRemoveMessage(string Id, string Token, string GameId) : ClientMessage;
public sealed record AdminReorderMessage(string Id, string Token, IReadOnlyList<string> GameIds) : ClientMessage;
public sealed record AdminRenameCategoryMessage(string Id, string Token, string From, string To) : ClientMessage;

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(WelcomeMessage), "welcome")]
[JsonDerivedType(typeof(CatalogMessage), "catalog")]
[JsonDerivedType(typeof(LaunchPlanMessage), "launch.plan")]
[JsonDerivedType(typeof(ErrorMessage), "error")]
[JsonDerivedType(typeof(AttemptMessage), "attempt")]
[JsonDerivedType(typeof(RunningMessage), "running")]
[JsonDerivedType(typeof(GameExitedMessage), "game.exited")]
[JsonDerivedType(typeof(StateMessage), "state")]
[JsonDerivedType(typeof(AdminStateMessage), "admin.state")]
[JsonDerivedType(typeof(AdminSessionMessage), "admin.session")]
[JsonDerivedType(typeof(AdminGamesReply), "admin.games")]
[JsonDerivedType(typeof(AdminSteamReply), "admin.steam")]
[JsonDerivedType(typeof(AdminRejectedMessage), "admin.rejected")]
public abstract record AgentMessage;
public sealed record StateMessage(string? Id, JsonObject State) : AgentMessage;

public sealed record AdminStateMessage(string Id, bool PasswordSet, int LockedOutSeconds) : AgentMessage;
public sealed record AdminSessionMessage(string Id, string Token, int ExpiresInSeconds) : AgentMessage;

/// <summary>What staff see per game, including hidden and broken ones the player never sees.</summary>
public sealed record AdminGameView(string GameId, string Title, string? ArtworkAsset, string Category, bool Controller,
    bool Multiplayer, bool Enabled, int SortOrder, string LaunchType, string Status,
    IReadOnlyList<string> Problems, IReadOnlyList<string> Missing, IReadOnlyList<string> Warnings);

public sealed record AdminGamesReply(string Id, int CatalogVersion, IReadOnlyList<AdminGameView> Games) : AgentMessage;
public sealed record AdminSteamApp(string AppId, string Name, bool FullyInstalled, bool UpdateRequired, IReadOnlyList<string> CandidateExecutables);
public sealed record AdminSteamReply(string Id, string? SteamRoot, IReadOnlyList<AdminSteamApp> Apps) : AgentMessage;

/// <summary>A change refused because the game would not be safe or is not installed.</summary>
public sealed record AdminRejectedMessage(string Id, IReadOnlyList<string> Problems, IReadOnlyList<string> Missing,
    IReadOnlyList<string> Warnings) : AgentMessage;

public sealed record WelcomeMessage(int Protocol, string AgentVersion, bool Development) : AgentMessage;

/// <summary>Display fields only (the contract's LibraryGame); launch details stay in the agent.</summary>
public sealed record LibraryGameView(string GameId, string Title, string? ArtworkAsset, string Category, bool Controller, bool Multiplayer);

public sealed record CatalogMessage(string Id, int CatalogVersion, IReadOnlyList<LibraryGameView> Games) : AgentMessage;

/// <summary>A validated launch for the interactive desktop to perform in the player's session.</summary>
public sealed record LaunchPlanMessage(string Id, string AttemptId, string GameId, LaunchSpec Spec, int TimeoutSeconds, long PermitValidForMilliseconds) : AgentMessage;

public sealed record ErrorMessage(string? Id, string Code, string Message) : AgentMessage;

/// <summary>State: starting, running, failed or cancelled. Reason uses the contract's launch_failed reasons.</summary>
public sealed record AttemptMessage(string AttemptId, string GameId, string State, string? Reason, string? Diagnostic,
    int? Pid, string? ProcessStartedAt) : AgentMessage;

public sealed record RunningMessage(IReadOnlyList<string> GameIds) : AgentMessage;

/// <summary>Telemetry only: a game closing never ends a paid session.</summary>
public sealed record GameExitedMessage(string GameRunId, string GameId, int? ExitCode) : AgentMessage;
