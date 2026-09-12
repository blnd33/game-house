using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace GamingHouse.Agent.Platform;

public static partial class PathRules
{
    /// <summary>Drive-rooted local path such as C:\Games\X. Rejects UNC, device and relative paths.</summary>
    public static bool IsLocalAbsolute(string path) =>
        path.Length >= 3 && char.IsAsciiLetter(path[0]) && path[1] == ':' && (path[2] == '\\' || path[2] == '/')
        && !path.Contains('\0') && Path.IsPathFullyQualified(path);

    public static bool HasTraversal(string path) =>
        path.Split('\\', '/').Any(segment => segment is "." or "..");

    /// <summary>
    /// Canonical path with junctions and symbolic links resolved, or null when the
    /// file or folder does not exist. Network locations resolve to UNC and are rejected.
    /// </summary>
    public static unsafe string? FinalPath(string path)
    {
        const uint BackupSemantics = 0x02000000;
        const int Capacity = 1024;
        using var handle = CreateFile(path, 0, FileShare.ReadWrite | FileShare.Delete, IntPtr.Zero, FileMode.Open, BackupSemantics, IntPtr.Zero);
        if (handle.IsInvalid) return null;
        var buffer = stackalloc char[Capacity];
        var length = GetFinalPathNameByHandle(handle, buffer, Capacity, 0);
        if (length == 0 || length >= Capacity) return null;
        var final = new string(buffer, 0, (int)length);
        if (final.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return null;
        return final.StartsWith(@"\\?\", StringComparison.Ordinal) ? final[4..] : final;
    }

    public static bool IsUnder(string path, string root)
    {
        var normalizedRoot = root.TrimEnd('\\', '/') + "\\";
        return path.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase) || SamePath(path, root);
    }

    public static bool SamePath(string a, string b) =>
        string.Equals(a.TrimEnd('\\', '/'), b.TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase);

    [LibraryImport("kernel32.dll", EntryPoint = "CreateFileW", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    private static partial SafeFileHandle CreateFile(string name, uint access, FileShare share, IntPtr security, FileMode mode, uint flags, IntPtr template);

    [LibraryImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW", SetLastError = true)]
    private static unsafe partial uint GetFinalPathNameByHandle(SafeFileHandle handle, char* buffer, uint size, uint flags);
}
