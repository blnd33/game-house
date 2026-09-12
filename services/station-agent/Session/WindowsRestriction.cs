using System.Runtime.InteropServices;
using System.Security.Principal;

namespace GamingHouse.Agent.Session;

// Never invoked in development. Operator must configure the supported profile.
// Disconnecting requires a Windows credential to reconnect; use a restricted
// player account whose reconnect credential is held by staff, not customers.
public static partial class WindowsRestriction
{
    public static string Apply(int sessionId, string profile, bool enabled, string? expectedPlayerSid = null)
    {
        if (!enabled) return "restriction_not_configured";
        if (profile != "disconnect-session-v1" || sessionId <= 0) return "unsupported_restriction";
        if (expectedPlayerSid is null || !WTSQueryUserToken((uint)sessionId, out var token)) return "player_identity_unverified";
        try { using var identity = new WindowsIdentity(token); if (identity.User?.Value != expectedPlayerSid) return "player_identity_mismatch"; }
        finally { CloseHandle(token); }
        if (IsDisconnected(sessionId)) return "verified";
        if (!WTSDisconnectSession(IntPtr.Zero, sessionId, true)) return "wts_disconnect_failed";
        return IsDisconnected(sessionId) ? "verified" : "restriction_verification_failed";
    }
    private static bool IsDisconnected(int id)
    {
        if (!WTSQuerySessionInformationW(IntPtr.Zero, id, 8, out var buffer, out var bytes)) return false;
        try { return bytes >= 4 && Marshal.ReadInt32(buffer) == 4; } // WTSConnectState / WTSDisconnected
        finally { WTSFreeMemory(buffer); }
    }
    [LibraryImport("wtsapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool WTSDisconnectSession(IntPtr server, int sessionId, [MarshalAs(UnmanagedType.Bool)] bool wait);
    [LibraryImport("wtsapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool WTSQuerySessionInformationW(IntPtr server, int sessionId, int infoClass, out IntPtr buffer, out int bytes);
    [LibraryImport("wtsapi32.dll")]
    private static partial void WTSFreeMemory(IntPtr memory);
    [LibraryImport("wtsapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool WTSQueryUserToken(uint sessionId, out IntPtr token);
    [LibraryImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool CloseHandle(IntPtr handle);
}
