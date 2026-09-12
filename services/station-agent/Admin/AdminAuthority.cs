using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace GamingHouse.Agent.Admin;

/// <summary>
/// The staff password for the in-app admin panel. Only a PBKDF2 hash is stored,
/// never the password itself, and wrong guesses are rate-limited. An unlock token
/// lives in memory only, expires when idle, and never leaves this PC. The panel
/// it protects can change this station's game list and nothing else: no prices,
/// no sessions, no commands.
/// </summary>
public sealed class AdminAuthority(string configDirectory, Func<DateTimeOffset>? clock = null)
{
    public const int MinimumPasswordLength = 6;
    public const int MaximumPasswordLength = 128;
    /// <summary>How long an unlocked panel survives without use.</summary>
    public const int IdleSeconds = 900;
    private const int Iterations = 210_000;
    private const int SaltBytes = 32;
    private const int HashBytes = 32;
    private const int FailuresBeforeLockout = 5;
    private static readonly TimeSpan IdleTimeout = TimeSpan.FromSeconds(IdleSeconds);
    private static readonly TimeSpan FirstLockout = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan MaximumLockout = TimeSpan.FromMinutes(15);

    private readonly string path = Path.Combine(configDirectory, "admin.json");
    private readonly Func<DateTimeOffset> now = clock ?? (() => DateTimeOffset.UtcNow);
    private readonly Dictionary<string, DateTimeOffset> sessions = new(StringComparer.Ordinal);
    private int failures;
    private TimeSpan lockout = FirstLockout;
    private DateTimeOffset lockedUntil = DateTimeOffset.MinValue;

    public bool PasswordSet => File.Exists(path);
    public int LockedOutSeconds => (int)Math.Max(0, Math.Ceiling((lockedUntil - now()).TotalSeconds));

    /// <summary>Writes the hash. Used by the installer, by a password change, and by an administrator reset.</summary>
    public void SetPassword(string password)
    {
        if (password.Length < MinimumPasswordLength || password.Length > MaximumPasswordLength)
            throw new ArgumentException($"The staff password must be {MinimumPasswordLength}-{MaximumPasswordLength} characters.");
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var hash = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, Iterations, HashAlgorithmName.SHA256, HashBytes);
        Directory.CreateDirectory(configDirectory);
        var document = new JsonObject
        {
            ["version"] = 1, ["algorithm"] = "pbkdf2-sha256", ["iterations"] = Iterations,
            ["salt"] = Convert.ToBase64String(salt), ["hash"] = Convert.ToBase64String(hash),
            ["updated_at"] = Json.Utc(now()),
        };
        var temporary = path + ".tmp";
        File.WriteAllText(temporary, document.ToJsonString());
        File.Move(temporary, path, overwrite: true);
        sessions.Clear(); // a new password ends every open panel
    }

    /// <summary>Returns a new unlock token, or null when the password is wrong, unset or locked out.</summary>
    public string? Unlock(string password)
    {
        if (!PasswordSet || LockedOutSeconds > 0) return null;
        JsonObject stored;
        try { stored = JsonNode.Parse(File.ReadAllText(path))!.AsObject(); }
        catch (Exception error) when (error is JsonException or IOException or NullReferenceException) { return null; }
        var salt = Convert.FromBase64String(stored["salt"]!.GetValue<string>());
        var expected = Convert.FromBase64String(stored["hash"]!.GetValue<string>());
        var iterations = stored["iterations"]!.GetValue<int>();
        var actual = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, expected.Length);
        if (!CryptographicOperations.FixedTimeEquals(actual, expected))
        {
            if (++failures >= FailuresBeforeLockout)
            {
                lockedUntil = now() + lockout;
                lockout = lockout < MaximumLockout ? lockout * 2 : MaximumLockout;
                failures = 0;
            }
            return null;
        }
        failures = 0;
        lockout = FirstLockout;
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        sessions[token] = now() + IdleTimeout;
        return token;
    }

    /// <summary>True when the token is a live unlock; each use extends the idle timeout.</summary>
    public bool Holds(string? token)
    {
        if (token is null || !sessions.TryGetValue(token, out var expires)) return false;
        if (expires <= now()) { sessions.Remove(token); return false; }
        sessions[token] = now() + IdleTimeout;
        return true;
    }

    public void Lock(string? token)
    {
        if (token is not null) sessions.Remove(token);
    }

    /// <summary>Closes every open panel, for example when a customer session starts.</summary>
    public void LockAll() => sessions.Clear();
}
