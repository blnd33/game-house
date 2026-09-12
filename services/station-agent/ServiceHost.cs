using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace GamingHouse.Agent;

public static class ServiceHost
{
    public static async Task<int> RunAsync(CommandLine cli, string version)
    {
        var builder = Host.CreateApplicationBuilder();
        builder.Services.AddWindowsService(options => options.ServiceName = "GamingHouse.Agent");
        builder.Services.AddHostedService(provider => new Worker(cli, version, provider.GetRequiredService<IHostApplicationLifetime>()));
        await builder.Build().RunAsync(); return 0;
    }
    private sealed class Worker(CommandLine cli, string version, IHostApplicationLifetime lifetime) : BackgroundService
    {
        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            var code = await AgentHost.RunAsync(cli, version, stoppingToken);
            if (code != 0) Environment.Exit(code); // SCM failure recovery can restart a failed host.
            lifetime.StopApplication();
        }
    }
}
