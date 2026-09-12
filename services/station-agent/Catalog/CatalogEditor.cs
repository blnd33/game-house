namespace GamingHouse.Agent.Catalog;

/// <summary>Fields the admin panel may change. Anything null is left as it is.</summary>
public sealed record GamePatch(string? Title = null, string? Category = null, bool? Controller = null,
    bool? Multiplayer = null, bool? Enabled = null, string? ArtworkAsset = null);

public sealed record EditResult(bool Saved, ValidatedGame? Validation, string? Error)
{
    public static EditResult Ok(ValidatedGame validation) => new(true, validation, null);
    public static EditResult Rejected(ValidatedGame validation) => new(false, validation, null);
    public static EditResult Failed(string error) => new(false, null, error);
}

/// <summary>
/// Every change to the station catalog goes through here, so the command line and
/// the admin panel enforce the same rules: validate on this PC first, save only
/// what passes, and keep the display order stable.
/// </summary>
public static class CatalogEditor
{
    public static EditResult SaveEntry(CatalogStore store, CatalogEntry entry, ValidationContext context)
    {
        var validation = CatalogValidator.Validate(entry, context);
        if (validation.Problems.Count > 0 || validation.Missing.Count > 0) return EditResult.Rejected(validation);
        var catalog = store.Load();
        var order = entry.SortOrder > 0 ? entry.SortOrder
            : catalog.Games.Count == 0 ? 1 : catalog.Games.Max(game => game.SortOrder) + 1;
        var games = catalog.Games.Where(game => game.GameId != entry.GameId).Append(entry with { SortOrder = order }).ToList();
        // The development allowance is only ever widened by a --dev save of a user-writable path.
        var allowWritable = (context.AllowUserWritable && validation.Warnings.Any(w => w.Contains("players could replace", StringComparison.Ordinal)))
            || catalog.Development?.AllowUserWritablePaths == true;
        store.Save(catalog with { Games = games, Development = allowWritable ? new DevelopmentOptions(true) : catalog.Development });
        return EditResult.Ok(validation);
    }

    public static EditResult Update(CatalogStore store, string gameId, GamePatch patch, ValidationContext context)
    {
        var catalog = store.Load();
        var target = catalog.Games.FirstOrDefault(game => game.GameId == gameId);
        if (target is null) return EditResult.Failed($"{gameId} is not in this PC's game list.");
        var updated = target with
        {
            Title = patch.Title ?? target.Title,
            Category = patch.Category ?? target.Category,
            Controller = patch.Controller ?? target.Controller,
            Multiplayer = patch.Multiplayer ?? target.Multiplayer,
            Enabled = patch.Enabled ?? target.Enabled,
            ArtworkAsset = patch.ArtworkAsset ?? target.ArtworkAsset,
        };
        var validation = CatalogValidator.Validate(updated, context);
        if (validation.Problems.Count > 0) return EditResult.Rejected(validation);
        store.Save(catalog with { Games = catalog.Games.Select(game => game.GameId == gameId ? updated : game).ToList() });
        return EditResult.Ok(validation);
    }

    public static EditResult Remove(CatalogStore store, string gameId)
    {
        var catalog = store.Load();
        if (catalog.Games.All(game => game.GameId != gameId)) return EditResult.Failed($"{gameId} is not in this PC's game list.");
        store.Save(catalog with { Games = catalog.Games.Where(game => game.GameId != gameId).ToList() });
        return new EditResult(true, null, null);
    }

    /// <summary>Puts the listed games in that order; anything not listed keeps its relative place after them.</summary>
    public static EditResult Reorder(CatalogStore store, IReadOnlyList<string> orderedGameIds)
    {
        var catalog = store.Load();
        var unknown = orderedGameIds.FirstOrDefault(id => catalog.Games.All(game => game.GameId != id));
        if (unknown is not null) return EditResult.Failed($"{unknown} is not in this PC's game list.");
        if (orderedGameIds.Distinct(StringComparer.Ordinal).Count() != orderedGameIds.Count) return EditResult.Failed("The same game was listed twice.");
        var rest = catalog.Games.Where(game => !orderedGameIds.Contains(game.GameId)).OrderBy(game => game.SortOrder).Select(game => game.GameId);
        var order = orderedGameIds.Concat(rest).ToList();
        var games = catalog.Games.Select(game => game with { SortOrder = order.IndexOf(game.GameId) + 1 }).ToList();
        store.Save(catalog with { Games = games });
        return new EditResult(true, null, null);
    }

    /// <summary>Renames a category everywhere it is used; creating one happens by assigning it to a game.</summary>
    public static EditResult RenameCategory(CatalogStore store, string from, string to)
    {
        if (string.IsNullOrWhiteSpace(to) || to.Length > 40) return EditResult.Failed("A category name must be 1-40 characters.");
        var catalog = store.Load();
        if (catalog.Games.All(game => !game.Category.Equals(from, StringComparison.OrdinalIgnoreCase)))
            return EditResult.Failed($"No game is in the category {from}.");
        var games = catalog.Games
            .Select(game => game.Category.Equals(from, StringComparison.OrdinalIgnoreCase) ? game with { Category = to } : game).ToList();
        store.Save(catalog with { Games = games });
        return new EditResult(true, null, null);
    }

    /// <summary>Display order for the player: the admin's order, then title.</summary>
    public static IEnumerable<ValidatedGame> InDisplayOrder(IEnumerable<ValidatedGame> games) =>
        games.OrderBy(game => game.Entry.SortOrder).ThenBy(game => game.Entry.Title, StringComparer.OrdinalIgnoreCase);
}
