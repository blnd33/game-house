using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using GamingHouse.Agent.Platform;

namespace GamingHouse.Agent.Session;

public sealed record StationSettings(string ApiBaseUrl, string StationId, string StationLabel, bool Development,
    string? PlayerSid, string? DesktopExecutable, bool EnableRestriction = false)
{
    public static StationSettings? Load(string directory, bool development)
    {
        var path = Path.Combine(directory, "station.json");
        if (!File.Exists(path)) return null;
        if (!development && AclInspector.UntrustedWriters(path, directory).Count > 0) throw new InvalidDataException("Station settings must be administrator-owned and protected.");
        var value = JsonSerializer.Deserialize<StationSettings>(File.ReadAllText(path), Json.File) ?? throw new InvalidDataException("Station settings missing.");
        ValidateUrl(value.ApiBaseUrl, development && value.Development);
        if (!Guid.TryParse(value.StationId, out _) || !development && value.Development) throw new InvalidDataException("Invalid station identity/mode.");
        return value;
    }
    public static void ValidateUrl(string text, bool development)
    {
        var url = new Uri(text, UriKind.Absolute);
        if (url.UserInfo.Length > 0 || url.Query.Length > 0 || url.Fragment.Length > 0 ||
            (url.Scheme != "https" && !(development && url.Scheme == "http" && url.IsLoopback))) throw new InvalidDataException("Production API requires HTTPS. Development HTTP must be loopback.");
    }
}
public sealed class CredentialVault(string directory, bool development, string fileName = "credentials.bin")
{
    private string PathName => Path.Combine(directory, fileName);
    public bool Exists => File.Exists(PathName);
    public void Remove() => File.Delete(PathName);
    private DataProtectionScope Scope => development ? DataProtectionScope.CurrentUser : DataProtectionScope.LocalMachine;
    public JsonObject Read() => JsonNode.Parse(Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(PathName), null, Scope)))!.AsObject();
    public void Write(JsonObject credentials)
    {
        Directory.CreateDirectory(directory);
        var encrypted = ProtectedData.Protect(Encoding.UTF8.GetBytes(credentials.ToJsonString()), null, Scope);
        File.WriteAllBytes(PathName + ".tmp", encrypted); File.Move(PathName + ".tmp", PathName, true);
    }
}
