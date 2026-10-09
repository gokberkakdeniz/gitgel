import { IconTile } from '../components/IconTile';
import { isIconName } from '../components/icons';

/** A script's icon in a tile (Settings › Scripts, import preview). Unknown names show the prompt
 * icon. */
export function ScriptIcon({ name, className }: { name: string; className?: string }) {
  return <IconTile name={isIconName(name) ? name : 'prompt'} className={className} />;
}
