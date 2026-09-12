using System.Text.Json;
using System.Text.Json.Serialization;

namespace GamingHouse.Agent;

public static class Json
{
    /// <summary>Strict snake_case JSON: unknown fields and missing required fields are rejected.</summary>
    public static readonly JsonSerializerOptions Wire = Create(indented: false);
    public static readonly JsonSerializerOptions File = Create(indented: true);

    private static JsonSerializerOptions Create(bool indented) => new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true,
        AllowOutOfOrderMetadataProperties = true,
        WriteIndented = indented,
        MaxDepth = 16,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower, allowIntegerValues: false) },
    };

    public static string Utc(DateTimeOffset value) => value.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
}
