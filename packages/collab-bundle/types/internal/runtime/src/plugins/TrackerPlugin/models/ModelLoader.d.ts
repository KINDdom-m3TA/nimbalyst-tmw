/**
 * Model loader for built-in and custom tracker definitions
 */
import { type TrackerDataModel } from './TrackerDataModel';
/**
 * Raw YAML strings for every bundled builtin tracker type, in load order.
 * Keep this list in sync with the files under ./builtins.
 */
export declare const BUILTIN_TRACKER_YAML: ReadonlyArray<{
    type: string;
    yaml: string;
}>;
/**
 * Parse every bundled builtin YAML into resolved models. Throws if any builtin
 * YAML is malformed or its declared `type` doesn't match its filename, so a bad
 * builtin fails fast (in CI and at startup) instead of silently dropping a type.
 */
export declare function parseBuiltinTrackers(): TrackerDataModel[];
/**
 * Load all built-in tracker definitions
 */
export declare function loadBuiltinTrackers(): void;
/**
 * Load a custom tracker definition from YAML string
 */
export declare function loadCustomTracker(yamlString: string): void;
/**
 * Load custom trackers from a directory (for workspace-specific trackers)
 * This would be called by the Electron main process and passed to the renderer
 */
export declare function loadCustomTrackersFromDirectory(directoryPath: string, fs: any): Promise<void>;
/**
 * ModelLoader singleton for accessing tracker models
 */
export declare class ModelLoader {
    private static instance;
    private constructor();
    static getInstance(): ModelLoader;
    getModel(type: string): Promise<TrackerDataModel>;
    getAllModels(): TrackerDataModel[];
}
