using System.IO.Pipes;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace GamingHouse.Agent.Ipc;

public sealed class PipeConnection(Stream stream, int? clientPid, int? sessionId)
{
    public const int MaxLineBytes = 64 * 1024;
    private readonly SemaphoreSlim writeLock = new(1, 1);

    public int? ClientPid { get; } = clientPid;
    public int? SessionId { get; } = sessionId;

    /// <summary>Yields complete lines; throws InvalidDataException when one exceeds the size limit.</summary>
    public async IAsyncEnumerable<string> ReadLinesAsync([EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var buffer = new byte[4096];
        using var line = new MemoryStream();
        while (true)
        {
            var read = await stream.ReadAsync(buffer, cancellationToken);
            if (read == 0) yield break;
            for (var i = 0; i < read; i++)
            {
                if (buffer[i] == (byte)'\n')
                {
                    yield return Encoding.UTF8.GetString(line.GetBuffer(), 0, (int)line.Length).TrimEnd('\r');
                    line.SetLength(0);
                }
                else
                {
                    line.WriteByte(buffer[i]);
                    if (line.Length > MaxLineBytes) throw new InvalidDataException("message too large");
                }
            }
        }
    }

    public async Task SendAsync(AgentMessage message, CancellationToken cancellationToken)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(message, Json.Wire) + "\n");
        await writeLock.WaitAsync(cancellationToken);
        try
        {
            await stream.WriteAsync(bytes, cancellationToken);
            await stream.FlushAsync(cancellationToken);
        }
        finally { writeLock.Release(); }
    }
}

/// <summary>
/// One client at a time over a local named pipe. Development ACL: the current
/// user only, network access denied, and FirstPipeInstance so another process
/// cannot pre-create the pipe. The service ACL (SYSTEM + player SID, client
/// image verification) is Phase 5.
/// </summary>
public sealed partial class PipeServer(string pipeName, Func<PipeConnection, CancellationToken, Task> serve, string? playerSid = null, string? desktopExecutable = null)
{
    public const string DefaultName = "GamingHouse.Station.v1";

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            using var pipe = Create(pipeName);
            try
            {
                await pipe.WaitForConnectionAsync(cancellationToken);
                int? pid = GetNamedPipeClientProcessId(pipe.SafePipeHandle, out var p) ? (int)p : null;
                int? session = GetNamedPipeClientSessionId(pipe.SafePipeHandle, out var s) ? (int)s : null;
                if (pid is null || session is null || session <= 0) continue;
                if (desktopExecutable is not null) {
                    try {
                        using var process = System.Diagnostics.Process.GetProcessById(pid.Value);
                        if (!string.Equals(Path.GetFullPath(process.MainModule?.FileName ?? ""), Path.GetFullPath(desktopExecutable), StringComparison.OrdinalIgnoreCase)) continue;
                    } catch (Exception error) when (error is ArgumentException or System.ComponentModel.Win32Exception or InvalidOperationException) { continue; }
                }
                AgentHost.Log($"desktop connected (pid {pid?.ToString() ?? "?"}, session {session?.ToString() ?? "?"})");
                await serve(new PipeConnection(pipe, pid, session), cancellationToken);
            }
            catch (OperationCanceledException) { break; }
            catch (IOException) { } // client went away
            catch (InvalidDataException error) { AgentHost.Log($"client dropped: {error.Message}"); }
            AgentHost.Log("desktop disconnected");
        }
    }

    private NamedPipeServerStream Create(string name)
    {
        var security = new PipeSecurity();
        var user = WindowsIdentity.GetCurrent().User ?? throw new InvalidOperationException("no user SID");
        security.AddAccessRule(new PipeAccessRule(user, PipeAccessRights.FullControl, AccessControlType.Allow));
        if (playerSid is not null) security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(playerSid), PipeAccessRights.ReadWrite | PipeAccessRights.Synchronize, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid, null), PipeAccessRights.FullControl, AccessControlType.Deny));
        return NamedPipeServerStreamAcl.Create(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.FirstPipeInstance, 64 * 1024, 64 * 1024, security);
    }

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint processId);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool GetNamedPipeClientSessionId(SafePipeHandle pipe, out uint sessionId);
}
