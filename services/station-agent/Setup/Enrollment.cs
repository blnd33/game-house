using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using GamingHouse.Agent.Session;

namespace GamingHouse.Agent.Setup;

public static class Enrollment
{
    public static async Task<int> RunAsync(CommandLine cli)
    {
        var development = cli.Flag("--dev");
        var url = cli.Require("--api-url"); StationSettings.ValidateUrl(url, development);
        var label = cli.Require("--station-label");
        if (!System.Text.RegularExpressions.Regex.IsMatch(label, "^PC-[0-9]{2,4}$")) throw new ArgumentException("Invalid station label.");
        Directory.CreateDirectory(cli.ConfigDirectory);
        if (File.Exists(Path.Combine(cli.ConfigDirectory, "station.json"))) throw new InvalidOperationException("Station already enrolled. Use the operator re-pairing procedure.");
        var vault = new CredentialVault(cli.ConfigDirectory, development);
        var retry = new CredentialVault(cli.ConfigDirectory, development, "enrollment.bin");
        JsonObject body;
        if (retry.Exists) {
            var saved = retry.Read();
            if (saved["url"]!.GetValue<string>() != url || saved["body"]!["station_label"]!.GetValue<string>() != label) throw new InvalidOperationException("Unresolved enrollment belongs to another endpoint/label.");
            body = saved["body"]!.AsObject();
        } else {
            Console.Error.WriteLine("Enter the one-time pairing code (stored only in the encrypted enrollment retry record):");
            var code = Console.ReadLine(); if (string.IsNullOrWhiteSpace(code)) throw new ArgumentException("Pairing code required.");
            body = new JsonObject { ["api_version"] = "1", ["request_id"] = Guid.NewGuid().ToString(), ["sent_at"] = Json.Utc(DateTimeOffset.UtcNow), ["pairing_code"] = code,
                ["installation_id"] = Guid.NewGuid().ToString(), ["agent_version"] = "0.4.0", ["station_label"] = label };
            retry.Write(new JsonObject { ["url"] = url, ["body"] = body.DeepClone() });
        }
        var requestId = body["request_id"]!.GetValue<string>();
        using var client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(10) };
        using var request = new HttpRequestMessage(HttpMethod.Post, url.TrimEnd('/') + "/devices/enroll"); request.Headers.Add("Idempotency-Key", requestId);
        request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, new MediaTypeHeaderValue("application/json"));
        using var response = await client.SendAsync(request);
        if (!response.IsSuccessStatusCode) { Console.Error.WriteLine($"Enrollment failed ({(int)response.StatusCode}); no credentials logged."); return 1; }
        var result = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
        WireContract.Validate("EnrollResponse", result);
        var stationId = result["station_id"]!.GetValue<string>(); if (!Guid.TryParse(stationId, out _)) throw new InvalidDataException("Invalid station identity.");
        vault.Write(result["credentials"]!.AsObject());
        var settings = new StationSettings(url, stationId, label, development, cli.Value("--player-sid"), cli.Value("--desktop-exe"));
        File.WriteAllText(Path.Combine(cli.ConfigDirectory, "station.json"), JsonSerializer.Serialize(settings, Json.File));
        retry.Remove();
        Console.WriteLine($"Enrolled {label}: {stationId}. Restriction remains disabled until operator configuration."); return 0;
    }
}
