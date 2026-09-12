using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;

namespace GamingHouse.Agent.Session;

public sealed class BackendException(string code, HttpStatusCode status) : Exception(code)
{ public string Code { get; } = code; public HttpStatusCode Status { get; } = status; }

public sealed class BackendTransport(StationSettings settings, CredentialVault vault) : IDisposable
{
    private readonly HttpClient client = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(5), MaxResponseContentBufferSize = 1024 * 1024 };
    public JsonObject Request(string path, JsonObject? body = null, string? key = null, bool renewal = false)
    {
        var credentials = vault.Read();
        if (body is not null) WireContract.Validate(WireContract.RequestSchema(path), body);
        using var request = new HttpRequestMessage(body is null ? HttpMethod.Get : HttpMethod.Post, settings.ApiBaseUrl.TrimEnd('/') + "/stations/" + settings.StationId + "/" + path);
        if (!renewal) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credentials["access_token"]!.GetValue<string>());
        if (body is null) request.Headers.Add("X-Request-ID", Guid.NewGuid().ToString());
        else { request.Headers.Add("Idempotency-Key", key ?? Guid.NewGuid().ToString()); request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"); }
        using var response = client.Send(request);
        var json = JsonNode.Parse(response.Content.ReadAsStringAsync().GetAwaiter().GetResult())?.AsObject() ?? throw new InvalidDataException("Backend returned invalid JSON.");
        if (!response.IsSuccessStatusCode) throw new BackendException(json["code"]?.GetValue<string>() ?? "INVALID_RESPONSE", response.StatusCode);
        WireContract.Validate(WireContract.ResponseSchema(path, body is not null), json);
        if (json["api_version"]?.GetValue<string>() != "1" || json["station_id"]?.GetValue<string>() != settings.StationId ||
            !DateTimeOffset.TryParse(json["server_time"]?.GetValue<string>(), out _)) throw new InvalidDataException("Backend response identity/time mismatch.");
        return json;
    }
    public void Dispose() => client.Dispose();
}
