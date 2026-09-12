using System.Text.Json.Nodes;
using GamingHouse.Agent.Session;

namespace GamingHouse.Agent.Tests;

public sealed class RecoveryTests
{
    [Fact]
    public void OutboxSurvivesRestartAndOnlyTerminalAcknowledgementsRemoveIt()
    {
        using var directory = new TempDir(); var id = Guid.NewGuid().ToString();
        using (var store = new StateStore(directory.Path)) { store.Enqueue(new JsonObject { ["event_id"] = id }); store.Put("snapshot", "persistent-session"); }
        using (var store = new StateStore(directory.Path)) {
            Assert.Equal("persistent-session", store.Get("snapshot")); Assert.Single(store.Pending());
            store.Acknowledge(id, "retry"); Assert.Single(store.Pending());
            store.Acknowledge(id, "duplicate"); Assert.Empty(store.Pending());
        }
    }
    [Fact]
    public void DevelopmentRestrictionNeverClaimsSuccessOrTouchesWindows()
    {
        Assert.Equal("restriction_not_configured", WindowsRestriction.Apply(1, "disconnect-session-v1", false));
        Assert.Equal("unsupported_restriction", WindowsRestriction.Apply(0, "disconnect-session-v1", true));
    }
    [Fact]
    public void ProductionEndpointRejectsHttpCredentialsAndRedirectLikeFragments()
    {
        Assert.Throws<InvalidDataException>(() => StationSettings.ValidateUrl("http://example.com/gaming/v1", false));
        Assert.Throws<InvalidDataException>(() => StationSettings.ValidateUrl("https://secret@example.com/gaming/v1", false));
        Assert.Throws<InvalidDataException>(() => StationSettings.ValidateUrl("http://example.com/gaming/v1", true));
        StationSettings.ValidateUrl("http://127.0.0.1:4317/gaming/v1", true);
        StationSettings.ValidateUrl("https://example.com/gaming/v1", false);
    }
}
