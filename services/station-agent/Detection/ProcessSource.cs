using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using GamingHouse.Agent.Platform;
using Microsoft.Win32.SafeHandles;

namespace GamingHouse.Agent.Detection;

/// <summary>A running process as seen by the agent. ImagePath is canonical, or null when Windows would not reveal it.</summary>
public sealed record ObservedProcess(int Pid, string ImageName, string? ImagePath, DateTimeOffset? StartedAt, int SessionId);

public interface IProcessSource
{
    IReadOnlyList<ObservedProcess> Find(IReadOnlyCollection<string> imageNames);
    bool IsAlive(ObservedProcess process);
}

public sealed partial class WindowsProcessSource : IProcessSource
{
    private const uint QueryLimitedInformation = 0x1000;

    public IReadOnlyList<ObservedProcess> Find(IReadOnlyCollection<string> imageNames)
    {
        var found = new List<ObservedProcess>();
        foreach (var name in imageNames.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            foreach (var process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(name)))
            {
                using (process)
                {
                    try
                    {
                        var path = ImagePath(process.Id);
                        found.Add(new ObservedProcess(process.Id, name, path is null ? null : PathRules.FinalPath(path) ?? path,
                            StartTime(process), process.SessionId));
                    }
                    catch (InvalidOperationException) { } // exited while being inspected
                    catch (Win32Exception) { }
                }
            }
        }
        return found;
    }

    public bool IsAlive(ObservedProcess observed)
    {
        try
        {
            using var process = Process.GetProcessById(observed.Pid);
            try { if (process.HasExited) return false; }
            catch (Win32Exception) { return false; } // Unknown process identity is not confirmed game evidence.
            var started = StartTime(process);
            return observed.StartedAt is not null && started is not null && started == observed.StartedAt && process.SessionId == observed.SessionId;
        }
        catch (ArgumentException) { return false; }
        catch (InvalidOperationException) { return false; }
    }

    private static DateTimeOffset? StartTime(Process process)
    {
        try { return new DateTimeOffset(process.StartTime.ToUniversalTime(), TimeSpan.Zero); }
        catch (Exception error) when (error is Win32Exception or InvalidOperationException or NotSupportedException) { return null; }
    }

    public static unsafe string? ImagePath(int pid)
    {
        using var handle = OpenProcess(QueryLimitedInformation, false, pid);
        if (handle.IsInvalid) return null;
        var buffer = stackalloc char[1024];
        uint size = 1024;
        return QueryFullProcessImageName(handle, 0, buffer, ref size) ? new string(buffer, 0, (int)size) : null;
    }

    [LibraryImport("kernel32.dll", SetLastError = true)]
    private static partial SafeProcessHandle OpenProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, int pid);

    [LibraryImport("kernel32.dll", EntryPoint = "QueryFullProcessImageNameW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static unsafe partial bool QueryFullProcessImageName(SafeProcessHandle process, uint flags, char* buffer, ref uint size);
}

public static class ProcessMatch
{
    /// <summary>Configured game processes in the player's session whose real location is inside the install root.</summary>
    public static IReadOnlyList<ObservedProcess> Verified(IProcessSource source, IReadOnlyCollection<string> names, string root, int session) =>
        source.Find(names).Where(p => p.SessionId == session && p.StartedAt is not null && p.ImagePath is { } path && PathRules.IsUnder(path, root)).ToList();
}
