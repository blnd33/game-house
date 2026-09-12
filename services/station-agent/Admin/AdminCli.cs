using System.Text;

namespace GamingHouse.Agent.Admin;

/// <summary>
/// Sets the staff password for the admin panel: used during installation, and by
/// a Windows administrator if staff forget it. Typed input is never echoed and
/// never appears on the command line or in any log.
/// </summary>
public static class AdminCli
{
    public const string Usage = "GamingHouse.Agent.exe admin set-password | status [--config-dir <folder>]";

    public static int Run(CommandLine cli)
    {
        var authority = new AdminAuthority(cli.ConfigDirectory);
        switch (cli.Positionals.ElementAtOrDefault(1))
        {
            case "set-password":
            {
                Console.Error.WriteLine($"Set the staff password for the admin panel on this PC ({AdminAuthority.MinimumPasswordLength}+ characters).");
                var first = Read("New password: ");
                var second = Read("Repeat password: ");
                if (first != second) { Console.Error.WriteLine("The passwords do not match. Nothing was changed."); return 1; }
                try { authority.SetPassword(first); }
                catch (ArgumentException error) { Console.Error.WriteLine(error.Message); return 1; }
                Console.WriteLine("Staff password set. The Admin button in the app now opens with it.");
                return 0;
            }
            case "status":
                Console.WriteLine(authority.PasswordSet
                    ? "A staff password is set on this PC."
                    : "No staff password is set on this PC; the admin panel cannot be opened.");
                return 0;
            default:
                Console.Error.WriteLine(Usage);
                return 2;
        }
    }

    private static string Read(string label)
    {
        Console.Error.Write(label);
        if (Console.IsInputRedirected) return Console.ReadLine() ?? string.Empty; // scripted installs and tests
        var text = new StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter) { Console.Error.WriteLine(); return text.ToString(); }
            if (key.Key == ConsoleKey.Backspace) { if (text.Length > 0) text.Length--; continue; }
            if (!char.IsControl(key.KeyChar)) text.Append(key.KeyChar);
        }
    }
}
