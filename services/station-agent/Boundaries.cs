namespace GamingHouse.Agent;

// Boundaries for later phases, not implementations. Launch resolution and process
// detection are implemented (Catalog/, Detection/); these remain planned.
public sealed record RestrictionOutcome(Guid CommandId, Guid SessionId, bool Verified, string? FailureCode);

/// <summary>Phase 4: SQLite outbox. Persist before sending; prune only after acknowledgement.</summary>
public interface IDurableEventStore
{
    Task AppendBeforeSendingAsync(Guid eventId, string validatedEventJson, CancellationToken cancellationToken);
    Task<IReadOnlyList<string>> ReadPendingAsync(int limit, CancellationToken cancellationToken);
    Task MarkAcknowledgedAsync(IReadOnlyList<Guid> eventIds, CancellationToken cancellationToken);
}

/// <summary>Phase 5: apply and verify the approved Windows restriction profile.</summary>
public interface IStationRestriction
{
    Task<RestrictionOutcome> ApplyAndVerifyAsync(Guid commandId, Guid sessionId, CancellationToken cancellationToken);
}
