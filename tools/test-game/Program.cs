// DEVELOPMENT STAND-IN used to test launching and process detection without real
// games. It is not a game, does nothing but wait, and is never installed on venue PCs.
//   --exit-after <seconds>  close by itself (default 600)
//   --exit-code <n>         exit code to return (simulates a crash when non-zero)
using System.Globalization;

var exitAfter = Option("--exit-after", 600);
var exitCode = Option("--exit-code", 0);
try { Console.Title = "Gaming House test game (stand-in)"; } catch (IOException) { }
Console.WriteLine("Gaming House TEST GAME - a stand-in used to test launching. It is not a real game.");
Console.WriteLine($"It closes by itself after {exitAfter} seconds. You can also close this window.");

var deadline = DateTime.UtcNow.AddSeconds(exitAfter);
while (DateTime.UtcNow < deadline)
{
    try
    {
        if (!Console.IsInputRedirected && Console.KeyAvailable && Console.ReadKey(intercept: true).Key == ConsoleKey.Escape) break;
    }
    catch (InvalidOperationException) { }
    Thread.Sleep(200);
}
return exitCode;

int Option(string name, int fallback)
{
    var index = Array.IndexOf(args, name);
    return index >= 0 && index + 1 < args.Length
        && int.TryParse(args[index + 1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) && value >= 0 ? value : fallback;
}
