using System.Text.Json;

namespace GamingHouse.Agent.Catalog;

public sealed class CatalogException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>
/// The protected station catalog. On venue PCs the folder is writable by
/// administrators only (Phase 5 installer); the agent never trusts a copy the
/// player could edit.
/// </summary>
public sealed class CatalogStore(string configDirectory)
{
    private const long MaxBytes = 2 * 1024 * 1024;

    public string ConfigDirectory { get; } = Path.GetFullPath(configDirectory);
    public string CatalogPath => Path.Combine(ConfigDirectory, "catalog.json");

    public CatalogFile Load()
    {
        var file = new FileInfo(CatalogPath);
        if (!file.Exists) return new CatalogFile(0, []);
        if (file.Length > MaxBytes) throw new CatalogException("catalog.json is larger than 2 MB");
        try
        {
            return JsonSerializer.Deserialize<CatalogFile>(System.IO.File.ReadAllText(file.FullName), Json.File)
                ?? throw new CatalogException("catalog.json is empty");
        }
        catch (JsonException error)
        {
            throw new CatalogException($"catalog.json is not valid: {error.Message}", error);
        }
    }

    /// <summary>Writes atomically and bumps the catalog version.</summary>
    public CatalogFile Save(CatalogFile catalog)
    {
        var duplicate = catalog.Games.GroupBy(g => g.GameId).FirstOrDefault(g => g.Count() > 1);
        if (duplicate is not null) throw new CatalogException($"duplicate game_id {duplicate.Key}");
        Directory.CreateDirectory(ConfigDirectory);
        var next = catalog with { CatalogVersion = catalog.CatalogVersion + 1 };
        var temp = CatalogPath + ".tmp";
        System.IO.File.WriteAllText(temp, JsonSerializer.Serialize(next, Json.File));
        System.IO.File.Move(temp, CatalogPath, overwrite: true);
        return next;
    }
}
