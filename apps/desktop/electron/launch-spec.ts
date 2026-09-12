// The desktop's own check of a launch plan received from the agent, before
// anything starts. The only things it will ever run: Steam's URI built from a
// digits-only AppID, or an absolute local .exe with individually passed
// arguments. Never a shell command, script, shortcut or remote URL.
export type LaunchSpec =
  | { readonly type: 'steam'; readonly app_id: string }
  | {
    readonly type: 'executable';
    readonly executable_path: string;
    readonly arguments: readonly string[];
    readonly working_directory: string;
  };

const CONTROL = /\p{Cc}/u;
const localPath = (value: unknown): value is string =>
  typeof value === 'string' && value.length < 1024 && /^[A-Za-z]:[\\/]/.test(value) && !CONTROL.test(value)
  && !value.split(/[\\/]/).some(segment => segment === '.' || segment === '..');

export function parseLaunchSpec(value: unknown): LaunchSpec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Launch plan is missing.');
  const spec = value as Record<string, unknown>;
  const keys = Object.keys(spec).sort().join(',');
  if (spec.type === 'steam') {
    if (keys !== 'app_id,type' || typeof spec.app_id !== 'string' || !/^[1-9][0-9]{0,9}$/.test(spec.app_id)) {
      throw new Error('Invalid Steam launch plan.');
    }
    return { type: 'steam', app_id: spec.app_id };
  }
  if (spec.type === 'executable') {
    const args = spec.arguments;
    const valid = keys === 'arguments,executable_path,type,working_directory'
      && localPath(spec.executable_path) && /\.exe$/i.test(spec.executable_path) && localPath(spec.working_directory)
      && Array.isArray(args) && args.length <= 32
      && args.every(arg => typeof arg === 'string' && arg.length <= 256 && !CONTROL.test(arg));
    if (!valid) throw new Error('Invalid executable launch plan.');
    return {
      type: 'executable', executable_path: spec.executable_path as string,
      arguments: [...(args as string[])], working_directory: spec.working_directory as string,
    };
  }
  throw new Error('Unsupported launch type.');
}

export const steamUri = (spec: { readonly app_id: string }) => `steam://rungameid/${spec.app_id}`;
