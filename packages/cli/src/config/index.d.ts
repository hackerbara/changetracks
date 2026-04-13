export type PolicyMode = 'strict' | 'safety-net' | 'permissive';
export type CreationTracking = 'none' | 'footnote' | 'inline';
export interface ChangeDownConfig {
    tracking: {
        include: string[];
        exclude: string[];
        /** Glob patterns against full absolute path (POSIX slashes). Omitted = empty. */
        include_absolute?: string[];
        default: 'tracked' | 'untracked';
        auto_header: boolean;
    };
    author: {
        default: string;
        enforcement: 'optional' | 'required';
    };
    hooks: {
        enforcement: 'warn' | 'block';
        exclude: string[];
        patch_wrap_experimental?: boolean;
    };
    matching: {
        mode: 'strict' | 'normalized';
    };
    hashline: {
        enabled: boolean;
        auto_remap: boolean;
    };
    settlement: {
        auto_on_approve: boolean;
        auto_on_reject: boolean;
    };
    review: {
        reasonRequired: {
            human: boolean;
            agent: boolean;
        };
    };
    policy: {
        mode: PolicyMode;
        creation_tracking: CreationTracking;
        // Keep in sync with BuiltinView in @changedown/core/host/types.ts
        default_view?: 'working' | 'simple' | 'decided' | 'original' | 'raw';
        view_policy?: 'suggest' | 'require';
    };
    protocol: {
        mode: 'classic' | 'compact';
        level: 1 | 2;
        reasoning: 'optional' | 'required';
        batch_reasoning: 'optional' | 'required';
    };
    meta?: {
        compact_threshold: number;
    };
}
export declare const DEFAULT_CONFIG: ChangeDownConfig;
export { loadConfig, parseConfigToml, findConfigFile, resolveProjectDir, resolveProtocolMode, isFileInScope, expandTrackingAbsolutePattern, derivePolicyMode, asStringArray, } from './loader.js';
