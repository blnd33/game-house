namespace GamingHouse.Agent;

/// <summary>Small argument parser: positional words, repeatable "--name value" options and bare flags.</summary>
public sealed class CommandLine
{
    private static readonly HashSet<string> ValueOptions = new(StringComparer.Ordinal)
    {
        "--config-dir", "--pipe", "--parent-pid", "--id", "--app-id", "--exe", "--title", "--category", "--timeout",
        "--artwork", "--path", "--root", "--workdir", "--arg", "--api-url", "--station-label", "--player-sid", "--desktop-exe",
    };
    private static readonly HashSet<string> FlagOptions = new(StringComparer.Ordinal)
    {
        "--dev", "--json", "--controller", "--multiplayer", "--disabled", "--self-check",
    };

    private readonly Dictionary<string, List<string>> values = new(StringComparer.Ordinal);
    private readonly HashSet<string> flags = new(StringComparer.Ordinal);
    private readonly List<string> positionals = [];

    public IReadOnlyList<string> Positionals => positionals;

    public static CommandLine Parse(IReadOnlyList<string> args)
    {
        var line = new CommandLine();
        for (var i = 0; i < args.Count; i++)
        {
            var arg = args[i];
            if (ValueOptions.Contains(arg))
            {
                if (i + 1 >= args.Count) throw new ArgumentException($"{arg} needs a value");
                if (!line.values.TryGetValue(arg, out var list)) line.values[arg] = list = [];
                list.Add(args[++i]); // taken literally, even if it starts with "--"
            }
            else if (FlagOptions.Contains(arg)) line.flags.Add(arg);
            else if (arg.StartsWith("--", StringComparison.Ordinal)) throw new ArgumentException($"unknown option {arg}");
            else line.positionals.Add(arg);
        }
        return line;
    }

    public string? Value(string name) => values.TryGetValue(name, out var list) ? list[^1] : null;
    public IReadOnlyList<string> Values(string name) => values.TryGetValue(name, out var list) ? list : [];
    public bool Flag(string name) => flags.Contains(name);

    public string Require(string name) => Value(name) is { Length: > 0 } value ? value : throw new ArgumentException($"{name} is required");

    public string ConfigDirectory => Value("--config-dir")
        ?? Environment.GetEnvironmentVariable("GAMING_HOUSE_CONFIG_DIR")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "GamingHouse");
}
