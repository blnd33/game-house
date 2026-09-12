using System.Security.AccessControl;
using System.Security.Principal;

namespace GamingHouse.Agent.Platform;

/// <summary>
/// Finds principals other than SYSTEM, Administrators and TrustedInstaller that
/// could replace an approved executable: write/delete/ACL rights on the file, on
/// every folder from the file up to the install root, or delete-child on the
/// root's parent. Conservative: deny entries are ignored.
/// </summary>
public static class AclInspector
{
    private static readonly HashSet<string> Trusted = new(StringComparer.OrdinalIgnoreCase)
    {
        "S-1-5-18", // SYSTEM
        "S-1-5-32-544", // Administrators
        "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464", // TrustedInstaller
    };
    private const string CreatorOwner = "S-1-3-0";
    private const int GenericWriteOrAll = 0x40000000 | 0x10000000;

    private const FileSystemRights FileRights = FileSystemRights.WriteData | FileSystemRights.AppendData
        | FileSystemRights.Delete | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
    private const FileSystemRights FolderRights = FileSystemRights.CreateFiles | FileSystemRights.CreateDirectories
        | FileSystemRights.DeleteSubdirectoriesAndFiles | FileSystemRights.Delete
        | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;

    public static IReadOnlyList<string> UntrustedWriters(string file, string root)
    {
        var findings = new List<string>();
        Inspect(new FileInfo(file).GetAccessControl(), file, FileRights, findings);
        for (var dir = Path.GetDirectoryName(file); dir is not null; dir = Path.GetDirectoryName(dir))
        {
            Inspect(new DirectoryInfo(dir).GetAccessControl(), dir, FolderRights, findings);
            if (PathRules.SamePath(dir, root))
            {
                if (Path.GetDirectoryName(dir) is { } parent)
                    Inspect(new DirectoryInfo(parent).GetAccessControl(), parent, FileSystemRights.DeleteSubdirectoriesAndFiles, findings, ownerMatters: false);
                break;
            }
        }
        return findings;
    }

    private static void Inspect(FileSystemSecurity security, string path, FileSystemRights mask, List<string> findings, bool ownerMatters = true)
    {
        if (ownerMatters && security.GetOwner(typeof(SecurityIdentifier)) is SecurityIdentifier owner && !Trusted.Contains(owner.Value))
            findings.Add($"{path}: owned by {Name(owner)}");
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
        {
            if (rule.AccessControlType != AccessControlType.Allow || rule.IdentityReference is not SecurityIdentifier sid) continue;
            if (Trusted.Contains(sid.Value) || sid.Value == CreatorOwner) continue;
            if (rule.PropagationFlags.HasFlag(PropagationFlags.InheritOnly)) continue;
            if ((rule.FileSystemRights & mask) != 0 || ((int)rule.FileSystemRights & GenericWriteOrAll) != 0)
                findings.Add($"{path}: {Name(sid)} can modify");
        }
    }

    private static string Name(SecurityIdentifier sid)
    {
        try { return sid.Translate(typeof(NTAccount)).Value; }
        catch (IdentityNotMappedException) { return sid.Value; }
    }
}
