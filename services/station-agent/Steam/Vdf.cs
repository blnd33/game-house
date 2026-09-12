using System.Text;

namespace GamingHouse.Agent.Steam;

public sealed class VdfNode
{
    public Dictionary<string, object> Entries { get; } = new(StringComparer.OrdinalIgnoreCase);
    public string? Value(string key) => Entries.TryGetValue(key, out var value) ? value as string : null;
    public VdfNode? Child(string key) => Entries.TryGetValue(key, out var value) ? value as VdfNode : null;
}

/// <summary>Minimal reader for Valve's KeyValues text format (libraryfolders.vdf, appmanifest_*.acf).</summary>
public static class Vdf
{
    private const int MaxDepth = 32;
    private enum Kind { Text, Open, Close }
    private readonly record struct Token(Kind Kind, string Text);

    public static VdfNode Parse(string text)
    {
        var position = 0;
        var root = new VdfNode();
        ParseInto(root, text, ref position, depth: 0);
        return root;
    }

    private static void ParseInto(VdfNode node, string s, ref int i, int depth)
    {
        if (depth > MaxDepth) throw new FormatException("VDF nesting is too deep");
        while (true)
        {
            var key = Next(s, ref i);
            if (key is null)
            {
                if (depth > 0) throw new FormatException("VDF ended inside a block");
                return;
            }
            if (key.Value.Kind == Kind.Close)
            {
                if (depth == 0) throw new FormatException("unexpected '}' in VDF");
                return;
            }
            if (key.Value.Kind != Kind.Text) throw new FormatException("expected a VDF key");
            var value = Next(s, ref i) ?? throw new FormatException($"VDF key {key.Value.Text} has no value");
            if (value.Kind == Kind.Open)
            {
                var child = new VdfNode();
                ParseInto(child, s, ref i, depth + 1);
                node.Entries[key.Value.Text] = child;
            }
            else if (value.Kind == Kind.Text) node.Entries[key.Value.Text] = value.Text;
            else throw new FormatException($"VDF key {key.Value.Text} has no value");
        }
    }

    private static Token? Next(string s, ref int i)
    {
        while (i < s.Length)
        {
            var c = s[i];
            if (char.IsWhiteSpace(c)) { i++; continue; }
            if (c == '/' && i + 1 < s.Length && s[i + 1] == '/') { while (i < s.Length && s[i] != '\n') i++; continue; }
            if (c == '[') { while (i < s.Length && s[i] != ']') i++; i++; continue; } // platform conditional
            if (c == '{') { i++; return new Token(Kind.Open, "{"); }
            if (c == '}') { i++; return new Token(Kind.Close, "}"); }
            if (c == '"') return new Token(Kind.Text, Quoted(s, ref i));
            var start = i;
            while (i < s.Length && !char.IsWhiteSpace(s[i]) && s[i] is not ('{' or '}' or '"')) i++;
            return new Token(Kind.Text, s[start..i]);
        }
        return null;
    }

    private static string Quoted(string s, ref int i)
    {
        var text = new StringBuilder();
        i++;
        while (i < s.Length && s[i] != '"')
        {
            if (s[i] == '\\' && i + 1 < s.Length)
            {
                i++;
                text.Append(s[i] switch { 'n' => '\n', 't' => '\t', _ => s[i] });
            }
            else text.Append(s[i]);
            i++;
        }
        if (i >= s.Length) throw new FormatException("unterminated VDF string");
        i++;
        return text.ToString();
    }
}
