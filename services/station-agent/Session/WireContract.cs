using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace GamingHouse.Agent.Session;

/// <summary>Validates the subset of JSON Schema used by our generated OpenAPI contract.</summary>
public static class WireContract
{
    private static readonly JsonDocument Document = JsonDocument.Parse(typeof(WireContract).Assembly.GetManifestResourceStream("GamingHouse.OpenApi")!);
    private static JsonElement Schemas => Document.RootElement.GetProperty("components").GetProperty("schemas");
    public static void Validate(string schema, JsonNode value)
    {
        using var data = JsonDocument.Parse(value.ToJsonString());
        if (!Matches(Schemas.GetProperty(schema), data.RootElement)) throw new InvalidDataException($"Message does not match {schema}.");
    }
    public static string ResponseSchema(string path, bool write)
    {
        var suffix = path.StartsWith("sessions/", StringComparison.Ordinal) ? "sessions/{session_id}" : path;
        var operation = Document.RootElement.GetProperty("paths").GetProperty("/stations/{station_id}/" + suffix).GetProperty(write ? "post" : "get");
        return operation.GetProperty("responses").GetProperty("200").GetProperty("content").GetProperty("application/json").GetProperty("schema").GetProperty("$ref").GetString()!.Split('/')[^1];
    }
    public static string RequestSchema(string path)
    {
        var operation = Document.RootElement.GetProperty("paths").GetProperty("/stations/{station_id}/" + path).GetProperty("post");
        return operation.GetProperty("requestBody").GetProperty("content").GetProperty("application/json").GetProperty("schema").GetProperty("$ref").GetString()!.Split('/')[^1];
    }
    private static bool Matches(JsonElement schema, JsonElement data)
    {
        if (schema.TryGetProperty("$ref", out var reference)) return Matches(Schemas.GetProperty(reference.GetString()!.Split('/')[^1]), data);
        if (schema.TryGetProperty("anyOf", out var any) && !any.EnumerateArray().Any(s => Matches(s, data))) return false;
        if (schema.TryGetProperty("oneOf", out var one) && one.EnumerateArray().Count(s => Matches(s, data)) != 1) return false;
        if (schema.TryGetProperty("const", out var constant) && !JsonElement.DeepEquals(constant, data)) return false;
        if (schema.TryGetProperty("enum", out var values) && !values.EnumerateArray().Any(v => JsonElement.DeepEquals(v, data))) return false;
        if (!schema.TryGetProperty("type", out var type)) return true;
        switch (type.GetString()) {
            case "null": return data.ValueKind == JsonValueKind.Null;
            case "boolean": return data.ValueKind is JsonValueKind.True or JsonValueKind.False;
            case "integer":
                return data.ValueKind == JsonValueKind.Number && data.TryGetInt64(out var number) &&
                    (!schema.TryGetProperty("minimum", out var minimum) || number >= minimum.GetInt64()) &&
                    (!schema.TryGetProperty("maximum", out var maximum) || number <= maximum.GetInt64());
            case "string":
                if (data.ValueKind != JsonValueKind.String) return false;
                var text = data.GetString()!;
                if (schema.TryGetProperty("minLength", out var minLength) && text.Length < minLength.GetInt32() || schema.TryGetProperty("maxLength", out var maxLength) && text.Length > maxLength.GetInt32()) return false;
                if (schema.TryGetProperty("pattern", out var pattern) && !Regex.IsMatch(text, pattern.GetString()!, RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100))) return false;
                if (schema.TryGetProperty("format", out var format)) {
                    if (format.GetString() == "uuid" && !Guid.TryParseExact(text, "D", out _)) return false;
                    if (format.GetString() == "date-time" && !DateTimeOffset.TryParse(text, out _)) return false;
                }
                return true;
            case "array":
                return data.ValueKind == JsonValueKind.Array &&
                    (!schema.TryGetProperty("minItems", out var minItems) || data.GetArrayLength() >= minItems.GetInt32()) &&
                    (!schema.TryGetProperty("maxItems", out var maxItems) || data.GetArrayLength() <= maxItems.GetInt32()) &&
                    data.EnumerateArray().All(item => Matches(schema.GetProperty("items"), item));
            case "object":
                if (data.ValueKind != JsonValueKind.Object) return false;
                var properties = schema.GetProperty("properties");
                if (schema.TryGetProperty("required", out var required) && required.EnumerateArray().Any(p => !data.TryGetProperty(p.GetString()!, out _))) return false;
                return data.EnumerateObject().All(p => properties.TryGetProperty(p.Name, out var child) ? Matches(child, p.Value) : !schema.TryGetProperty("additionalProperties", out var additional) || additional.ValueKind != JsonValueKind.False);
            default: throw new InvalidDataException("Unsupported contract schema keyword type.");
        }
    }
}
