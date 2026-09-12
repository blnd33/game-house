using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace GamingHouse.Agent.Ipc;

/// <summary>Production pipe relay. Verifies that the server is the SCM-owned agent process before forwarding any bytes.</summary>
public static partial class AuthenticatedRelay
{
    public static async Task<int> RunAsync(string pipeName)
    {
        using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification);
        try {
            await pipe.ConnectAsync(3000);
            if (!GetNamedPipeServerProcessId(pipe.SafePipeHandle, out var serverPid) || serverPid == 0 || serverPid != ServicePid()) return 3;
            using var stop = new CancellationTokenSource();
            var input = Console.OpenStandardInput().CopyToAsync(pipe, stop.Token);
            var output = pipe.CopyToAsync(Console.OpenStandardOutput(), stop.Token);
            await Task.WhenAny(input, output); stop.Cancel();
            return 0;
        } catch (Exception error) when (error is IOException or TimeoutException or OperationCanceledException) { return 3; }
    }
    private static uint ServicePid()
    {
        var manager = OpenSCManagerW(null, null, 1); if (manager == IntPtr.Zero) return 0;
        try {
            var service = OpenServiceW(manager, "GamingHouse.Agent", 4); if (service == IntPtr.Zero) return 0;
            try { return QueryServiceStatusEx(service, 0, out var status, Marshal.SizeOf<ServiceStatus>(), out _) && status.State == 4 ? status.ProcessId : 0; }
            finally { CloseServiceHandle(service); }
        } finally { CloseServiceHandle(manager); }
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatus { public uint Type, State, Controls, Win32Exit, ServiceExit, CheckPoint, WaitHint, ProcessId, Flags; }
    [LibraryImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool GetNamedPipeServerProcessId(SafePipeHandle pipe, out uint processId);
    [LibraryImport("advapi32.dll", StringMarshalling = StringMarshalling.Utf16)] private static partial IntPtr OpenSCManagerW(string? machine, string? database, uint access);
    [LibraryImport("advapi32.dll", StringMarshalling = StringMarshalling.Utf16)] private static partial IntPtr OpenServiceW(IntPtr manager, string name, uint access);
    [LibraryImport("advapi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool QueryServiceStatusEx(IntPtr service, int level, out ServiceStatus status, int size, out int needed);
    [LibraryImport("advapi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool CloseServiceHandle(IntPtr handle);
}
