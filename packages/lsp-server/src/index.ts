/**
 * ChangeDown LSP Server
 *
 * Language Server Protocol implementation for CriticMarkup editing.
 * Wraps the editor-agnostic @changedown/core package.
 */

export * from './server';
export * from './converters';
export * from './capabilities/hover';
export * from './notifications/decoration-data';
export * from './notifications/pending-edit';
export * from './notifications/view-mode';
export { PendingEditManager, type CrystallizedEdit, type OnCrystallizeCallback, type OnOverlayChangeCallback } from '@changedown/core/host';
export * from './capabilities/code-lens';
