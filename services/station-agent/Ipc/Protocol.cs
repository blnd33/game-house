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
public abstract record ClientMessage;

public sealed record HelloMessage(int Protocol, string Client, string Version) : ClientMessage;
public sealed record CatalogGetMessage(string Id) : ClientMessage;
public sealed record LaunchBeginMessage(string Id, string GameId) : ClientMessage;
public sealed record LaunchStartedMessage(string AttemptId, int? Pid) : ClientMessage;
public sealed record LaunchStartFailedMessage(string AttemptId, string Message) : ClientMessage;
public sealed record ChildExitedMessage(string AttemptId, int Pid, int ExitCode) : ClientMessage;
public sealed record StateGetMessage(string Id) : ClientMessage;

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(WelcomeMessage), "welcome")]
[JsonDerivedType(typeof(CatalogMessage), "catalog")]
[JsonDerivedType(typeof(LaunchPlanMessage), "launch.plan")]
[JsonDerivedType(typeof(ErrorMessage), "error")]
[JsonDerivedType(typeof(AttemptMessage), "attempt")]
[JsonDerivedType(typeof(RunningMessage), "running")]
[JsonDerivedType(typeof(GameExitedMessage), "game.exited")]
[JsonDerivedType(typeof(StateMessage), "state")]
public abstract record AgentMessage;
public sealed record StateMessage(string? Id, JsonObject State) : AgentMessage;

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
