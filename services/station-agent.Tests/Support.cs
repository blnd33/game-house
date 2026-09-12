using GamingHouse.Agent.Detection;

namespace GamingHouse.Agent.Tests;

/// <summary>A throwaway folder under %TEMP%, deleted afterwards.</summary>
public sealed class TempDir : IDisposable
{
    public string Path { get; } = Directory.CreateDirectory(System.IO.Path.Combine(System.IO.Path.GetTempPath(), "gh-test-" + Guid.NewGuid().ToString("N"))).FullName;

    public string File(string relative, int bytes = 16)
    {
        var full = System.IO.Path.Combine(Path, relative);
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(full)!);
        System.IO.File.WriteAllBytes(full, new byte[bytes]);
        return full;
    }

    public string Text(string relative, string content)
    {
        var full = System.IO.Path.Combine(Path, relative);
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(full)!);
        System.IO.File.WriteAllText(full, content);
        return full;
    }

    public void Dispose()
    {
        try { Directory.Delete(Path, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}

public sealed class FakeProcessSource : IProcessSource
{
    public List<ObservedProcess> Processes { get; } = [];

    public IReadOnlyList<ObservedProcess> Find(IReadOnlyCollection<string> imageNames) =>
        Processes.Where(p => imageNames.Contains(p.ImageName, StringComparer.OrdinalIgnoreCase)).ToList();

    public bool IsAlive(ObservedProcess process) => Processes.Any(p => p.Pid == process.Pid);
}

public static class Times
{
    public static readonly DateTimeOffset T0 = new(2026, 9, 11, 12, 0, 0, TimeSpan.Zero);
    public static DateTimeOffset At(double seconds) => T0.AddSeconds(seconds);
}
