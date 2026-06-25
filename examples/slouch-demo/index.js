// Slouch entry point. Registers SlouchRoot (your App + the unbreakable overlay)
// instead of App directly. This is why the Slouch pill floats over every screen and
// survives edits to App.tsx. Set as "main" in package.json.
import { registerRootComponent } from 'expo';
import { SlouchRoot } from './slouch/SlouchRoot';

registerRootComponent(SlouchRoot);
